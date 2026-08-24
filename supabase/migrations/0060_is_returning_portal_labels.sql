-- 0060_is_returning_portal_labels.sql   (corrected)
--
-- Run this whole file in one go. It ends with a verification row, so you do not
-- need to run anything else afterwards.
--
-- ---------------------------------------------------------------------------
-- WHY THE FIRST VERSION FAILED
--   The regex was built with || across several lines. In PostgreSQL `||` and
--   `~*` share the same precedence and associate left to right, so
--       coalesce(p_raw,'') ~* '(' || 'return...' || ')'
--   parsed as  ( coalesce(p_raw,'') ~* '(' ) || 'return...'  -- a boolean
--   concatenated onto text, which is why OR was handed a text argument.
--   One flat string literal removes the ambiguity entirely.
--
-- WHAT THIS FIXES
--   Two doors write raw_status into online_logistics and they do NOT share a
--   vocabulary:
--     * ownex-sync   writes the API's labels, keyed on `code`
--                    (Return In Progress, Preparing Transit, ...)
--     * Smart import writes the MERCHANT PORTAL's labels from the CSV/PDF export
--                    (Return Initiated, Return Transit Received, ...)
--   `Return Initiated` exists only on the portal side and matched no pattern, so
--   15 parcels still travelling back were reported as already returned -- the
--   version of this bug that stops anyone chasing them.
--
--   Since 0059, `delivery_status = 'RTS'` carries direction as a recorded fact,
--   derived from the courier's movement history rather than from whichever code
--   happens to be current. The raw_status patterns below are now only a FALLBACK
--   for rows that arrived through Smart import and never passed the API path.
--
--   Signature and return type are unchanged -- is_returning(text, text) -> boolean
--   -- so CREATE OR REPLACE is safe and no DROP FUNCTION is needed.
-- ---------------------------------------------------------------------------

create or replace function public.is_returning(p_status text, p_raw text)
returns boolean
language sql
immutable
as $function$
  select p_status = 'RTS'
      or coalesce(p_raw, '') ~* 'return[ _-]?requested|return[ _-]?in[ _-]?progress|return[ _-]?pbag|return[ _-]?de[ _-]?manifested|return[ _-]?initiated|return[ _-]?transit[ _-]?received|return[ _-]?in[ _-]?transit|out[ _-]?for[ _-]?return|returning';
$function$;

-- Deliberately NOT '^return', which would also match the completed state
-- 'Returned' and flip every finished return into out-for-return. Every
-- alternative above is a label that has actually been observed.
-- Flag, never guess.


-- ===========================================================================
-- SELF-CHECK -- proves the function behaves before trusting the dashboard.
-- The `pass` column must read TRUE on every row.
-- ===========================================================================
select label, status, expected,
       is_returning(status, label)              as actual,
       (is_returning(status, label) = expected) as pass
from (values
  ('Return Initiated',        'Returned',   true ),  -- the 15 that were wrong
  ('Return In Progress',      'Returned',   true ),
  ('Return Requested',        'Returned',   true ),
  ('Return Transit Received', 'Returned',   true ),
  ('Transit Received',        'RTS',        true ),  -- direction from 0059
  ('Transit Received',        'In Transit', false),  -- outbound, must stay false
  ('Returned',                'Returned',   false)   -- finished, NOT in motion
) as t(label, status, expected);


-- ===========================================================================
-- FINAL VERIFICATION -- the numbers that matter. This is the last result the
-- editor will show.
--
-- Expect roughly:  delivered 1,596 - returned_received ~326 - out_for_return ~59
--                  transit ~75 - cancelled 27
-- against the OwnEx portal's 1,596 / 319 / 68 / 72.
--
-- If out_for_return comes out near 25 rather than ~59, the edge-function
-- backfill has not finished -- run backfill_return_leg again before concluding
-- anything is broken.
-- ===========================================================================
select * from hub_logistics_summary(null, null, 'ALL', 'OwnEx');
