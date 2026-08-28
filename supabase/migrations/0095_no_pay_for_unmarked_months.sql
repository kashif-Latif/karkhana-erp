-- 0095_no_pay_for_unmarked_months.sql  (rev 2 — paid leave, visible deduction)
--
-- TWO PROBLEMS. THE SECOND IS THE SERIOUS ONE.
--
-- 1. A single stray record: Abdullah Liaqat marked P on 10 July 2026. The other
--    165 are all August. One row, easily removed.
--
-- 2. Far worse — hub_monthly_payable counted Sundays and public holidays as
--    paid days off for EVERYONE, whether or not that person had a single day
--    marked in the month. So opening July showed all seven people earning
--    roughly four Sundays' pay for a month they were not being tracked in:
--
--        Abdul Rehman   0 present, 4 paid off, counted 4, payable Rs 8,133
--
--    Nobody worked those days and nobody is owed that money. The same fault
--    would invent a salary for any month before a person joined, and for every
--    month of history that exists only because the calendar does.
--
-- THE RULE, AND WHY
--   Paid days off are a benefit of being employed that month, not a property of
--   the calendar. If a person has NO attendance marked at all in a month, they
--   were not being tracked, and the honest payable is zero — not four Sundays.
--
--   One marked day is enough to establish they were there. From that point the
--   full month's Sundays and holidays count, exactly as before, because someone
--   who worked part of a month is still owed the days off within it.
--
-- Everything else is untouched: the formula, the ÷30, the extra day for working
-- a day off. Abdul Rehman's August still comes to Rs 57,952.
--
-- REV 2 adds two things.
--
--   PAID LEAVE. 'L' now counts as a full present day. Approved leave that costs
--   somebody their wage is not leave, it is an absence with a friendlier name —
--   the distinction between the two IS whether it is paid.
--
--   A VISIBLE DEDUCTION. Absence already cost a day's pay, because an uncounted
--   day earns nothing. But subtraction by omission is invisible: Ahmad's two
--   absences turned Rs 13,000 into Rs 12,000 with nothing on screen saying so.
--   `absent_deduction` states it — what those days would have paid.
--
-- Safe to run more than once.

begin;

-- ---------------------------------------------------------------------------
-- 1. The stray July record. Hub employees only, and only before August 2026 —
--    the month the Hub started being tracked in this system.
-- ---------------------------------------------------------------------------
delete from online_att_records r
 where (r.year < 2026 or (r.year = 2026 and r.month < 8))
   and exists (
     select 1 from online_att_employees e
      where e.id = r.emp_id
        and e.department_id = (select id from departments where code = 'HUB'));

-- ---------------------------------------------------------------------------
-- 2. No marked days, no pay.
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
  -- Days as TEXT. Every date column left by the old app is text, so nothing
  -- here compares a date to a date.
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
           count(m.day)                                                       as marked_days,
           -- Leave counts exactly like a present day. That is what makes it leave.
           count(*) filter (where m.status in ('P','L') and not m.is_off)      as present,
           count(*) filter (where m.status = 'L')                             as leave_days,
           count(*) filter (where m.status = 'H' and not m.is_off)            as half,
           count(*) filter (where m.status = 'A')                             as absent,
           /* PAID DAYS OFF ARE A BENEFIT OF BEING EMPLOYED THAT MONTH, not a
              property of the calendar. Somebody with nothing marked was not
              being tracked, and giving them four Sundays' pay for a month they
              were not there is inventing a wage. One marked day establishes
              they were present in the month; from there the full month's days
              off count, because a person who worked part of a month is still
              owed the days off inside it. */
           case when count(m.day) = 0 then 0
                else (select count(*) from days d where d.is_sunday or d.is_holiday) end
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
  -- absent_deduction is what the absent days WOULD have paid. The money is
  -- already gone by not being counted; this only makes the loss visible instead
  -- of leaving the reader to infer it from a smaller total.
  select s.emp_id, s.name, s.designation, s.salary,
         t.present::integer, t.half::integer, t.absent::integer,
         t.leave_days::integer,
         round((s.salary / 30.0) * t.absent)::numeric as absent_deduction,
         t.paid_off::integer, t.extra_days::integer,
         (t.present + t.half * 0.5 + t.paid_off + t.extra_days)::numeric as counted_days,
         coalesce(a.advances, 0) as advances,
         /* An advance is still deducted even in a month with no attendance —
            the money went out and has to come back. It shows as a negative
            payable, which is correct and visible rather than silently zeroed. */
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
-- VERIFY
-- ===========================================================================
-- -- 1. Nothing before August for the Hub. Must be 0.
-- select count(*) from online_att_records r
--  where (r.year < 2026 or (r.year = 2026 and r.month < 8))
--    and exists (select 1 from online_att_employees e
--                 where e.id = r.emp_id
--                   and e.department_id = (select id from departments where code='HUB'));
--
-- -- 2. July must now show zeros all the way down — no counted days, no payable.
-- select name, present, paid_off, counted_days, payable
--   from hub_monthly_payable(2026, 7) order by name;
--
-- -- 3. August must be unchanged. Abdul Rehman still Rs 57,952.
-- select name, present, half, absent, paid_off, extra_days,
--        counted_days, advances, payable
--   from hub_monthly_payable(2026, 8) order by name;
-- ===========================================================================
