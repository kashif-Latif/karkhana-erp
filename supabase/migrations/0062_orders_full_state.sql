-- 0062_orders_full_state.sql
--
-- WHY
--   online_orders carries ONE `status` column holding Pending / Dispatched /
--   Delivered / Cancelled / Returned. Those five values are really THREE
--   independent facts, each owned by a different system:
--
--     payment      Shopify says pending|paid|refunded   — and for COD, the
--                  courier's settlement is the real money truth, not Shopify
--     fulfilment   Shopify alone: unfulfilled|partial|fulfilled|restocked
--     delivery     the courier alone: in transit|delivered|returned
--
--   "Paid but not yet fulfilled" and "fulfilled but not yet paid" are ordinary
--   states that the single column cannot express, so it silently picks one and
--   loses the other. Splitting them is the prerequisite for showing live
--   Shopify state at all.
--
-- COD WARNING — READ BEFORE TRUSTING financial_status
--   On a cash-on-delivery order Shopify reports PENDING until somebody marks it
--   paid by hand. It is NOT evidence that money arrived. The money truth is
--   online_logistics.payment_status / cpr_number, set from the courier's own
--   settlement. These are kept as separate columns on purpose and must never be
--   merged — conflating them would misstate the receivable, which is currently
--   about Rs 1.24M across both couriers.
--
-- Safe to run more than once.

begin;

