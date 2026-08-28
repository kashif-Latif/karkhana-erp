-- 0094_monthly_payable.sql
--
-- THE PAYROLL CALCULATION. It did not exist here.
--
-- The Attendance page lists four tables and adds up salaries. The old app's
-- Monthly Summary — the screen that produced Abdul Rehman's Rs 55,918 — has no
-- equivalent, which is why the Salaries tab is empty. That tab reads
-- online_att_salary_status, a paid/unpaid FLAG per person per month. It was
-- empty in the old app too because nobody had pressed Mark Paid yet. Nothing
-- was lost; the calculation simply was not here.
--
-- THE FORMULA, read off the old app's own footnote and verified against it:
--
--     counted days = Present + ½·Half + paid days off (+1 per day off worked)
--     payable      = (Salary ÷ 30) × counted days − advances
--
--   Sundays and public holidays are paid for everyone.
--   Working a day off adds one extra day rather than replacing it.
--   The current month counts only up to today; a finished month counts whole.
--
-- WHY ÷ 30 AND NOT THE ACTUAL DAY COUNT
--   Because that is what the business does. A flat thirtieth of the salary per
--   counted day is how these wages have been calculated and paid, and matching
--   the calendar month would quietly change what everybody earns in a 31-day
--   month. It is a business rule, not an oversight, and it is written here as
--   one so nobody later "corrects" it.
--
-- WHY IN THE DATABASE
--   A browser sees the first thousand rows it is handed. Four pages of this
--   system have already under-reported for exactly that reason. Attendance is
--   166 rows today and will be tens of thousands within a year of running three
--   businesses, so this is counted where all the rows are.
--
-- EVERY DATE IN THESE TABLES IS TEXT.
--   The old app stored dates as 'YYYY-MM-DD' strings, and every table it left
--   behind inherited that: online_att_advances.date, online_att_holidays.hdate.
--   Comparing them to a real date gives "operator does not exist: text = date".
--
--   So nothing in this function compares dates as dates. Days are generated as
--   text in the same format and matched string to string. It is not elegant,
--   but it matches the data that is actually there, and converting the columns
--   would mean touching tables the attendance screen already reads.
--
-- Safe to run more than once.

begin;

-- ---------------------------------------------------------------------------
-- The holidays table, if the old app's one was never mirrored here.
-- Sundays are calculated; a public holiday has to be recorded.
-- ---------------------------------------------------------------------------
-- Text, matching what the old app created. `if not exists` means an existing
-- table keeps its shape regardless — which is exactly how the date/text
-- mismatch got in — so this mirrors reality rather than an ideal.
create table if not exists online_att_holidays (
  hdate      text primary key,
  name       text,
  created_at timestamptz default now()
);

-- 14 August 2026, Independence Day — the Hol+ on Abdul Rehman's calendar.
-- Without it his counted days drop by one and every August payable is wrong.
insert into online_att_holidays (hdate, name)
values ('2026-08-14', 'Independence Day')
on conflict (hdate) do nothing;

grant select on online_att_holidays to authenticated;

