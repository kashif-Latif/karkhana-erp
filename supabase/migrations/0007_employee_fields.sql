-- =====================================================================
-- HEAD OFFICE ERP — Migration 0007: extra employee fields (Day 2+)
-- SAFE TO RUN MULTIPLE TIMES (idempotent). Just adds columns to the
-- existing employees table — RLS + audit already cover them.
-- No file uploads yet (added later with proper storage/privacy handling).
-- =====================================================================

alter table employees
  add column if not exists guardian_name   text,          -- father / husband name
  add column if not exists dob             date,
  add column if not exists gender          text,           -- Male / Female / Other
  add column if not exists address         text,
  add column if not exists emergency_name  text,
  add column if not exists emergency_phone text,
  add column if not exists employment_type text,           -- Permanent / Contract / Daily-wage
  add column if not exists pay_type        text,           -- Piece-rate / Monthly salary / Daily wage
  add column if not exists pay_amount      numeric(14,2),  -- base salary or daily wage (PKR)
  add column if not exists payment_method  text,           -- Cash / Bank
  add column if not exists bank_name       text,
  add column if not exists bank_account    text;

-- =====================================================================
-- END OF MIGRATION 0007 (idempotent)
-- =====================================================================
