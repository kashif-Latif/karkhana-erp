-- =====================================================================
-- HEAD OFFICE ERP — Migration 0023: Articles + Recipe (Bill of Materials)
-- SAFE TO RUN MULTIPLE TIMES (idempotent). Depends on 0001, 0005.
--
-- articles      = the garments you make (Kids Shirt, Men Trouser, …)
-- article_bom   = the RECIPE per article: how much of each material one
--                 piece needs (e.g. 1 Kids Shirt = 0.25 KG Fabric + 1 Zip).
--                 This is what powers automatic material calculation when
--                 a production order is placed.
-- Gated by production.manage (edit) / production.view (read).
-- =====================================================================

create table if not exists articles (
  id           uuid primary key default gen_random_uuid(),
  code         text unique,                 -- ART-YYYY-000001
  name         text not null,
  garment_type text,                         -- Shirt / Trouser / …
  audience     text,                         -- Kids / Men / Ladies / Unisex
  size         text,                         -- optional (S/M/L or free text)
  notes        text,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references auth.users(id)
);

create table if not exists article_bom (
  id          uuid primary key default gen_random_uuid(),
  article_id  uuid not null references articles(id) on delete cascade,
  group_id    uuid not null references material_groups(id),
  quantity    numeric(16,4) not null,        -- per ONE piece
  unit_id     uuid not null references units(id),
  note        text
);
create index if not exists idx_article_bom_article on article_bom(article_id);

drop trigger if exists trg_audit_articles on articles;
create trigger trg_audit_articles after insert or update or delete on articles for each row execute function audit_row_change();

alter table articles    enable row level security;
alter table article_bom enable row level security;
drop policy if exists articles_read on articles;
drop policy if exists bom_read on article_bom;
create policy articles_read on articles    for select using (has_permission('production.view'));
create policy bom_read      on article_bom for select using (has_permission('production.view'));
grant select on articles, article_bom to authenticated;

-- ---------- create / update article ----------
create or replace function create_article(
  p_name text, p_garment_type text, p_audience text, p_size text, p_notes text
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  if not has_permission('production.manage') then raise exception 'You do not have permission to manage articles.'; end if;
  if coalesce(trim(p_name),'') = '' then raise exception 'Enter an article name.'; end if;
  insert into articles (code, name, garment_type, audience, size, notes, created_by)
  values (next_document_number('ART','ART'), trim(p_name), nullif(trim(p_garment_type),''), nullif(trim(p_audience),''), nullif(trim(p_size),''), nullif(trim(p_notes),''), auth.uid())
  returning id into v_id;
  return v_id;
end; $$;
grant execute on function create_article(text,text,text,text,text) to authenticated;

create or replace function update_article(
  p_id uuid, p_name text, p_garment_type text, p_audience text, p_size text, p_notes text, p_is_active boolean
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not has_permission('production.manage') then raise exception 'You do not have permission to manage articles.'; end if;
  if not exists (select 1 from articles where id = p_id) then raise exception 'Article not found.'; end if;
  if coalesce(trim(p_name),'') = '' then raise exception 'Enter an article name.'; end if;
  update articles set
    name = trim(p_name), garment_type = nullif(trim(p_garment_type),''), audience = nullif(trim(p_audience),''),
    size = nullif(trim(p_size),''), notes = nullif(trim(p_notes),''), is_active = coalesce(p_is_active, true), updated_at = now()
  where id = p_id;
end; $$;
grant execute on function update_article(uuid,text,text,text,text,text,boolean) to authenticated;

-- ---------- set an article's recipe (replaces all lines) ----------
create or replace function set_article_bom(p_article_id uuid, p_lines jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_line jsonb; v_group uuid; v_unit uuid; v_qty numeric;
begin
  if not has_permission('production.manage') then raise exception 'You do not have permission to manage recipes.'; end if;
  if not exists (select 1 from articles where id = p_article_id) then raise exception 'Article not found.'; end if;

  delete from article_bom where article_id = p_article_id;
  if p_lines is null then return; end if;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_group := (v_line->>'group_id')::uuid;
    v_unit  := (v_line->>'unit_id')::uuid;
    v_qty   := (v_line->>'quantity')::numeric;
    if v_group is null or not exists (select 1 from material_groups where id = v_group) then raise exception 'A recipe line has an invalid material.'; end if;
    if v_unit is null or not exists (select 1 from units where id = v_unit) then raise exception 'A recipe line has an invalid unit.'; end if;
    if v_qty is null or v_qty <= 0 then raise exception 'Each recipe line needs a quantity greater than zero.'; end if;
    insert into article_bom (article_id, group_id, quantity, unit_id, note)
    values (p_article_id, v_group, v_qty, v_unit, nullif(v_line->>'note',''));
  end loop;
end; $$;
grant execute on function set_article_bom(uuid, jsonb) to authenticated;

-- =====================================================================
-- END OF MIGRATION 0023 (idempotent)
-- =====================================================================