-- ---------------------------------------------------------------------------
-- One row per employee per month: the days, the advances, the payable.
-- ---------------------------------------------------------------------------
create or replace function hub_monthly_payable(
  p_year  integer,
  p_month integer,
  p_department text default 'HUB'
)
returns table (
  emp_id        text,
  name          text,
  designation   text,
  salary        numeric,
  present       integer,
  half          integer,
  absent        integer,
  paid_off      integer,
  extra_days    integer,
  counted_days  numeric,
  advances      numeric,
  payable       numeric,
  is_paid       boolean
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with bounds as (
    select make_date(p_year, p_month, 1) as first_day,
           (make_date(p_year, p_month, 1) + interval '1 month - 1 day')::date as last_day,
           -- A month still running counts only up to today. Counting the whole
           -- month would show everybody a full salary on the 3rd.
           least((make_date(p_year, p_month, 1) + interval '1 month - 1 day')::date,
                 current_date) as up_to
  ),
  -- Every day of the month so far, with what kind of day it is.
  days as (
    select to_char(d, 'YYYY-MM-DD')                  as day,
           extract(dow from d) = 0                   as is_sunday,
           exists (select 1 from online_att_holidays h
                    where h.hdate = to_char(d, 'YYYY-MM-DD')) as is_holiday
      from bounds b, generate_series(b.first_day, b.up_to, interval '1 day') d
  ),
  staff as (
    select e.id::text as emp_id, e.name, e.designation, coalesce(e.sal, 0)::numeric as salary
      from online_att_employees e
     where p_department is null
        or e.department_id = (select id from departments where code = p_department)
  ),
  marked as (
    select r.emp_id,
           to_char(make_date(r.year, r.month, r.day), 'YYYY-MM-DD') as day,
           upper(btrim(r.status))                                   as status,
           (extract(dow from make_date(r.year, r.month, r.day)) = 0
             or exists (select 1 from online_att_holidays h
                         where h.hdate = to_char(make_date(r.year, r.month, r.day), 'YYYY-MM-DD')))
                                                                    as is_off
      from online_att_records r
     where r.year = p_year and r.month = p_month
  ),
  tally as (
    select s.emp_id,
           /* PRESENT MEANS A WORKING DAY WORKED.
              A P on a Sunday or a holiday is NOT counted here — that day is
              already paid to everyone via paid_off, and working it earns the
              +1 in extra_days. Counting it as present as well paid it twice,
              which put Abdul Rehman's August at 30 counted days against the
              28 the old app showed. */
           count(*) filter (where m.status = 'P' and not m.is_off)            as present,
           count(*) filter (where m.status = 'H' and not m.is_off)            as half,
           count(*) filter (where m.status = 'A')                             as absent,
           -- Paid days off: Sundays and holidays, whether or not anyone marked
           -- them. They are paid for everybody by definition.
           (select count(*) from days d where d.is_sunday or d.is_holiday)    as paid_off,
           -- A day off that was worked earns an extra day ON TOP of being paid.
           -- A day off that was worked earns an extra day on top of being paid.
           count(*) filter (where m.status in ('P','H') and m.is_off)         as extra_days
      from staff s
      left join marked m on m.emp_id = s.emp_id
     group by s.emp_id
  ),
  adv as (
    select a.emp_id, coalesce(sum(a.amount), 0)::numeric as advances
      from online_att_advances a
     where a.deduct_year = p_year and a.deduct_month = p_month
     group by a.emp_id
  )
  select s.emp_id, s.name, s.designation, s.salary,
         t.present::integer, t.half::integer, t.absent::integer,
         t.paid_off::integer, t.extra_days::integer,
         (t.present + t.half * 0.5 + t.paid_off + t.extra_days)::numeric as counted_days,
         coalesce(a.advances, 0) as advances,
         round(
           (s.salary / 30.0) * (t.present + t.half * 0.5 + t.paid_off + t.extra_days)
           - coalesce(a.advances, 0)
         )::numeric as payable,
         coalesce(ss.paid, false) as is_paid
    from staff s
    join tally t on t.emp_id = s.emp_id
    left join adv a on a.emp_id = s.emp_id
    left join online_att_salary_status ss
           on ss.emp_id = s.emp_id and ss.year = p_year and ss.month = p_month
   order by s.name;
$function$;

grant execute on function hub_monthly_payable(integer, integer, text) to authenticated;

commit;

-- ===========================================================================
-- THE TEST. Abdul Rehman, August 2026, must come to Rs 55,918 — the same
-- figure the old app shows. If it does, the import and the formula are both
-- right and the payroll can be trusted.
-- ===========================================================================
-- select name, present, half, absent, paid_off, extra_days,
--        counted_days, advances, payable
--   from hub_monthly_payable(2026, 8)
--  order by name;
--
-- The old app showed 22 present / 28 counted / Rs 55,918 at 10:01 on 28 Aug,
-- BEFORE that day was marked. It is marked now, so the correct answer today is
-- 23 present, 5 paid off, +1 extra = 29 counted days and Rs 57,952. Those are
-- the same calculation on one more day of data, not a disagreement.
--
-- To reproduce the old figure exactly, ignore 28 Aug and the numbers land on
-- 22 / 28 / 55,918.
-- ===========================================================================
