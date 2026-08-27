-- 0082_cpr_conflict_fix.sql
--
-- FIXES: "there is no unique or exclusion constraint matching the ON CONFLICT
--         specification" — every one of 93 imports refused.
--
-- WHAT WENT WRONG
--   0080 created the de-duplication index as a PARTIAL index:
--
--       create unique index online_cpr_number_courier_uidx
--         on online_cpr (courier, cpr_number)
--        where cpr_number is not null;          <- the predicate
--
--   and hub_cpr_import then said:
--
--       on conflict (courier, cpr_number) do update ...
--
--   Postgres will not infer a partial index from a bare column list. The
--   conflict clause has to repeat the predicate, or it matches nothing and the
--   insert is rejected outright. One missing WHERE.
--
-- NOTHING WAS WRITTEN BY THE FAILED RUN
--   The insert is the LAST statement in the function, after both parcel
--   updates. An uncaught exception rolls the whole function call back, so all
--   93 attempts undid themselves. Confirm before importing again:
--
--       select count(*) from online_cpr;                                    -- 0
--       select count(*) from online_logistics where cpr_number is not null; -- 0
--
-- WHY THE DRY RUN DID NOT CATCH IT
--   p_dry_run returns before reaching the insert, so the one statement that was
--   broken was the one statement the dry run never executed. The guard checked
--   the DATA and was right about it; it could not check the WRITE.
--   Worth remembering: a dry run proves the input, not the plumbing.
--
-- Safe to run more than once. Requires 0080 and 0081.

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
  on conflict (courier, cpr_number) where cpr_number is not null do update
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
-- VERIFY — a real import of two rows, then undo it.
-- ===========================================================================
-- select hub_cpr_import('PostEx','TEST-004','2026-08-25', 2, 3298.00,
-- '[{"tracking_id":"26205020012983","status":"Delivered","cod":2299.0,"net":1949.06,"fee":257.98,"tax":91.96},
--   {"tracking_id":"20205020012618","status":"Return","cod":999.0,"net":-249.92,"fee":249.92,"tax":0.0}]'::jsonb,
-- false);
--
-- -- run it TWICE. The second call must update the same batch, not add one:
-- select count(*) from online_cpr where cpr_number = 'TEST-004';   -- must be 1
--
-- -- then clean up before the real import:
-- delete from online_cpr where cpr_number = 'TEST-004';
-- update online_logistics set payment_status = null, payment_date = null,
--        cpr_number = null, cpr_net_amount = null
--  where cpr_number = 'TEST-004';
