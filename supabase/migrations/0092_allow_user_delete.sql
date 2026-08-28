-- 0092_allow_user_delete.sql
--
-- "Database error deleting user" — a foreign key refusing the delete.
--
-- WHY THE DIAGNOSTIC DID NOT SHOW IT
--   information_schema.constraint_column_usage only lists a constraint if you
--   own the table it POINTS AT. auth.users belongs to Supabase's auth role, not
--   to postgres, so any foreign key into it is invisible there while still
--   perfectly capable of blocking a delete. The query came back with one row,
--   said everything cascades, and was wrong.
--
--   pg_catalog shows them regardless of ownership, which is what this uses.
--
-- WHAT IS ACTUALLY HOLDING ON
--   audit_logs has one row for that account. An audit trail is SUPPOSED to
--   outlive the account — the whole point is to record what somebody did after
--   they are gone. So the reference is right and the delete rule is wrong.
--
-- CASCADE WOULD BE THE WRONG FIX
--   It would delete the history along with the account. Somebody could remove
--   their own trail by removing a user. SET NULL keeps every audit row and only
--   forgets which account it belonged to, which is the honest outcome: the
--   action happened, the actor no longer exists.
--
-- This walks every foreign key on a public table pointing at auth.users or
-- app_users, and switches the blocking ones to SET NULL. It names each one it
-- changes so there is no mystery about what moved.
--
-- Safe to run more than once.

begin;

do $do$
declare
  r record;
  v_changed integer := 0;
begin
  for r in
    select con.conname                              as constraint_name,
           src_ns.nspname || '.' || src.relname     as src_table,
           src.oid                                  as src_oid,
           att.attname                              as src_column,
           att.attnotnull                           as is_not_null,
           tgt_ns.nspname || '.' || tgt.relname     as tgt_table,
           tgt_att.attname                          as tgt_column,
           con.confdeltype                          as del_rule
      from pg_constraint con
      join pg_class      src     on src.oid = con.conrelid
      join pg_namespace  src_ns  on src_ns.oid = src.relnamespace
      join pg_class      tgt     on tgt.oid = con.confrelid
      join pg_namespace  tgt_ns  on tgt_ns.oid = tgt.relnamespace
      join pg_attribute  att     on att.attrelid = con.conrelid
                                and att.attnum = con.conkey[1]
      join pg_attribute  tgt_att on tgt_att.attrelid = con.confrelid
                                and tgt_att.attnum = con.confkey[1]
     where con.contype = 'f'
       and src_ns.nspname = 'public'
       and tgt.relname in ('users', 'app_users')
       -- a = no action, r = restrict. Both block. c = cascade, n = set null.
       and con.confdeltype in ('a', 'r')
  loop
    -- SET NULL needs a nullable column. A NOT NULL user_id would have to
    -- cascade instead, and cascading an audit row is exactly what we are
    -- avoiding — so it is reported rather than forced.
    if r.is_not_null then
      raise notice '0092: SKIPPED %.% — column is NOT NULL, cannot SET NULL. Decide deliberately.',
                   r.src_table, r.src_column;
      continue;
    end if;

    execute format('alter table %s drop constraint %I', r.src_table, r.constraint_name);
    execute format('alter table %s add constraint %I foreign key (%I) references %s(%I) on delete set null',
                   r.src_table, r.constraint_name, r.src_column, r.tgt_table, r.tgt_column);
    v_changed := v_changed + 1;
    raise notice '0092: %.% -> % now SET NULL on delete', r.src_table, r.src_column, r.tgt_table;
  end loop;

  raise notice '0092: % constraint(s) changed', v_changed;
end
$do$;

commit;

-- ===========================================================================
-- VERIFY — every foreign key pointing at a user, read from pg_catalog so
-- nothing is hidden by ownership this time.
-- ===========================================================================
-- select src_ns.nspname || '.' || src.relname as referencing_table,
--        att.attname                          as column_name,
--        tgt.relname                          as points_at,
--        case con.confdeltype when 'a' then 'NO ACTION — blocks'
--                             when 'r' then 'RESTRICT — blocks'
--                             when 'c' then 'CASCADE — child removed'
--                             when 'n' then 'SET NULL — row kept'
--                             else con.confdeltype::text end as on_delete
--   from pg_constraint con
--   join pg_class src        on src.oid = con.conrelid
--   join pg_namespace src_ns on src_ns.oid = src.relnamespace
--   join pg_class tgt        on tgt.oid = con.confrelid
--   join pg_attribute att    on att.attrelid = con.conrelid and att.attnum = con.conkey[1]
--  where con.contype = 'f'
--    and tgt.relname in ('users', 'app_users')
--  order by 1;
--
-- Nothing should say "blocks". Then try removing the account again.
--
-- If it STILL fails, the audit row is the thing to look at directly:
--   select * from audit_logs where user_id = '9de0e2db-ef78-4f6a-89f3-98ee6645a4fb';
-- ===========================================================================
