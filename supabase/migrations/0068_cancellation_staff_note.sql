-- 0068_cancellation_staff_note.sql
--
-- WHERE THE AGENT'S REASON ACTUALLY LIVES
--   Proven from a Shopify order timeline, not assumed:
--
--     Grohub Solutions canceled this order.
--       Reason      Customer changed/canceled order     <- cancelReason
--       Staff note  test order                          <- cancellation.staffNote
--
--   while the order's Notes panel read "No notes from customer" — empty.
--
--   So the reason a human typed is on the CANCELLATION event, not on the order
--   note. We were reading order.note and getting nothing, which is why the
--   Returns page could only ever fall back to the courier's wording
--   ("REFUSED TO RECEIVE") — the one thing nobody wanted to see.
--
--   Three fields matter, in this order:
--     1. cancel_staff_note  what the agent typed          <- the real reason
--     2. cancel_reason      Shopify's fixed list          <- context
--     3. tags               WA Confirm, FAKE CUSTOMER...  <- how it was handled
--
-- Safe to run more than once.

begin;

alter table online_orders
  add column if not exists cancel_staff_note text;

comment on column online_orders.cancel_staff_note is
  'The note a staff member typed when cancelling, from Shopify''s cancellation event. NOT order.note, which holds customer notes and is usually empty.';

-- ---------------------------------------------------------------------------
-- Rebuild v_returns_all so the staff note is available to the page.
-- DROP first: CREATE OR REPLACE VIEW cannot insert a column in the middle, only
-- append — that is exactly how migration 0058 failed.
-- ---------------------------------------------------------------------------
drop view if exists v_returns_all;

create view v_returns_all as
select
  l.tracking_id,
  l.order_number,
  l.store_code,
  l.courier,
  l.cod_amount,
  l.delivery_status,
  l.raw_status,
  case
    when l.return_received_at is not null then 'Received'
    when l.delivery_status = 'RTS'        then 'Coming back'
    else                                       'Awaiting receipt'
  end                                            as stage,
  l.rts_reason                                   as courier_reason,
  o.cancel_staff_note                            as agent_note,     -- what a human typed
  o.cancel_reason                                as shopify_reason, -- Shopify's fixed list
  o.note                                         as shopify_note,   -- customer note, usually empty
  o.tags                                         as order_tags,
  o.customer_name,
  o.phone,
  o.city,
  coalesce(l.return_leg_started_at::date, l.delivery_date, l.dispatch_date)
                                                 as return_date,
  l.return_received_at,
  (l.return_received_at is not null)             as received,
  l.return_claim_status,
  l.return_claim_ref,
  l.dispatch_date,
  l.delivery_date,
  (current_date - coalesce(l.return_leg_started_at::date, l.delivery_date, l.dispatch_date))
                                                 as age_days
from online_logistics l
left join online_orders o
       on o.order_number = l.order_number
      and o.store_code   = l.store_code
where l.delivery_status in ('RTS', 'Returned');

grant select on v_returns_all to authenticated;

commit;

-- ===========================================================================
-- VERIFY — after redeploying shopify-sync and running a pull, this should show
-- real sentences typed by your agents, not courier wording.
-- ===========================================================================
-- select order_number, agent_note, shopify_reason, order_tags, courier_reason
--   from v_returns_all
--  where agent_note is not null
--  order by return_date desc limit 20;
--
-- -- how much of the reason gap is now filled
-- select count(*) filter (where agent_note is not null)     as have_agent_note,
--        count(*) filter (where shopify_reason is not null) as have_shopify_reason,
--        count(*)                                           as all_returns
--   from v_returns_all;
