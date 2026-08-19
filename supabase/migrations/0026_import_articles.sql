-- =====================================================================
-- HEAD OFFICE ERP — Migration 0026: Import articles (garments)
-- SAFE TO RUN MULTIPLE TIMES (idempotent). Depends on 0023.
--
-- Loads the 14 finished garments from the CEO's Design_Consumption sheet,
-- using the CEO's own article codes (MS-001, MT-001, …) so they match the
-- rest of his system. Re-running never duplicates (matched on code).
-- Recipes + process rates are imported in the next migrations.
-- =====================================================================

insert into articles (code, name, garment_type, audience, size, is_active)
select x.code, x.name, x.gtype, x.aud, nullif(x.sz, ''), true
from (values
  ('MS-001',   'Men Shirt',                          'Shirt',      'Men',    ''),
  ('MT-001',   'Men Trouser',                        'Trouser',    'Men',    ''),
  ('MTS-001',  'Men Tracksuit',                      'Tracksuit',  'Men',    ''),
  ('LS-001',   'Ladies Shirt',                       'Shirt',      'Ladies', ''),
  ('LTP-001',  'Ladies Trouser with Pocket',         'Trouser',    'Ladies', ''),
  ('LTN-001',  'Ladies Trouser no Pocket',           'Trouser',    'Ladies', ''),
  ('LNS-001',  'Ladies Night Suit no Pocket',        'Night Suit', 'Ladies', ''),
  ('KS-2-6',   'Kids Shirt 2-6Y',                    'Shirt',      'Kids',   '2-6Y'),
  ('KL-2-6',   'Kids Leggy 2-6Y',                    'Leggy',      'Kids',   '2-6Y'),
  ('CS-6-14',  'Child Shirt (6-14Y)',                'Shirt',      'Kids',   '6-14Y'),
  ('CTP-6-14', 'Child Trouser with Pocket (6-14Y)',  'Trouser',    'Kids',   '6-14Y'),
  ('KTS-2-6',  'Kids Tracksuit (2-6Y)',              'Tracksuit',  'Kids',   '2-6Y'),
  ('CTS-6-14', 'Child Tracksuit (6-14Y)',            'Tracksuit',  'Kids',   '6-14Y'),
  ('KN-1-7',   'Kids Nicker (1-7Y)',                 'Nicker',     'Kids',   '1-7Y')
) as x(code, name, gtype, aud, sz)
where not exists (select 1 from articles a where a.code = x.code);

-- =====================================================================
-- END OF MIGRATION 0026 (idempotent)
-- =====================================================================
