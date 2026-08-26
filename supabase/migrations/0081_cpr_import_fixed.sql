-- 0081_cpr_import_fixed.sql
--
-- REPLACES hub_cpr_import FROM 0080. Two faults, both found by real data.
--
-- ===========================================================================
-- FAULT 1 — "A CPR CORRECTS STATUS" IS FALSE FOR PostEx.
--
--   0080 assumed a courier only pays for parcels it delivered, so any tracking
--   number appearing in a settlement file must be Delivered. The real PostEx
--   CPR says otherwise:
--
--       STATUS: Delivered 147, Return 55
--
--   PostEx settles RETURNS in the same file, with a negative net — it bills you
--   the shipping for a delivery that failed:
--
--       20205020012618  Return  COD 999.00  NET -249.92
--
--   Under 0080 all 55 would have been flipped to Delivered and marked Paid with
--   a negative amount. Silent, and painful to unwind.
--
--   Both couriers put a status on every row. The file is now believed about
--   what it says, not about what its existence implies:
--
--       Delivered  -> paid, and corrected to Delivered if we thought otherwise
--       anything else -> the charge is recorded; status and payment untouched
--
-- ===========================================================================
-- FAULT 2 — the correction counter counted GROUPS, not parcels.
--
--   The first dry run returned, of itself:
--       "corrected_from": {"Returned": 2},  "would_correct_to_delivered": 1
--
--   Two parcels reported as one. count(*) over a GROUP BY counts the groups —
--   one distinct status — not the rows inside them. sum(n) is the parcel count.
--   Small bug, but it under-reports the single most consequential thing this
--   function does, which is change a status.
--
-- ===========================================================================
-- THE GUARD NOW USES COD, NOT NET
--
--   Both invoices declare their COD total in the header, and only PostEx's net
--   column reconciles cleanly. OwnEx's per-row Net Total omits the invoice-level
--   fuel surcharge (Rs 7,180 on INV-20250018 — exactly 20% of charges), so
--   summing its net rows can never match its own grand total. COD is the figure
--   both state plainly and both add up.
--
--       OwnEx  INV-20250018 : 149 parcels · COD 341,043.84
--       PostEx CPR export   : 202 rows (147 delivered + 55 return) · COD 523,280.68
--
-- Safe to run more than once. Requires 0080.

begin;

