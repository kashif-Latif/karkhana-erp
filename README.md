# Head Office ERP

Raw-material inventory, production workflow, and employee piece-rate management
for a garment/manufacturing head office. Built to be secure, real-time, and
serverless (no self-managed backend).

- **Currency:** PKR · **Timezone:** Asia/Karachi (stored UTC, displayed local)
- **Frontend:** Next.js + React + TypeScript + Tailwind + shadcn/ui → Netlify
- **Backend:** Supabase — PostgreSQL + Auth + RLS + RPC functions + Realtime + Edge Functions
- **No** FastAPI / VPS / Redis / Docker. Nothing extra to run, pay for, or secure.

## Security model (why this is production-grade)

Security lives in the **database**, never in the browser:

1. **Supabase Auth** — hashed passwords, sessions, lockout, admin-creates-users
   (no public signup), optional 2FA.
2. **Every write is a PostgreSQL function** running in a locked transaction. The
   client never writes stock balances or bypasses a rule. The database enforces
   negative-stock prevention, atomic posting, and an immutable ledger.
3. **Row Level Security (RLS)** + `has_permission()` enforce roles at the data
   layer — a Storekeeper *cannot* read payroll or the audit trail; a Supervisor
   sees only their department; Admin sees everything. Enforced, not hidden.
4. **Append-only audit log** — who / what / before / after / when, on every change.

Encryption posture: TLS in transit + Supabase at-rest encryption + RBAC + audit.
(Sensitive columns like CNIC/salary can add column-level encryption later.)

## Build phases (module by module — not all at once)

| Phase | Scope | Status |
|---|---|---|
| **1. Foundation** | Auth · users · roles/permissions · departments · audit · numbering · dashboard shell | 🟡 in progress |
| 2. Master data | Suppliers · materials · categories · colors · sizes · units · designations · employees | ⏳ |
| 3. Raw-material inventory *(highest priority)* | GRN · stock ledger · balances · rate history · issue/return/transfer/adjust/wastage · reports | ⏳ |
| 4. Production | Production orders · cutting → stitching → clipping → iron → QA/QC → packing · WIP | ⏳ |
| 5. Piece-rate | Operations · piece rates · daily production entry · approvals · earnings ledger · payroll | ⏳ |
| 6. Reporting & hardening | Reports · reconciliation · security audit · backups · deployment | ⏳ |

## Phase 1 — what's in this repo so far

- `supabase/migrations/0001_core_foundation.sql` — identity, RBAC, departments,
  audit framework, concurrency-safe document numbering, all RLS policies, and seed
  data (8 roles, 25 permissions, role grants, 5 departments). **Validated against
  PostgreSQL 16.**
- `docs/permission-matrix.md` — the roles × permissions reference.

## Setup (Phase 1)

1. **Apply the migration** to the target Supabase project — either via the SQL
   editor (paste `0001_core_foundation.sql`) or the Supabase CLI (`supabase db push`).
2. **Create your first login:** Dashboard → Authentication → *Add user* (email + password).
3. **Promote them to Super Admin** — in the SQL editor:
   ```sql
   select bootstrap_super_admin('owner@yourcompany.com', 'Owner Name');
   ```
4. That account can now sign in and (once the app UI lands) create every other user
   and assign roles. No other account can self-register.

## What's next in Phase 1

- Next.js app skeleton on your existing Netlify domain (subdomain during the build).
- Login screen wired to Supabase Auth + session handling.
- Dashboard shell + left sidebar, gated by the permissions above.
- Admin screens: Users, Roles & Permissions, Departments (backed by RPCs that call
  `has_permission()` server-side).

## Merge plan (with the two existing apps)

This ERP is the **production/factory** side. `grohub-erp` and `topshop-ops` are the
**selling** side (Shopify orders, COD, courier reconciliation). The bridge is
**Finished Goods**: packed garments become sellable stock for the storefront brands.
Target end-state: all three on **one Supabase project + one login + one domain**,
separated by Postgres schemas. This repo is built to be absorbed into that unified
project when the ERP has been tested and approved.
