-- 0122_retail_sale_lines_hash_unique.sql
--
-- retail_sale_lines.line_hash was NOT unique. Found by testing 0118 rather than
-- by reading, which is the only way this kind of thing is ever found.
--
-- WHAT WAS WRONG
--   The port created `retail_sale_lines_hash_idx` as a PLAIN btree index. In
--   Grohub the same column carried two unique constraints —
--   sale_lines_line_hash_key and sale_lines_line_hash_uniq — and that
--   uniqueness is the entire idempotency guarantee of the sales import. A plain
--   index makes lookups fast and prevents nothing.
--
-- WHY IT MATTERS MORE THAN IT LOOKS
--   Two separate things break without it:
--
--   1. Re-uploading a Nimbus file duplicates every line in it. Sales double,
--      commissions double, the cash book stops agreeing with the till, and
--      nothing anywhere reports an error — the import says it succeeded,
--      because it did.
--
--   2. `upsert(..., { onConflict: 'line_hash' })` — which is what the import
--      screen issues — REQUIRES a unique index on that column. Postgres has
--      nothing to resolve the conflict against and rejects the statement, so
--      the import does not merely duplicate, it fails outright.
--
--   This is the same failure Grohub already paid for once with expenses
--   (19,770 -> 39,540 -> 59,310 -> 79,080). The fix there was a unique
--   dedupe_key. This is that fix, for sale lines.
--
-- ON EXISTING DUPLICATES
--   The table is empty today, so this is free. It is written to survive a
--   non-empty table anyway: duplicates are collapsed to the lowest id first,
--   because a unique index cannot be built over rows that already violate it,
--   and failing here with "could not create unique index" and no explanation
--   is a bad way to find out.
--
-- Safe to run more than once.

begin;

-- Collapse any existing duplicates, keeping the first row of each hash.
-- NULL line_hash rows are left alone: a unique index ignores NULLs, and a row
-- without a hash is a manual entry that was never part of an import.
delete from retail_sale_lines a
 using retail_sale_lines b
 where a.line_hash is not null
   and a.line_hash = b.line_hash
   and a.id > b.id;

-- The plain index is redundant once a unique one exists on the same column.
drop index if exists retail_sale_lines_hash_idx;

create unique index if not exists retail_sale_lines_line_hash_uniq
  on retail_sale_lines (line_hash);

-- Grohub also indexed (branch_id, receipt_txn); the receipt drill-down on the
-- sales screen is a sequential scan without it.
create index if not exists retail_sale_lines_receipt_idx
  on retail_sale_lines (branch_id, receipt_txn);

-- Same omission, same consequence, on the card settlement side: the screen
-- looks up by branch and sale day and there was no index for it.
create index if not exists retail_card_settlements_sale_date_idx
  on retail_card_settlements (branch_id, sale_date);

commit;

-- ===========================================================================
-- VERIFY
-- ===========================================================================
-- -- Must report UNIQUE.
-- select indexname, indexdef from pg_indexes
--  where schemaname='public' and tablename='retail_sale_lines' and indexdef ilike '%line_hash%';
--
-- -- The second insert must fail with a unique violation.
-- insert into retail_sale_lines (sale_date, item_code, sales, line_hash)
--   values (current_date, 'X', 1, 'DUPE_CHECK');
-- insert into retail_sale_lines (sale_date, item_code, sales, line_hash)
--   values (current_date, 'X', 1, 'DUPE_CHECK');
-- delete from retail_sale_lines where line_hash = 'DUPE_CHECK';
-- ===========================================================================
