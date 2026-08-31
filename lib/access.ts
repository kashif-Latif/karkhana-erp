// Which permission(s) each area needs. A user sees/enters an area if they
// have ANY of the listed permissions. null = always allowed (e.g. Home).
// Security is still enforced in the database (RLS/RPCs); this tailors the UI.
export const ROUTE_PERMS: Record<string, string[] | null> = {
  "/": null,
  "/dashboard": ["reports.view", "inventory.view", "production.view"],
  "/inventory": ["inventory.view"],
  "/inventory/final-products": ["inventory.view"],
  "/inventory/sorting": ["inventory.view", "inventory.sort"],
  "/movements": ["inventory.view"],
  "/raw-materials": ["inventory.view"],
  "/production": ["production.view", "production.entry", "production.approve", "production.manage"],
  "/articles": ["production.view", "production.entry", "production.approve", "production.manage"],
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
  "/online/logistics": ["hub.logistics.view", "hub.logistics.manage"],
  "/online/logistics/returns": ["hub.logistics.view", "hub.logistics.manage"],
  "/online/finance": ["hub.finance.view", "hub.finance.manage"],
  "/online/attendance": ["hub.attendance.view", "hub.attendance.manage"],
  "/online/employees": ["hub.attendance.view", "hub.attendance.manage"],
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
