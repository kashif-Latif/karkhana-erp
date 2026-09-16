// Which permission(s) each area needs. A user sees/enters an area if they
// have ANY of the listed permissions. null = always allowed (e.g. Home).
// Security is still enforced in the database (RLS/RPCs); this tailors the UI.
export const ROUTE_PERMS: Record<string, string[] | null> = {
  "/": null,
  "/dashboard": ["reports.view", "inventory.view", "production.view"],
  "/inventory": ["inventory.view"],
  "/grn": ["inventory.view"],
  "/warehouse/products": ["khana.view"],
  "/warehouse/stock": ["khana.view"],
  "/warehouse/grn-in": ["khana.view"],
  "/warehouse/grn-out": ["khana.view"],
  "/grn/out": ["inventory.view", "inventory.issue"],
  "/packing": ["production.view", "production.entry"],
  "/grn/stitching": ["production.view", "production.entry"],
  "/grn/final": ["production.view", "production.entry"],
  /* K119 gave finished garments their own permission. This used to sit under
     inventory.view, which is the permission for raw material — someone who can
     see fabric on a shelf is not automatically someone who should see finished
     output and its value. inventory.view stays listed so nobody currently
     working loses the page overnight. */
  "/inventory/final-products": ["finished.view", "inventory.view"],
  "/inventory/sorting": ["inventory.view", "inventory.sort"],
  "/stock": ["inventory.view"],
  "/process": ["process.view"],
  "/movements": ["inventory.view"],
  "/raw-materials": ["inventory.view"],
  "/production": ["production.view", "production.entry", "production.approve", "production.manage"],
  "/articles": ["production.view", "production.entry", "production.approve", "production.manage"],
  "/add-article": ["articles.manage", "production.entry"],
  "/orders": ["production.view", "production.entry", "production.approve", "production.manage"],
  "/employees": ["employees.manage"],
  "/suppliers": ["suppliers.manage"],
  "/payments": ["payments.manage"],
  "/reports": ["reports.view"],
  "/approvals": ["inventory.approve", "production.approve", "grn.approve"],
  "/administration": ["users.manage", "roles.manage"],

  /* THE HUB. Until now not one /online/* path was listed here, so every Hub
     page was open to anyone who could log in — Finance included. The
     permissions have existed since 0090; nothing was checking them.

     `.manage` is listed alongside `.view` on each line because someone who can
     change a thing can obviously look at it, and a role granted only manage
     should not be locked out of the page it manages.

     /me is deliberately absent: the employee portal is for whoever is signed
     in, it takes no parameter, and every figure on it is filtered by auth.uid()
     inside Postgres. Requiring a permission would lock employees out of their
     own wages. */
  "/online": null,
  "/online/dashboard": ["hub.dashboard.view"],
  "/online/orders": ["hub.orders.view", "hub.orders.manage"],
  /* The article workflow. `view` lets somebody watch the pipeline; every
     control — create, approve, reject, reassign, approve ads spending —
     requires `manage` and is checked again inside the database, so listing
     both here only decides who is shown the door, never who may act. */
  "/online/articles": ["hub.articles.view", "hub.articles.manage"],
  "/online/logistics": ["hub.logistics.view", "hub.logistics.manage"],
  "/online/logistics/returns": ["hub.logistics.view", "hub.logistics.manage"],
  "/online/finance": ["hub.finance.view", "hub.finance.manage"],
  "/online/attendance": ["hub.attendance.view", "hub.attendance.manage"],
  "/online/employees": ["hub.attendance.view", "hub.attendance.manage"],

  /* FS TRADERS. Same omission the Hub had before 0090, arriving a second time:
     not one /retail/* path was listed here, so every retail screen was open to
     anyone who could log in. The database was never exposed — every retail_*
     policy checks a permission — but a page that loads and then shows nothing
     is the worst of both worlds. It looks broken rather than forbidden.

     `.manage` sits beside `.view` on each line for the usual reason: somebody
     who can change a thing can obviously look at it, and a role granted only
     manage should not be locked out of the page it manages. Every control on
     the far side is checked again in Postgres, so this decides who is shown the
     door, never who may act.

     retail.access is NOT listed. It is the umbrella that keeps existing roles
     working (0119), and it is folded into every gate by retail_can() in the
     database — listing it here as well would mean the menu could never be
     narrowed for anyone who still holds it. */
  "/retail": ["retail.dashboard.view", "retail.access"],
  "/retail/dashboard": ["retail.dashboard.view"],
  "/retail/sales": ["retail.sales.view"],
  "/retail/import": ["retail.import.run"],
  "/retail/expenses": ["retail.expenses.view", "retail.expenses.manage"],
  "/retail/payments": ["retail.expenses.view", "retail.expenses.manage"],
  "/retail/cashbook": ["retail.cashbook.view", "retail.cashbook.manage"],
  "/retail/commissions": ["retail.commissions.view", "retail.commissions.manage"],
  "/retail/branches": ["retail.branches.view", "retail.branches.manage"],

  "/retail/employees": ["retail.employees.view", "retail.employees.manage"],
  "/retail/employees/attendance": ["retail.employees.view", "retail.employees.manage"],
  "/retail/employees/summary": ["retail.employees.view", "retail.payroll.view"],
  "/retail/employees/ledger": ["retail.payroll.view", "retail.payroll.manage"],

  "/retail/ho": ["retail.ho.view", "retail.ho.manage"],
  "/retail/ho/cashflow": ["retail.ho.view", "retail.ho.manage"],
  "/retail/ho/eod": ["retail.ho.view", "retail.ho.manage"],
  "/retail/ho/attendance": ["retail.employees.view", "retail.employees.manage"],
  "/retail/ho/summary": ["retail.employees.view", "retail.payroll.view"],
  "/retail/ho/employees": ["retail.employees.view", "retail.employees.manage"],
  "/retail/ho/ledger": ["retail.payroll.view", "retail.payroll.manage"],

  "/retail/salaries": ["retail.payroll.view", "retail.payroll.manage"],
  "/retail/cards": ["retail.cards.view", "retail.cards.manage"],
  /* Owner tier. A statement carries the personal lines sitting beside the shop
     money, so this one is deliberately not folded in with the cash book. */
  "/retail/bank": ["retail.bank.view", "retail.bank.manage"],

  "/me": null,
};

export function hasAny(perms: Set<string>, required: string[] | null): boolean {
  if (!required || required.length === 0) return true;
  return required.some((p) => perms.has(p));
}

// Required permissions for a path (exact match, else longest matching prefix).
export function requiredFor(pathname: string): string[] | null {
  if (pathname in ROUTE_PERMS) return ROUTE_PERMS[pathname];
  let best: string | null = null;
  for (const key of Object.keys(ROUTE_PERMS)) {
    if (key === "/") continue;
    if (pathname === key || pathname.startsWith(key + "/")) {
      if (!best || key.length > best.length) best = key;
    }
  }
  return best ? ROUTE_PERMS[best] : null;
}
