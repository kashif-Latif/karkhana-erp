-- =====================================================================
-- HEAD OFFICE ERP — Migration 0028: Import recipes (Bill of Materials)
-- SAFE TO RUN MULTIPLE TIMES (idempotent). Depends on 0025, 0026, 0027.
--
-- Loads the per-piece recipe for all 14 garments from Design_Consumption:
--   Fabric(KG), Thread(KG), Sticker Men/Ladies/Kids(KG), Packing(KG),
--   Zip 6"/8"(pcs). Elastic is intentionally excluded (not used).
--   RUN 0025 FIRST (it creates the sticker categories + zip sizes).
-- =====================================================================

do $$
declare
  v_fab uuid; v_thr uuid; v_stk uuid; v_pkg uuid; v_zip uuid;
  v_kg uuid; v_pcs uuid; v_men uuid; v_ladies uuid; v_kids uuid; v_z6 uuid; v_z8 uuid; a uuid;
begin
  select id into v_fab from material_groups where code='FAB' or lower(name)='jersey fabric' or lower(name)='fabric' limit 1;
  select id into v_thr from material_groups where code='THR' or lower(name) like '%thread%' limit 1;
  select id into v_stk from material_groups where code='STK' or lower(name)='sticker' limit 1;
  select id into v_pkg from material_groups where code='PKG' or lower(name) like 'packing%' limit 1;
  select id into v_zip from material_groups where code='ZIP' or lower(name)='zip' limit 1;
  select id into v_kg from units where lower(symbol)='kg' or lower(name) like 'kilo%' limit 1;
  select id into v_pcs from units where lower(symbol)='pcs' or lower(name) like 'piece%' limit 1;
  select id into v_men from material_categories where lower(name)='men' and group_id=v_stk limit 1;
  select id into v_ladies from material_categories where lower(name)='ladies' and group_id=v_stk limit 1;
  select id into v_kids from material_categories where lower(name)='kids' and group_id=v_stk limit 1;
  select id into v_z6 from sizes where lower(name)='6 inch' limit 1;
  select id into v_z8 from sizes where lower(name)='8 inch' limit 1;

  delete from article_bom where article_id in (select id from articles where code in ('MS-001', 'MT-001', 'MTS-001', 'LS-001', 'LTP-001', 'LTN-001', 'LNS-001', 'KS-2-6', 'KL-2-6', 'CS-6-14', 'CTP-6-14', 'KTS-2-6', 'CTS-6-14', 'KN-1-7'));

  select id into a from articles where code='MS-001';
  if a is not null then insert into article_bom (article_id, group_id, category_id, size_id, quantity, unit_id) values
    (a, v_fab, null, null, 0.25, v_kg),
    (a, v_thr, null, null, 0.01, v_kg),
    (a, v_stk, v_men, null, 0.001, v_kg),
    (a, v_pkg, null, null, 0.01, v_kg);
  end if;

  select id into a from articles where code='MT-001';
  if a is not null then insert into article_bom (article_id, group_id, category_id, size_id, quantity, unit_id) values
    (a, v_fab, null, null, 0.333333, v_kg),
    (a, v_thr, null, null, 0.01, v_kg),
    (a, v_stk, v_men, null, 0.001, v_kg),
    (a, v_pkg, null, null, 0.01, v_kg),
    (a, v_zip, null, v_z8, 1, v_pcs);
  end if;

  select id into a from articles where code='MTS-001';
  if a is not null then insert into article_bom (article_id, group_id, category_id, size_id, quantity, unit_id) values
    (a, v_fab, null, null, 0.666667, v_kg),
    (a, v_thr, null, null, 0.02, v_kg),
    (a, v_stk, v_men, null, 0.001, v_kg),
    (a, v_pkg, null, null, 0.01, v_kg),
    (a, v_zip, null, v_z8, 1, v_pcs);
  end if;

  select id into a from articles where code='LS-001';
  if a is not null then insert into article_bom (article_id, group_id, category_id, size_id, quantity, unit_id) values
    (a, v_fab, null, null, 0.235294, v_kg),
    (a, v_thr, null, null, 0.01, v_kg),
    (a, v_stk, v_ladies, null, 0.001, v_kg),
    (a, v_pkg, null, null, 0.01, v_kg);
  end if;

  select id into a from articles where code='LTP-001';
  if a is not null then insert into article_bom (article_id, group_id, category_id, size_id, quantity, unit_id) values
    (a, v_fab, null, null, 0.307692, v_kg),
    (a, v_thr, null, null, 0.01, v_kg),
    (a, v_stk, v_ladies, null, 0.001, v_kg),
    (a, v_pkg, null, null, 0.01, v_kg),
    (a, v_zip, null, v_z8, 1, v_pcs);
  end if;

  select id into a from articles where code='LTN-001';
  if a is not null then insert into article_bom (article_id, group_id, category_id, size_id, quantity, unit_id) values
    (a, v_fab, null, null, 0.307692, v_kg),
    (a, v_thr, null, null, 0.01, v_kg),
    (a, v_stk, v_ladies, null, 0.001, v_kg),
    (a, v_pkg, null, null, 0.01, v_kg);
  end if;

  select id into a from articles where code='LNS-001';
  if a is not null then insert into article_bom (article_id, group_id, category_id, size_id, quantity, unit_id) values
    (a, v_fab, null, null, 0.5, v_kg),
    (a, v_thr, null, null, 0.02, v_kg),
    (a, v_stk, v_ladies, null, 0.001, v_kg),
    (a, v_pkg, null, null, 0.01, v_kg);
  end if;

  select id into a from articles where code='KS-2-6';
  if a is not null then insert into article_bom (article_id, group_id, category_id, size_id, quantity, unit_id) values
    (a, v_fab, null, null, 0.0952381, v_kg),
    (a, v_thr, null, null, 0.007, v_kg),
    (a, v_stk, v_kids, null, 0.001, v_kg),
    (a, v_pkg, null, null, 0.01, v_kg);
  end if;

  select id into a from articles where code='KL-2-6';
  if a is not null then insert into article_bom (article_id, group_id, category_id, size_id, quantity, unit_id) values
    (a, v_fab, null, null, 0.0952381, v_kg),
    (a, v_thr, null, null, 0.007, v_kg),
    (a, v_stk, v_kids, null, 0.001, v_kg),
    (a, v_pkg, null, null, 0.01, v_kg);
  end if;

  select id into a from articles where code='CS-6-14';
  if a is not null then insert into article_bom (article_id, group_id, category_id, size_id, quantity, unit_id) values
    (a, v_fab, null, null, 0.181818, v_kg),
    (a, v_thr, null, null, 0.007, v_kg),
    (a, v_stk, v_kids, null, 0.001, v_kg),
    (a, v_pkg, null, null, 0.01, v_kg);
  end if;

  select id into a from articles where code='CTP-6-14';
  if a is not null then insert into article_bom (article_id, group_id, category_id, size_id, quantity, unit_id) values
    (a, v_fab, null, null, 0.222222, v_kg),
    (a, v_thr, null, null, 0.007, v_kg),
    (a, v_stk, v_kids, null, 0.001, v_kg),
    (a, v_pkg, null, null, 0.01, v_kg),
    (a, v_zip, null, v_z6, 1, v_pcs);
  end if;

  select id into a from articles where code='KTS-2-6';
  if a is not null then insert into article_bom (article_id, group_id, category_id, size_id, quantity, unit_id) values
    (a, v_fab, null, null, 0.235294, v_kg),
    (a, v_thr, null, null, 0.014, v_kg),
    (a, v_stk, v_kids, null, 0.001, v_kg),
    (a, v_pkg, null, null, 0.01, v_kg),
    (a, v_zip, null, v_z6, 1, v_pcs);
  end if;

  select id into a from articles where code='CTS-6-14';
  if a is not null then insert into article_bom (article_id, group_id, category_id, size_id, quantity, unit_id) values
    (a, v_fab, null, null, 0.4, v_kg),
    (a, v_thr, null, null, 0.014, v_kg),
    (a, v_stk, v_kids, null, 0.001, v_kg),
    (a, v_pkg, null, null, 0.01, v_kg),
    (a, v_zip, null, v_z6, 1, v_pcs);
  end if;

  select id into a from articles where code='KN-1-7';
  if a is not null then insert into article_bom (article_id, group_id, category_id, size_id, quantity, unit_id) values
    (a, v_fab, null, null, 0.1, v_kg),
    (a, v_thr, null, null, 0.014, v_kg),
    (a, v_pkg, null, null, 0.01, v_kg);
  end if;

end $$;

-- END OF MIGRATION 0028 (idempotent)
