-- 0102_back_to_divide_by_30.sql
--
-- BACK TO A FLAT ÷ 30. Reverses 0100.
--
-- 0100 divided by the month's real length so that a full month always paid
-- exactly the salary. It works, and every figure it produced was right — but it
-- changed every number people were used to, and the business runs on ÷ 30.
--
-- That is a legitimate reason to go back. A payroll rule is not only arithmetic;
-- it is what has been agreed with the people being paid, and changing it
-- unilaterally is a bigger thing than making the arithmetic tidier.
--
-- WHAT ÷ 30 MEANS, WRITTEN DOWN SO IT IS A CHOICE AND NOT AN OVERSIGHT
--   A day is always worth salary ÷ 30, whatever month it falls in. So a full
--   month worked pays:
--
--       31-day month   103.3% of salary
--       30-day month   100%
--       February        93.3%
--
--   and roughly 12.17 salaries over a year rather than 12. Somebody who never
--   misses a day still earns less in February than in January. That is how this
--   business has always paid, and the previous system did the same.
--
--   Do not "fix" this later without asking. It is deliberate.
--
-- Everything else 0099 introduced stays exactly as it is: each day valued at the
-- rate in force on it, so Hamza Khan's mid-month raise is still split correctly.
--
-- ORIGINAL 0100 NOTES BELOW, kept because they describe the day-by-day model
-- that is still in use — only the divisor has gone back.
--
-- A FULL MONTH WORKED PAYS THE FULL SALARY, WHATEVER THE MONTH'S LENGTH.
--
-- Until now a day was worth salary ÷ 30, regardless of how many days the month
-- actually had. That meant a full month paid:
--
--     January  31 days   103.3% of salary
--     April    30 days   100%
--     February 28 days    93.3%
--
-- and 12.17 salaries over a year instead of 12. Somebody who never missed a day
-- in February was still paid seven percent less than in January, for no reason
-- they could see.
--
-- Now the divisor is the month's own length: ÷31 in August, ÷28 in February.
-- Turn up every day and you are paid your salary — the same figure every month.
-- Miss two days out of 28 and you lose 2/28ths, which is the fair share of that
-- month rather than of an imaginary 30-day one.
--
-- The rate history still applies: each day is valued at the rate in force on it,
-- divided by that month's length.
--
-- EVERY DAY IS PAID AT THE RATE IN FORCE ON THAT DAY.
--
-- Hamza Khan went from Rs 45,000 to Rs 65,000 on 12 August. The old app splits
-- the month at that date; this system applied the current rate to the whole of
-- it and overpaid him by about Rs 7,700:
--
--     old app   45,000/30 x 11.5  +  65,000/30 x 17   =  54,083  ->  25,083
--     here      65,000/30 x 28.5                      =  61,750  ->  32,750
--
-- Six of the seven matched only because nobody else has ever had a raise. The
-- error was invisible and in the employee's favour, which is the kind that goes
-- unnoticed until somebody checks the arithmetic by hand.
--
-- HOW THIS WORKS NOW
--   Instead of one salary multiplied by a day count, every day of the month is
--   valued on its own: what that day was worth, at the rate that applied then.
--
--       a working day worked        1 day
--       a half day                  ½ day
--       approved leave              1 day
--       a Sunday or public holiday  1 day, to anyone employed that day
--       working one of those        1 more day on top
--       absent                      nothing
--
--   Each is multiplied by that day's rate ÷ 30 and the month is the sum. A
--   raise mid-month, somebody joining on the 20th, a holiday worked — all fall
--   out of the same rule rather than needing a special case each.
--
-- WHY A TABLE AND NOT A COLUMN
--   A salary is not a fact about a person, it is a fact about a person AND a
--   date. Storing only the current one throws away the information needed to
--   pay last month correctly, and it is thrown away at exactly the moment
--   somebody gets a raise — when it matters most.
--
-- Safe to run more than once.

begin;

-- The salary history table and its rows come from 0099 and are untouched.


