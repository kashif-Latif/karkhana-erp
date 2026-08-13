import type { LucideIcon } from "lucide-react";
import { Clock } from "lucide-react";
import IconChip from "./IconChip";

export default function SectionStub({
  Icon,
  phase,
  intro,
  features,
}: {
  Icon: LucideIcon;
  phase: string;
  intro: string;
  features: string[];
}) {
  return (
    <div className="px-6 pb-10">
      <div className="mx-auto max-w-3xl rounded-card bg-surface p-8 shadow-card">
        <div className="flex items-center justify-between">
          <IconChip Icon={Icon} size={44} />
          <span className="flex items-center gap-1.5 rounded-full bg-panel px-3 py-1 text-[12px] font-semibold text-muted">
            <Clock size={13} /> Building in {phase}
          </span>
        </div>
        <p className="mt-5 text-[14.5px] leading-relaxed text-ink/80">{intro}</p>

        <div className="mt-6 rounded-xl2 bg-canvas p-5">
          <p className="mb-3 text-[12px] font-semibold uppercase tracking-wide text-muted">
            What this screen will include
          </p>
          <ul className="space-y-2">
            {features.map((f) => (
              <li key={f} className="flex items-start gap-2.5 text-[13.5px] text-ink/80">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-salmon-strong" />
                {f}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
