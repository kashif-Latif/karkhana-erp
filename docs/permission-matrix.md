# Permission Matrix — Head Office ERP

Action-level permissions, enforced in the **database** (Row Level Security +
`has_permission()`), not by hiding buttons. Every write-RPC in later phases
calls the same `has_permission()` check, so the backend is always the gate.

**Roles:** SA = Super Administrator · Adm = Administrator · IM = Inventory Manager ·
SK = Storekeeper · DS = Department Supervisor · PE = Production Data Entry ·
HR = HR / Payroll · Aud = Auditor

> Super Admin also carries an `is_super_admin` flag = implicit access to everything,
> and its role is protected from deletion. Department Supervisor is additionally
> **scoped to its own department** (enforced in later inventory/production RPCs).

## Administration
| Permission | SA | Adm | IM | SK | DS | PE | HR | Aud |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| `users.manage` | ✓ | ✓ | | | | | | |
| `roles.manage` | ✓ | ✓ | | | | | | |
| `departments.manage` | ✓ | ✓ | | | | | | |
| `settings.manage` | ✓ | ✓ | | | | | | |
| `audit.view` | ✓ | ✓ | | | | | | ✓ |

## Master Data
| Permission | SA | Adm | IM | SK | DS | PE | HR | Aud |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| `materials.manage` | ✓ | ✓ | | | | | | |
| `suppliers.manage` | ✓ | ✓ | | | | | | |
| `rates.manage` | ✓ | ✓ | | | | | | |
| `employees.manage` | ✓ | ✓ | | | | | | |

## Inventory
| Permission | SA | Adm | IM | SK | DS | PE | HR | Aud |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| `inventory.view` | ✓ | ✓ | ✓ | ✓ | ✓ | | | ✓ |
| `grn.create` | ✓ | ✓ | ✓ | ✓ | | | | |
| `grn.approve` | ✓ | ✓ | ✓ | | | | | |
| `inventory.issue` | ✓ | ✓ | ✓ | ✓ | | | | |
| `inventory.return` | ✓ | ✓ | ✓ | ✓ | | | | |
| `inventory.transfer` | ✓ | ✓ | ✓ | | | | | |
| `inventory.adjust` (privileged) | ✓ | ✓ | | | | | | |
| `inventory.approve` | ✓ | ✓ | ✓ | | | | | |

## Production
| Permission | SA | Adm | IM | SK | DS | PE | HR | Aud |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| `production.view` | ✓ | ✓ | | | ✓ | ✓ | ✓ | ✓ |
| `production.manage` | ✓ | ✓ | | | | | | |
| `production.entry` | ✓ | ✓ | | | ✓ | ✓ | | |
| `production.approve` | ✓ | ✓ | | | | | | |

## Payroll
| Permission | SA | Adm | IM | SK | DS | PE | HR | Aud |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| `payroll.view` | ✓ | ✓ | | | | | ✓ | ✓ |
| `payroll.manage` | ✓ | ✓ | | | | | | |

## Reports
| Permission | SA | Adm | IM | SK | DS | PE | HR | Aud |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| `reports.view` | ✓ | ✓ | ✓ | ✓ | ✓ | | ✓ | ✓ |
| `reports.export` | ✓ | ✓ | | | | | | |

---

**Everything here is configurable.** Roles, permissions, and their mapping live in
tables (`roles`, `permissions`, `role_permissions`) — an admin with `roles.manage`
can adjust grants without touching code. Nothing is hard-coded.
