-- 0107_cpr_closes_returns.sql
--
-- A SETTLEMENT NOW CLOSES THE RETURNS IT PAYS FOR.
--
-- Until now the import recorded the courier's charge for a return and left the
-- parcel in the chase list, because "received" meant somebody had physically
-- confirmed the box was back. That was the right rule when the list was short.
-- It is not, once a year of settlements arrive at once: the list filled with
-- parcels the courier had already finished with and nobody was pursuing.
--
-- A courier does not bill for a return trip it has not completed. The CPR is
-- its own written confirmation that the leg is over — better evidence than a
-- tick somebody adds days later from memory.
--
-- WHAT DOES NOT CHANGE
--   No money moves. A return was never paid and settling it does not make it
--   income; only the courier's charge for the trip back is recorded.
--   return_closed_reason records that a settlement closed it, so it stays
--   distinguishable from a parcel somebody actually received.
--
-- Only the returns branch of the function changes. Everything else is 0083
-- verbatim, reproduced because CREATE OR REPLACE needs the whole body.
--
-- Safe to run more than once.

begin;

create or replace function hub_cpr_import(
  p_courier        text,
  p_cpr_number     text,
  p_cpr_date       date,
  p_declared_count integer,
  p_declared_total numeric,
  p_rows           jsonb,
  p_dry_run        boolean default true,
  p_summary        jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_parsed_count  integer;
  v_parsed_total  numeric;
  v_delivered     integer;
  v_returned      integer;
  v_matched       integer;
  v_matched_total numeric;
  v_unmatched     jsonb;
  v_corrected     integer;
  v_from_status   jsonb;
  v_already_paid  integer;
  v_fees          numeric;
  v_returns_cost  numeric;
  v_net           numeric;
  v_cpr_id        bigint;
begin
  if p_courier is null or p_cpr_number is null then
    return jsonb_build_object('ok', false, 'error', 'courier and cpr_number are required');
  end if;

  create temp table _cpr (
    tracking_id text primary key,
    is_delivered boolean,
    cod numeric, net numeric, fee numeric, tax numeric, paid_on date
  ) on commit drop;

  insert into _cpr (tracking_id, is_delivered, cod, net, fee, tax, paid_on)
  select distinct on (btrim(r->>'tracking_id'))
         btrim(r->>'tracking_id'),
         coalesce(r->>'status' is null or r->>'status' ~* '^deliver', true),
         nullif(r->>'cod','')::numeric,
         nullif(r->>'net','')::numeric,
         nullif(r->>'fee','')::numeric,
         nullif(r->>'tax','')::numeric,
         coalesce(nullif(r->>'paid_on','')::date, p_cpr_date)
    from jsonb_array_elements(coalesce(p_rows,'[]'::jsonb)) r
   where btrim(coalesce(r->>'tracking_id','')) <> '';

  select count(*), coalesce(sum(cod),0),
         count(*) filter (where is_delivered),
         count(*) filter (where not is_delivered),
         coalesce(sum(net),0),
         coalesce(sum(net) filter (where not is_delivered),0)
    into v_parsed_count, v_parsed_total, v_delivered, v_returned, v_net, v_returns_cost
    from _cpr;

  -- the receipt's own net wins when we have it; ours is the fallback
  v_net := coalesce((p_summary->>'net')::numeric, v_net);

  -- ===================== THE GUARD =====================
  if p_declared_count is not null and v_parsed_count <> p_declared_count then
    return jsonb_build_object('ok', false, 'guard', 'count mismatch',
      'sheet_says', p_declared_count, 'we_parsed', v_parsed_count, 'wrote', 0,
      'meaning', 'The parse disagrees with the file''s own count. Fix the mapping — do not import.');
  end if;

  if p_declared_total is not null and abs(v_parsed_total - p_declared_total) > 1 then
    return jsonb_build_object('ok', false, 'guard', 'COD total mismatch',
      'sheet_says', p_declared_total, 'we_parsed', v_parsed_total,
      'difference', round(v_parsed_total - p_declared_total, 2), 'wrote', 0,
      'meaning', 'Parsed COD does not add up to the declared total. Wrong column, or rows missed.');
  end if;

  select count(*), coalesce(sum(c.net) filter (where c.is_delivered),0),
         coalesce(sum(coalesce(c.fee,0) + coalesce(c.tax,0)),0)
    into v_matched, v_matched_total, v_fees
    from _cpr c join online_logistics l on l.tracking_id = c.tracking_id;

  select coalesce(jsonb_agg(c.tracking_id), '[]'::jsonb) into v_unmatched
    from _cpr c left join online_logistics l on l.tracking_id = c.tracking_id
   where l.tracking_id is null;

  select coalesce(sum(n), 0),
         coalesce(jsonb_object_agg(s, n) filter (where s is not null), '{}'::jsonb)
    into v_corrected, v_from_status
    from (select l.delivery_status as s, count(*) as n
            from _cpr c join online_logistics l on l.tracking_id = c.tracking_id
           where c.is_delivered and coalesce(l.delivery_status,'') <> 'Delivered'
           group by 1) t;

  select count(*) into v_already_paid
    from _cpr c join online_logistics l on l.tracking_id = c.tracking_id
   where c.is_delivered and coalesce(l.payment_status,'') in ('Paid','Received');

  if p_dry_run then
    return jsonb_build_object(
      'ok', true, 'dry_run', true, 'wrote', 0,
      'parsed', v_parsed_count, 'parsed_cod', v_parsed_total,
      'file_says_delivered', v_delivered, 'file_says_returned', v_returned,
      'matched', v_matched, 'unmatched', jsonb_array_length(v_unmatched),
      'unmatched_ids', v_unmatched,
      'would_mark_paid', v_delivered, 'courier_net_total', v_net,
      'net_of_matched', v_matched_total, 'courier_fees', v_fees,
      'returns_cost', v_returns_cost, 'already_paid', v_already_paid,
      'would_correct_to_delivered', v_corrected, 'corrected_from', v_from_status,
      'returns_left_alone', v_returned);
  end if;

  update online_logistics l
     set payment_status  = 'Paid',
         payment_date    = coalesce(c.paid_on, p_cpr_date, current_date),
         cpr_number      = p_cpr_number,
         cpr_net_amount  = coalesce(c.net, l.cpr_net_amount),
         courier_fee     = coalesce(c.fee, l.courier_fee),
         courier_tax     = coalesce(c.tax, l.courier_tax),
         delivery_status = 'Delivered',
         delivery_date   = coalesce(l.delivery_date, c.paid_on, p_cpr_date),
         updated_at      = now()
    from _cpr c
   where l.tracking_id = c.tracking_id and c.is_delivered;

  /* RETURNS: THE SETTLEMENT IS NOW THE RECEIPT.
     The charge is recorded as before, and the payment is still not touched — a
     return was never paid and no settlement makes it income.

     What changed is that the return also stops being chased. A courier does not
     bill for a return trip it has not completed, so a return appearing on a CPR
     is the courier's own written confirmation that the leg is finished. Waiting
     for somebody to additionally confirm the box physically arrived left the
     list full of parcels nobody was pursuing.

     return_closed_reason keeps the two apart, so a parcel closed by a settlement
     is never mistaken for one somebody checked off a shelf. */
  update online_logistics l
     set courier_fee = coalesce(c.fee, l.courier_fee),
         courier_tax = coalesce(c.tax, l.courier_tax),
         cpr_number  = coalesce(l.cpr_number, p_cpr_number),
         return_received_at   = coalesce(l.return_received_at, now()),
         return_closed_reason = coalesce(l.return_closed_reason,
                                  'settled on ' || p_cpr_number),
         updated_at  = now()
    from _cpr c
   where l.tracking_id = c.tracking_id and not c.is_delivered;

  insert into online_cpr (
      cpr_number, courier, cpr_date, amount, orders_count, status,
      declared_count, declared_total, matched_count, matched_total, unmatched,
      gross_total, shipping_charges, gst, wh_income_tax, wh_sales_tax,
      net_total, delivered_count, returned_count, returns_cost, imported_at)
  values (
      p_cpr_number, p_courier, p_cpr_date,
      v_net,                                   -- what the courier actually paid
      v_parsed_count, 'Imported',
      p_declared_count, p_declared_total, v_matched, v_matched_total, v_unmatched,
      (p_summary->>'gross')::numeric, (p_summary->>'shipping')::numeric,
      (p_summary->>'gst')::numeric, (p_summary->>'wh_income')::numeric,
      (p_summary->>'wh_sales')::numeric,
      v_net, v_delivered, v_returned, v_returns_cost, now())
  on conflict (courier, cpr_number) where cpr_number is not null do update
     set cpr_date = excluded.cpr_date, amount = excluded.amount,
         orders_count = excluded.orders_count,
         declared_count = excluded.declared_count, declared_total = excluded.declared_total,
         matched_count = excluded.matched_count, matched_total = excluded.matched_total,
         unmatched = excluded.unmatched, gross_total = excluded.gross_total,
         shipping_charges = excluded.shipping_charges, gst = excluded.gst,
         wh_income_tax = excluded.wh_income_tax, wh_sales_tax = excluded.wh_sales_tax,
         net_total = excluded.net_total, delivered_count = excluded.delivered_count,
         returned_count = excluded.returned_count, returns_cost = excluded.returns_cost,
         imported_at = now()
  returning id into v_cpr_id;

  return jsonb_build_object(
    'ok', true, 'dry_run', false, 'cpr_id', v_cpr_id,
    'parsed', v_parsed_count, 'matched', v_matched,
    'marked_paid', v_delivered, 'courier_net_total', v_net,
    'net_of_matched', v_matched_total,
    'returns_charged', v_returned, 'returns_cost', v_returns_cost,
    'courier_fees', v_fees,
    'corrected_to_delivered', v_corrected, 'corrected_from', v_from_status,
    'unmatched', jsonb_array_length(v_unmatched), 'unmatched_ids', v_unmatched,
    'report', v_delivered || ' paid · ' || v_corrected || ' corrected to Delivered · ' ||
              v_returned || ' returns charged · ' ||
              jsonb_array_length(v_unmatched) || ' not found');
end;
$function$;

-- Signature copied from the definition above, in order: a grant with the
-- arguments guessed would silently target a function that does not exist.
grant execute on function hub_cpr_import(text, text, date, integer, numeric, jsonb, boolean, jsonb) to authenticated;

commit;

-- ===========================================================================
-- VERIFY — import a settlement, then:
--   select return_closed_reason, count(*)
--     from online_logistics
--    where delivery_status in ('Returned','RTS') and return_received_at is not null
--    group by 1;
--
-- 'settled on CPR-...' rows were closed by this. 'aged: ...' by the nightly job.
-- A null reason means somebody physically received it. All three stay separable.
-- ===========================================================================