-- ---------------------------------------------------------------------------
-- The payable, valued day by day.
-- ---------------------------------------------------------------------------
drop function if exists my_monthly_payable(integer, integer);
drop function if exists hub_monthly_payable(integer, integer, text);

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
  leave_days    integer,
  absent_deduction numeric,
  paid_off      integer,
  extra_days    integer,
  counted_days  numeric,
  gross         numeric,
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
           least((make_date(p_year, p_month, 1) + interval '1 month - 1 day')::date,
                 current_date) as up_to,
           /* month_days is no longer used as the divisor — a day is worth
              salary ÷ 30 whatever the month. Kept because the bounds CTE reads
              more clearly with the month's length beside its dates. */
           extract(day from (make_date(p_year, p_month, 1)
                             + interval '1 month - 1 day'))::numeric as month_days
  ),
  days as (
    select d::date                                   as day_date,
           to_char(d, 'YYYY-MM-DD')                  as day,
           (extract(dow from d) = 0
             or exists (select 1 from online_att_holidays h
                         where h.hdate = to_char(d, 'YYYY-MM-DD'))) as is_off
      from bounds b, generate_series(b.first_day, b.up_to, interval '1 day') d
  ),
  staff as (
    select e.id::text as emp_id, e.name, e.designation,
           coalesce(e.sal, 0)::numeric as salary,
           (select x.join_date from employees x
             where lower(x.name) = lower(e.name)
               and x.department_id = e.department_id limit 1) as join_date
      from online_att_employees e
     where p_department is null
        or e.department_id = (select id from departments where code = p_department)
  ),
  marked as (
    select r.emp_id,
           to_char(make_date(r.year, r.month, r.day), 'YYYY-MM-DD') as day,
           upper(btrim(r.status)) as status
      from online_att_records r
     where r.year = p_year and r.month = p_month
  ),
  -- One row per person per day: what that day was worth, and at what rate.
  valued as (
    select s.emp_id,
           d.day_date,
           d.is_off,
           m.status,
           /* The day's value in days. A day off that was worked is worth two:
              one because it is paid to everyone, one more for working it. */
           case
             when m.status = 'A' then 0
             when d.is_off and m.status in ('P','H','L') then 2
             when d.is_off then case when s.join_date is null
                                      or d.day_date >= s.join_date then 1 else 0 end
             when m.status in ('P','L') then 1
             when m.status = 'H' then 0.5
             else 0
           end::numeric as day_value,
           /* The rate in force on that day — the most recent change on or
              before it. This is the whole point of the table. */
           coalesce((select h.sal from online_att_salary_history h
                      where h.emp_id = s.emp_id and h.effective_from <= d.day_date
                      order by h.effective_from desc limit 1), s.salary)::numeric as rate
      from staff s
      cross join days d
      left join marked m on m.emp_id = s.emp_id and m.day = d.day
  ),
  tally as (
    select v.emp_id,
           count(*) filter (where v.status in ('P','L') and not v.is_off)      as present,
           count(*) filter (where v.status = 'H' and not v.is_off)             as half,
           count(*) filter (where v.status = 'A')                              as absent,
           count(*) filter (where v.status = 'L')                              as leave_days,
           count(*) filter (where v.is_off and v.day_value > 0)                as paid_off,
           count(*) filter (where v.is_off and v.status in ('P','H','L'))      as extra_days,
           sum(v.day_value)                                                    as counted_days,
           sum(v.day_value * v.rate / 30.0)                                    as gross,
           -- What the absent days would have paid, at their own day's rate.
           sum(case when v.status = 'A' then v.rate / 30.0 else 0 end)         as absent_deduction,
           count(*) filter (where v.status is not null)                        as marked_days
      from valued v
     group by v.emp_id
  ),
  adv as (
    select a.emp_id, coalesce(sum(a.amount), 0)::numeric as advances
      from online_att_advances a
     where a.deduct_year = p_year and a.deduct_month = p_month
     group by a.emp_id
  )
  select s.emp_id, s.name, s.designation, s.salary,
         t.present::integer, t.half::integer, t.absent::integer, t.leave_days::integer,
         round(t.absent_deduction)::numeric,
         -- Nobody marked at all was not being tracked that month, so no days
         -- off are owed and the month is zero rather than a month of Sundays.
         case when t.marked_days = 0 then 0 else t.paid_off end::integer,
         t.extra_days::integer,
         case when t.marked_days = 0 then 0 else t.counted_days end,
         case when t.marked_days = 0 then 0 else round(t.gross) end,
         coalesce(a.advances, 0),
         case when t.marked_days = 0 then -coalesce(a.advances, 0)
              else round(t.gross - coalesce(a.advances, 0)) end,
         coalesce(ss.paid, false)
    from staff s
    join tally t on t.emp_id = s.emp_id
    left join adv a on a.emp_id = s.emp_id
    left join online_att_salary_status ss
           on ss.emp_id = s.emp_id and ss.year = p_year and ss.month = p_month
   order by s.name;
$function$;

grant execute on function hub_monthly_payable(integer, integer, text) to authenticated;

create or replace function my_monthly_payable(p_year integer, p_month integer)
returns table (
  name text, designation text, salary numeric,
  present integer, half integer, absent integer, leave_days integer,
  absent_deduction numeric, paid_off integer, extra_days integer,
  counted_days numeric, gross numeric, advances numeric, payable numeric, is_paid boolean
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select m.name, m.designation, m.salary, m.present, m.half, m.absent,
         m.leave_days, m.absent_deduction, m.paid_off, m.extra_days,
         m.counted_days, m.gross, m.advances, m.payable, m.is_paid
    from hub_monthly_payable(p_year, p_month, null) m
   where m.emp_id = (select e.id::text from online_att_employees e
                      where e.user_id = auth.uid() limit 1);
$function$;

grant execute on function my_monthly_payable(integer, integer) to authenticated;

commit;

-- ===========================================================================
-- VERIFY — every August figure returns to what it was before 0100, and to what
-- the previous system shows:
--
--   Abdul Rehman   57,952        Hamza Khan   25,083
--   Abdullah Liaqat 18,500       Awais        13,167
--   Ahmad           12,500       Qaswar       10,033
--   Hamza Mukhtar   45,833
--
-- Hamza Khan at 25,083 is the one that matters: it proves the ÷30 came back
-- AND his mid-month raise is still being split at 12 August.
--
-- Original note: Hamza Khan came to 25,083 on 28 counted days, matching
-- the old app exactly. Everyone else must be unchanged.
-- ===========================================================================
-- select name, present, half, absent, paid_off, extra_days,
--        counted_days, gross, advances, payable
--   from hub_monthly_payable(2026, 8) order by name;
--
--   Hamza Khan     28.5 counted · gross 54,083 · payable 25,083
--   Abdul Rehman   29.0 counted · gross 58,967 · payable 57,952
--   Awais          29.0 counted · gross 53,167 · payable 13,167
--
-- RECORDING A RAISE FROM NOW ON
--   insert into online_att_salary_history (emp_id, effective_from, sal, note)
--   select id::text, date '2026-09-01', 70000, 'annual increase'
--     from online_att_employees where name = 'Hamza Khan';
--
--   Days before that date keep the old rate. Nothing already paid moves.
-- ===========================================================================
