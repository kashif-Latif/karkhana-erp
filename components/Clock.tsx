"use client";
import { useEffect, useState } from "react";
import { Clock as ClockIcon } from "lucide-react";

export default function Clock() {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  if (!now) return null; // avoids server/client hydration mismatch

  const text = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Karachi",
    weekday: "short", day: "2-digit", month: "short",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true,
  }).format(now);

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1.5 text-[12px] font-medium tnum text-ink/70">
      <ClockIcon size={13} className="text-hint" />
      {text} <span className="text-hint">PKT</span>
    </span>
  );
}
