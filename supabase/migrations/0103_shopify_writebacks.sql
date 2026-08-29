-- 0103_shopify_writebacks.sql
--
-- A RECORD OF EVERY ORDER THIS SYSTEM HAS CHANGED IN SHOPIFY.
--
-- Until now nothing wrote to Shopify. Orders came in, statuses came in, and if
-- this system had a bug the worst case was a wrong number on a screen. Writing
-- back removes that safety: a mistake now lands in the shop.
--
-- So every write is recorded here before anything else happens — which order,
-- which store, what was done, whether it worked, and what Shopify said if it
-- did not. If a date range turns out to have been wrong, this is the list to
-- reopen from. Without it the only record would be in Shopify itself, which is
-- the thing you would be trying to undo.
--
-- Safe to run more than once.

create table if not exists online_shopify_writebacks (
  id               bigserial primary key,
  order_number     text not null,
  store_code       text not null,
  shopify_order_id text,
  action           text not null,          -- close | cancel
  succeeded        boolean not null default false,
  error            text,
  created_at       timestamptz not null default now()
);

create index if not exists online_shopify_writebacks_order_idx
  on online_shopify_writebacks (store_code, order_number);
create index if not exists online_shopify_writebacks_when_idx
  on online_shopify_writebacks (created_at desc);

comment on table online_shopify_writebacks is
  'Every order this system has closed or cancelled in Shopify. The list to reopen from if a run was aimed at the wrong dates — Shopify itself cannot tell you which changes came from here.';

grant select on online_shopify_writebacks to authenticated;

-- ===========================================================================
-- WHAT WAS CHANGED, AND WHEN
-- ===========================================================================
-- select created_at::date as day, store_code, action,
--        count(*) filter (where succeeded)     as ok,
--        count(*) filter (where not succeeded) as failed
--   from online_shopify_writebacks
--  group by 1,2,3 order by 1 desc;
--
-- -- Anything that failed, with Shopify's own reason:
-- select order_number, store_code, action, error
--   from online_shopify_writebacks
--  where not succeeded order by created_at desc limit 50;
--
-- -- The list to reopen from, if a run was wrong:
-- select store_code, order_number, shopify_order_id
--   from online_shopify_writebacks
--  where succeeded and created_at::date = current_date
--  order by store_code, order_number;
-- ===========================================================================
