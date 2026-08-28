// Signature "Inventory Score" dial: a ring of thin ticks, colored up to the score.
// Pure SVG — no chart library.

const ACCENTS = ["#EFD0A6", "#A6C0E6", "#D2B9EA", "#EBA98F", "#EDA6D0"];

export default function RadialGauge({
  score,
  label = "Inventory Health",
  size = 200,
  ticks = 56,
}: {
  score: number; // 0..100
  label?: string;
  size?: number;
  ticks?: number;
}) {
  const cx = size / 2;
  const cy = size / 2;
  const rOuter = size / 2 - 6;
  const rInner = rOuter - size * 0.11;
  const gapDeg = 80; // open gap at the bottom
  const sweep = 360 - gapDeg;
  const start = 90 + gapDeg / 2; // start angle (degrees), clockwise
  const filled = Math.round((Math.min(100, Math.max(0, score)) / 100) * ticks);

  const marks = Array.from({ length: ticks }, (_, i) => {
    const t = i / (ticks - 1);
    const ang = ((start + t * sweep) * Math.PI) / 180;
    const x1 = cx + rInner * Math.cos(ang);
    const y1 = cy + rInner * Math.sin(ang);
    const x2 = cx + rOuter * Math.cos(ang);
    const y2 = cy + rOuter * Math.sin(ang);
    const on = i < filled;
    // The unlit part of the dial has to darken with the page, or the gauge
    // reads as almost-full in dark mode.
    const color = on ? ACCENTS[Math.floor(t * ACCENTS.length) % ACCENTS.length] : "var(--tint-track)";
    return (
      <line
        key={i}
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke={color}
        strokeWidth={on ? 3 : 2.5}
        strokeLinecap="round"
      />
    );
  });

  return (
    <div className="flex flex-col items-center">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {marks}
      </svg>
      <div className="-mt-[62%] flex flex-col items-center pointer-events-none">
        <span className="text-[44px] font-extrabold leading-none tnum text-ink">{score}</span>
        <span className="mt-1 text-xs font-medium text-muted">{label}</span>
      </div>
    </div>
  );
}
