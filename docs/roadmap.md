# Karkhana ERP — 7-Day Build Roadmap

A day-by-day plan to a **full, working, secure** ERP, built per the inventory
specification. Each day ends with a **verified, deployable** slice you can show —
so progress is visible every single day.

> **Quality gate (non-negotiable):** every day's work is verified before it ships —
> SQL validated against real PostgreSQL, the app build confirmed green, security
> enforced in the database (not the browser). If the hardest core (the stock
> ledger, Days 3–4) needs extra care, we give it that. We never trade correctness
> for the calendar.

---

## ✅ Day 0 — Foundation & Deployment — **DONE**

- Real authentication (Supabase Auth); admin-creates-users, no public sign-up
- 8-role RBAC with 25 action-level permissions, enforced in the database (RLS)
- Departments, append-only audit trail, concurrency-safe document numbering
- Lustra-themed dashboard + full navigation shell (all 9 sections)
- **Live on Vercel** via GitHub CI/CD · security-patched · keep-alive active
- Live URL: https://karkhana-erp-123.vercel.app

---

## Day 1 — Master Data I: Suppliers + Material catalog

- **Suppliers** master — add / edit / list (code, company, contact, phone, email, tax)
- **Materials, Categories, Units, Colours, Sizes** — the configurable building blocks (nothing hard-coded)
- All server-side (RBAC + audit)
- **You'll be able to:** add a supplier and a material and see them saved to your live database.

## Day 2 — Master Data II: Employees + catalog completion

- **Employees** master (code, name, department, designation, status)
- **Designations**, plus material-specific config (Zip sizes 1–10, Fabric types, etc.)
- Completes all master data
- **You'll be able to:** manage every master list from the UI. *(Phase 2 complete.)*

## Day 3 — Inventory Core I: stock ledger + Goods Receipt (GRN)

- The **immutable stock ledger** + posting engine (server-side, row-locked, idempotent)
- **GRN** — receive material from a supplier → posts to the ledger → updates stock balance
- Stock balances (cached view) + purchase-rate capture
- **You'll be able to:** receive stock and watch balances update. *(The heart begins.)*

## Day 4 — Inventory Core II: Issue / Return / Transfer / Adjust

- **Issue** to departments, **Returns**, **Transfers**, **Adjustments / Wastage** — all as posted transactions
- **Negative-stock prevention**; Draft → Submitted → Approved → Posted approvals
- Full **stock ledger view** (running balance) + current-stock screen
- **You'll be able to:** run raw-material inventory end-to-end. *(Phase 3 — the priority — complete.)*

## Day 5 — Production: orders + department workflow + WIP

- **Production orders**; the flow Cutting → Stitching → Clipping → Iron → QA/QC & Packing
- **WIP** tracking; material consumption linked to production and department
- **You'll be able to:** push a production order through the departments.

## Day 6 — Piece-rate & Payroll

- **Operations** + **piece rates** (with rate history)
- **Daily production entry** per employee → accepted pieces × the rate that applied that day
- Per-employee **earnings ledger** + **payroll** summary
- **You'll be able to:** see employee wages calculated from real production.

## Day 7 — Reporting, Admin UI & Hardening

- **Reports** (inventory, purchase, production, payroll) with Excel/PDF export
- **Admin screens** (user & role management UI), audit-trail viewer
- **Security review**, free automated backups, go-live checklist
- **Result:** a full, working, secure ERP.

---

### How each day runs
1. I build the module and **verify** it (SQL + build).
2. I hand you the migration to run and the files to push.
3. You apply + push → it deploys live in ~2 minutes.
4. We confirm it works, then move to the next day.

Steady, verified, one day at a time.