-- ---------------------------------------------------------------------------
-- 1. Shopify's stable numeric id
--    We key on order NAME today (#TS2739). The name is what humans use, but
--    fulfillments/create and refunds/create carry only the numeric order_id —
--    which is exactly why shopify-webhook currently refuses those topics and
--    why tracking numbers and refunds cannot arrive in real time. Adding the id
--    is what unlocks them.
-- ---------------------------------------------------------------------------
alter table online_orders
  add column if not exists shopify_order_id   bigint,
  add column if not exists shopify_created_at timestamptz,
  add column if not exists shopify_updated_at timestamptz;

create unique index if not exists uq_online_orders_shopify_id
  on online_orders (shopify_order_id)
  where shopify_order_id is not null;

-- ---------------------------------------------------------------------------
-- 2. The three axes, stored separately
-- ---------------------------------------------------------------------------
alter table online_orders
  -- payment, as SHOPIFY sees it (see the COD warning above)
  add column if not exists financial_status  text,
  add column if not exists payment_gateway   text,
  add column if not exists refunded_amount   numeric default 0,

  -- fulfilment, as Shopify sees it
  add column if not exists fulfillment_status text,
  add column if not exists fulfilled_at       timestamptz,

  -- cancellation
  add column if not exists cancelled_at  timestamptz,
  add column if not exists cancel_reason text,

  -- money detail, so the dashboard need not re-derive it
  add column if not exists currency       text,
  add column if not exists subtotal       numeric,
  add column if not exists discount_total numeric,
  add column if not exists shipping_total numeric,
  add column if not exists tax_total      numeric,

  -- merchandising context
  add column if not exists tags       text[],
  add column if not exists note       text,
  add column if not exists item_count integer,

  -- provenance: which push last touched this row, and when
  add column if not exists last_event_topic text,
  add column if not exists last_event_at    timestamptz;

comment on column online_orders.financial_status is
  'Shopify''s own payment state. On COD orders this stays PENDING until marked paid by hand — it is NOT proof of receipt. Real money comes from online_logistics.payment_status / cpr_number.';

comment on column online_orders.last_event_at is
  'When a Shopify webhook last updated this row. If this is stale while orders keep arriving, the push has stopped and only the nightly sweep is running.';

create index if not exists idx_online_orders_financial   on online_orders (financial_status);
create index if not exists idx_online_orders_fulfillment on online_orders (fulfillment_status);
create index if not exists idx_online_orders_last_event  on online_orders (last_event_at desc);

-- ---------------------------------------------------------------------------
-- 3. Webhook idempotency
--    Shopify retries a delivery for up to 48 hours until it gets a fast 200.
--    Without recording the delivery id, a retry reprocesses the same event —
--    refunds counted twice, statuses flapping. The unique index IS the guard:
--    a duplicate insert simply conflicts and the handler stops.
-- ---------------------------------------------------------------------------
create table if not exists online_shopify_events (
  id               bigserial primary key,
  webhook_id       text,                 -- X-Shopify-Webhook-Id
  topic            text not null,
  store_code       text,
  shopify_order_id bigint,
  order_number     text,
  received_at      timestamptz not null default now(),
  handled          boolean     not null default false,
  note             text,
  payload          jsonb
);

create unique index if not exists uq_shopify_events_webhook_id
  on online_shopify_events (webhook_id)
  where webhook_id is not null;

create index if not exists idx_shopify_events_order on online_shopify_events (shopify_order_id);
create index if not exists idx_shopify_events_when  on online_shopify_events (received_at desc);

comment on table online_shopify_events is
  'Every Shopify webhook delivery, raw. Idempotency guard plus an audit trail — when a figure looks wrong, this shows exactly what Shopify sent and when.';

-- ---------------------------------------------------------------------------
-- 4. Keep the legacy `status` column correct, automatically
--    The Orders page and several views still read it. Rather than rewrite every
--    caller at once, derive it from the three axes so old code keeps working
--    while new code reads the real columns.
--
--    Order of precedence is deliberate: cancelled beats everything; a courier
--    outcome beats a Shopify one, because the courier is the authority on where
--    a parcel physically is.
-- ---------------------------------------------------------------------------
create or replace function online_orders_derive_status()
returns trigger
language plpgsql
as $$
begin
  if new.cancelled_at is not null then
    new.status := 'Cancelled';
  elsif upper(coalesce(new.fulfillment_status, '')) in ('FULFILLED', 'PARTIALLY_FULFILLED') then
    new.status := 'Dispatched';
  elsif upper(coalesce(new.financial_status, '')) in ('REFUNDED', 'VOIDED') then
    new.status := 'Cancelled';
  elsif new.status is null then
    new.status := 'Pending';
  end if;
  return new;
end $$;

drop trigger if exists trg_online_orders_status on online_orders;
create trigger trg_online_orders_status
  before insert or update of financial_status, fulfillment_status, cancelled_at
  on online_orders
  for each row execute function online_orders_derive_status();

-- ---------------------------------------------------------------------------
-- 5. One row per order with all three axes side by side
-- ---------------------------------------------------------------------------
create or replace view v_online_order_state as
select
  o.order_number,
  o.store_code,
  o.order_date,
  o.customer_name,
  o.phone,
  o.city,
  o.amount,
  coalesce(o.financial_status, 'UNKNOWN')    as shopify_payment,
  coalesce(o.fulfillment_status, 'UNKNOWN')  as shopify_fulfilment,
  l.courier,
  l.tracking_id,
  l.delivery_status                          as courier_delivery,
  l.payment_status                           as courier_payment,   -- the real money
  l.cod_amount,
  l.cpr_number,
  o.last_event_topic,
  o.last_event_at,
  -- the one line a human wants to read
  case
    when o.cancelled_at is not null                       then 'Cancelled'
    when l.delivery_status = 'Delivered'
     and coalesce(l.payment_status,'') in ('Paid','Received') then 'Delivered & paid'
    when l.delivery_status = 'Delivered'                  then 'Delivered — money not received'
    when l.delivery_status in ('Returned','RTS')          then 'Coming back / returned'
    when l.tracking_id is not null                        then 'With courier'
    when upper(coalesce(o.fulfillment_status,'')) = 'FULFILLED' then 'Fulfilled, no parcel recorded'
    else 'Awaiting dispatch'
  end                                        as plain_state
from online_orders o
left join online_logistics l
       on l.order_number = o.order_number
      and l.store_code   = o.store_code;

grant select on v_online_order_state to authenticated;
grant select on online_shopify_events to authenticated;

commit;

-- ===========================================================================
-- VERIFY
-- ===========================================================================
-- select plain_state, count(*) from v_online_order_state group by 1 order by 2 desc;
-- select topic, count(*), max(received_at) from online_shopify_events group by 1;
