-- 0098_paid_days_from_join_date.sql
--
-- SOMEBODY WHO JOINS ON THE 20TH IS BEING PAID FOR SUNDAYS IN THE FIRST WEEK.
--
-- paid_off counts every Sunday and public holiday in the month for anyone with
-- at least one day marked. That was right when everybody had been there all
-- month. It is wrong the first time somebody starts partway through:
--
--     joins 20 August, works 8 days
--     paid_off counts all 5 Sundays — including the 2nd, 9th and 16th,
--     three weeks before they were hired
--
--   Rs 55,000 ÷ 30 × 3 extra days = about Rs 5,500 for days that were not
--   theirs. It applies to leavers too, in reverse.
--
-- THE RULE
--   Days off are counted only from the day someone joined, and only up to
--   today. A rest day is earned by being employed on it. Somebody hired on the
--   20th gets the Sundays after the 20th and no others.
--
--   join_date lives on employees and is nullable, because most rows here were
--   imported without one. A missing join date is treated as "was here all
--   month", which is what the seven imported people actually were — it keeps
--   every current figure identical and only changes behaviour for people whose
--   start date is known.
--
-- Abdul Rehman, Awais and the rest have no join_date, so August is unchanged:
-- 29 counted days, Rs 57,952 and Rs 13,167 as before. Verify that first.
--
-- Safe to run more than once.

begin;

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
                 current_date) as up_to
  ),
  days as (
    select to_char(d, 'YYYY-MM-DD')                  as day,
           d::date                                   as day_date,
           extract(dow from d) = 0                   as is_sunday,
           exists (select 1 from online_att_holidays h
                    where h.hdate = to_char(d, 'YYYY-MM-DD')) as is_holiday
      from bounds b, generate_series(b.first_day, b.up_to, interval '1 day') d
  ),
  staff as (
    select e.id::text                        as emp_id,
           e.name,
           e.designation,
           coalesce(e.sal, 0)::numeric       as salary,
           -- The date they started, when it is known. Matched by name because
           -- the two tables were populated separately and share no key.
           (select x.join_date from employees x
             where lower(x.name) = lower(e.name)
               and x.department_id = e.department_id
             limit 1)                        as join_date
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
           count(m.day)                                                       as marked_days,
           count(*) filter (where m.status in ('P','L') and not m.is_off)      as present,
           count(*) filter (where m.status = 'L')                             as leave_days,
           count(*) filter (where m.status = 'H' and not m.is_off)            as half,
           count(*) filter (where m.status = 'A')                             as absent,
           /* Days off are counted from the day somebody joined, not from the
              first of the month. A rest day is earned by being employed on it,
              and paying a new starter for the Sundays before they were hired is
              money for days that were not theirs.

              No join date means "was here all month", which is true of everyone
              imported from the old system and keeps their figures unchanged. */
           case when count(m.day) = 0 then 0
                else (select count(*) from days d
                       where (d.is_sunday or d.is_holiday)
                         and (s.join_date is null or d.day_date >= s.join_date)) end
                                                                              as paid_off,
           count(*) filter (where m.status in ('P','H','L') and m.is_off)     as extra_days
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
         t.leave_days::integer,
         round((s.salary / 30.0) * t.absent)::numeric as absent_deduction,
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

-- Rebuilt because it selects from the function above and was dropped with it.
create or replace function my_monthly_payable(p_year integer, p_month integer)
returns table (
  name text, designation text, salary numeric,
  present integer, half integer, absent integer, leave_days integer,
  absent_deduction numeric, paid_off integer, extra_days integer,
  counted_days numeric, advances numeric, payable numeric, is_paid boolean
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select m.name, m.designation, m.salary, m.present, m.half, m.absent,
         m.leave_days, m.absent_deduction, m.paid_off, m.extra_days,
         m.counted_days, m.advances, m.payable, m.is_paid
    from hub_monthly_payable(p_year, p_month, null) m
   where m.emp_id = (select e.id::text from online_att_employees e
                      where e.user_id = auth.uid() limit 1);
$function$;

grant execute on function my_monthly_payable(integer, integer) to authenticated;

commit;

-- ===========================================================================
-- VERIFY — nothing should have moved, because none of the seven has a join
-- date. Abdul Rehman Rs 57,952, Awais Rs 13,167.
-- ===========================================================================
-- select name, present, paid_off, extra_days, counted_days, advances, payable
--   from hub_monthly_payable(2026, 8) order by name;
--
-- To see the new rule work, give somebody a start date and look again:
--   update employees set join_date = '2026-08-20' where name = 'Ahmad';
--   -- his paid_off drops from 5 to 2: only the Sundays on or after the 20th.
-- ===========================================================================
