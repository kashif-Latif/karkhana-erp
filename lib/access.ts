// Which permission(s) each area needs. A user sees/enters an area if they
// have ANY of the listed permissions. null = always allowed (e.g. Home).
// Security is still enforced in the database (RLS/RPCs); this tailors the UI.
export const ROUTE_PERMS: Record<string, string[] | null> = {
  "/": null,
  "/dashboard": ["reports.view", "inventory.view", "production.view"],
  "/inventory": ["inventory.view"],
  "/inventory/final-products": ["inventory.view"],
  "/movements": ["inventory.view"],
  "/raw-materials": ["inventory.view"],
  "/production": ["production.view", "production.entry", "production.approve", "production.manage"],
  "/articles": ["production.view", "production.entry", "production.approve", "production.manage"],
  "/employees": ["employees.manage"],
  "/suppliers": ["suppliers.manage"],
  "/payments": ["payments.manage"],
  "/reports": ["reports.view"],
  "/approvals": ["inventory.approve", "production.approve", "grn.approve"],
  "/administration": ["users.manage", "roles.manage"],
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
