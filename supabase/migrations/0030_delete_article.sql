-- =====================================================================
-- HEAD OFFICE ERP — Migration 0030: Delete article
-- SAFE TO RUN MULTIPLE TIMES (idempotent). Depends on 0023, 0024.
--
-- Permanently removes an article and its recipe (article_bom cascades).
-- Blocked when the article is used by any production order, so order
-- history stays intact — in that case, deactivate the article instead.
-- Gated by production.manage (super admin bypasses).
-- =====================================================================

create or replace function delete_article(p_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not has_permission('production.manage') then
    raise exception 'You do not have permission to delete articles.';
  end if;
  if not exists (select 1 from articles where id = p_id) then
    raise exception 'Article not found.';
  end if;
  if exists (select 1 from production_orders where article_id = p_id) then
    raise exception 'This article is used by one or more production orders, so it cannot be deleted. Set it to Inactive instead.';
  end if;

  delete from articles where id = p_id;   -- article_bom rows cascade automatically
end; $$;
grant execute on function delete_article(uuid) to authenticated;

-- =====================================================================
-- END OF MIGRATION 0030 (idempotent)
-- =====================================================================
