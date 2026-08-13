"use client";
import {
  LayoutDashboard,
  Boxes,
  Layers,
  Factory,
  Users,
  Truck,
  FileBarChart,
  CheckSquare,
  Settings,
  Gem,
} from "lucide-react";

const NAV = [
  { label: "Dashboard", Icon: LayoutDashboard, active: true },
  { label: "Inventory", Icon: Boxes },
  { label: "Raw Materials", Icon: Layers },
  { label: "Production", Icon: Factory },
  { label: "Employees", Icon: Users },
  { label: "Suppliers", Icon: Truck },
  { label: "Reports", Icon: FileBarChart },
  { label: "Approvals", Icon: CheckSquare, badge: 7 },
  { label: "Administration", Icon: Settings },
];

export default function Sidebar() {
  return (
    <aside className="hidden w-[248px] shrink-0 flex-col border-r border-line bg-surface md:flex">
      <div className="flex items-center gap-2.5 px-6 py-6">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-ink text-white">
          <Gem size={18} />
        </span>
        <div className="leading-tight">
          <div className="text-[15px] font-extrabold tracking-tight">Karkhana</div>
          <div className="text-[11px] text-muted">Head Office ERP</div>
        </div>
      </div>

      <nav className="flex-1 space-y-1 px-3">
        {NAV.map(({ label, Icon, active, badge }) => (
          <button
            key={label}
            className={`flex w-full items-center gap-3 rounded-xl2 px-3.5 py-2.5 text-left text-[14px] transition ${
              active
                ? "bg-salmon-soft font-semibold text-ink"
                : "text-muted hover:bg-panel hover:text-ink"
            }`}
          >
            <Icon size={18} strokeWidth={2} />
            <span className="flex-1">{label}</span>
            {badge && (
              <span className="rounded-full bg-ink px-1.5 py-0.5 text-[10px] font-bold text-white">
                {badge}
              </span>
            )}
          </button>
        ))}
      </nav>

      <div className="m-3 rounded-xl2 bg-cream p-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-salmon-strong text-[13px] font-bold text-white">
            Z
          </span>
          <div className="leading-tight">
            <div className="text-[13px] font-semibold">Zeeshan</div>
            <div className="text-[11px] text-muted">Super Admin</div>
          </div>
        </div>
      </div>
    </aside>
  );
}