create or replace function hub_cpr_import(
  p_courier        text,
  p_cpr_number     text,
  p_cpr_date       date,
  p_declared_count integer,
  p_declared_total numeric,
  p_rows           jsonb,
  p_dry_run        boolean default true
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

  -- distinct on: a sheet listing the same parcel twice must not pay it twice,
  -- and an upsert hitting the same conflict target twice is rejected outright.
  insert into _cpr (tracking_id, is_delivered, cod, net, fee, tax, paid_on)
  select distinct on (btrim(r->>'tracking_id'))
         btrim(r->>'tracking_id'),
         -- Absent status means delivered: a courier settling a parcel in
         -- silence has paid for it. Present status is obeyed literally.
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
         count(*) filter (where not is_delivered)
    into v_parsed_count, v_parsed_total, v_delivered, v_returned
    from _cpr;

  -- ===================== THE GUARD =====================
  -- Checked against COD, which both couriers declare and both foot correctly.
  if p_declared_count is not null and v_parsed_count <> p_declared_count then
    return jsonb_build_object(
      'ok', false, 'guard', 'count mismatch',
      'sheet_says', p_declared_count, 'we_parsed', v_parsed_count, 'wrote', 0,
      'meaning', 'The parse disagrees with the file''s own count. Fix the mapping — do not import.');
  end if;

  if p_declared_total is not null and abs(v_parsed_total - p_declared_total) > 1 then
    return jsonb_build_object(
      'ok', false, 'guard', 'COD total mismatch',
      'sheet_says', p_declared_total, 'we_parsed', v_parsed_total,
      'difference', round(v_parsed_total - p_declared_total, 2), 'wrote', 0,
      'meaning', 'Parsed COD does not add up to the declared total. Wrong column, or rows missed.');
  end if;

  -- ===================== WHAT WE CAN SEE =====================
  select count(*), coalesce(sum(c.net) filter (where c.is_delivered),0),
         coalesce(sum(coalesce(c.fee,0) + coalesce(c.tax,0)),0)
    into v_matched, v_matched_total, v_fees
    from _cpr c join online_logistics l on l.tracking_id = c.tracking_id;

  select coalesce(jsonb_agg(c.tracking_id), '[]'::jsonb) into v_unmatched
    from _cpr c left join online_logistics l on l.tracking_id = c.tracking_id
   where l.tracking_id is null;

  -- Only DELIVERED rows can correct a status. FAULT 2: sum(n), not count(*).
  select coalesce(sum(n), 0),
         coalesce(jsonb_object_agg(s, n) filter (where s is not null), '{}'::jsonb)
    into v_corrected, v_from_status
    from (select l.delivery_status as s, count(*) as n
            from _cpr c join online_logistics l on l.tracking_id = c.tracking_id
           where c.is_delivered
             and coalesce(l.delivery_status,'') <> 'Delivered'
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
      'would_mark_paid', v_delivered, 'net_to_you', v_matched_total,
      'courier_fees', v_fees, 'already_paid', v_already_paid,
      'would_correct_to_delivered', v_corrected, 'corrected_from', v_from_status,
      'returns_left_alone', v_returned);
  end if;

  -- ===================== WRITE 1: the delivered =====================
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

  -- ===================== WRITE 2: the returns =====================
  -- The charge is real money and belongs on the parcel. The STATUS is not
  -- touched and payment_status is not set — the courier billed us for this
  -- parcel, it did not pay us for it.
  update online_logistics l
     set courier_fee = coalesce(c.fee, l.courier_fee),
         courier_tax = coalesce(c.tax, l.courier_tax),
         cpr_number  = coalesce(l.cpr_number, p_cpr_number),
         updated_at  = now()
    from _cpr c
   where l.tracking_id = c.tracking_id and not c.is_delivered;

  insert into online_cpr (cpr_number, courier, cpr_date, amount, orders_count, status,
                          declared_count, declared_total, matched_count, matched_total,
                          unmatched, imported_at)
  values (p_cpr_number, p_courier, p_cpr_date, v_matched_total, v_delivered, 'Imported',
          p_declared_count, p_declared_total, v_matched, v_matched_total, v_unmatched, now())
  on conflict (courier, cpr_number) do update
     set cpr_date = excluded.cpr_date, amount = excluded.amount,
         orders_count = excluded.orders_count, declared_count = excluded.declared_count,
         declared_total = excluded.declared_total, matched_count = excluded.matched_count,
         matched_total = excluded.matched_total, unmatched = excluded.unmatched,
         imported_at = now()
  returning id into v_cpr_id;

  return jsonb_build_object(
    'ok', true, 'dry_run', false, 'cpr_id', v_cpr_id,
    'parsed', v_parsed_count, 'matched', v_matched,
    'marked_paid', v_delivered, 'net_to_you', v_matched_total,
    'returns_charged', v_returned, 'courier_fees', v_fees,
    'corrected_to_delivered', v_corrected, 'corrected_from', v_from_status,
    'unmatched', jsonb_array_length(v_unmatched), 'unmatched_ids', v_unmatched,
    'report', v_delivered || ' paid · ' || v_corrected || ' corrected to Delivered · ' ||
              v_returned || ' returns charged · ' ||
              jsonb_array_length(v_unmatched) || ' not found');
end;
$function$;

grant execute on function hub_cpr_import(text, text, date, integer, numeric, jsonb, boolean) to authenticated;

commit;

-- ===========================================================================
-- THE TWO REAL FILES, MEASURED — use these as the guard values.
--
--   OwnEx  INV-20250018  9 Aug 2026
--       149 rows, all Delivered · COD 341,043.84 · charges 35,900.00
--       NOTE the invoice adds a Rs 7,180 fuel surcharge (20% of charges) at
--       INVOICE level, not per row, so per-row Net Total sums to -305,143.84
--       while the Grand Total says -297,963.84. Per-row net cannot reconcile;
--       guard on COD.
--       net per row = COD − Charges − Tax
--
--   PostEx CPR_Transactions_2026-08-25  25 Aug 2026
--       202 rows: 147 Delivered + 55 Return · COD 523,280.68
--       net per row = COD − SHIPPING_CHARGES − GST − WH_INCOME_TAX − WH_SALES_TAX
--       verified exact on row 1: 2299.00 − 222.40 − 35.58 − 45.98 − 45.98 = 1949.06
--       fee to store  = SHIPPING_CHARGES + GST
--       tax to store  = WH_INCOME_TAX + WH_SALES_TAX
--       Delivered net +315,941.37 · Return net −15,333.80
--
-- COLUMN MAP
--   PostEx CSV : TRACKING_NUMBER · STATUS · COD_AMOUNT · NET_AMOUNT
--                SHIPPING_CHARGES + GST -> fee · both WH taxes -> tax · "D/R Date"
--   OwnEx PDF  : Tracking No · Status · COD Amount · Net Total (abs)
--                Charges -> fee · Tax -> tax · D/R Date
--
-- CAUTION on OwnEx: Order Ref is not always an order number — row 37 of
-- INV-20250018 reads "tayyaba". Key on tracking number only, never Order Ref.
-- ===========================================================================
