// Signature dot-matrix heatmap: months across, intensity as dot opacity.

export default function DotMatrix({
  values,
  labels,
  rows = 5,
  base = "#B693DD",
}: {
  values: number[]; // 0..(rows) intensity per column
  labels: string[];
  rows?: number;
  base?: string;
}) {
  const cols = values.length;
  const dot = 12;
  const gap = 8;
  const w = cols * (dot + gap);
  const h = rows * (dot + gap);

  return (
    <div className="w-full overflow-x-auto">
      <svg width={w} height={h + 22} viewBox={`0 0 ${w} ${h + 22}`}>
        {values.map((v, c) =>
          Array.from({ length: rows }, (_, r) => {
            // fill from the bottom up
            const level = rows - r;
            const on = level <= v;
            const opacity = on ? 0.35 + (level / rows) * 0.65 : 0.12;
            return (
              <circle
                key={`${c}-${r}`}
                cx={c * (dot + gap) + dot / 2}
                cy={r * (dot + gap) + dot / 2}
                r={dot / 2}
                fill={base}
                opacity={opacity}
              />
            );
          }),
        )}
        {labels.map((l, c) => (
          <text
            key={l}
            x={c * (dot + gap) + dot / 2}
            y={h + 16}
            textAnchor="middle"
            fontSize="10"
            fill="#857C72"
          >
            {l}
          </text>
        ))}
      </svg>
    </div>
  );
}
