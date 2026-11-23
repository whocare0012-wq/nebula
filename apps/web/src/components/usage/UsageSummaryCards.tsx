import { useId } from "react";

export function UsageSparkline({ values }: { readonly values: readonly number[] }) {
  const id = useId();
  if (values.length < 2 || Math.max(...values) === Math.min(...values))
    return (
      <svg className="usage-spark" viewBox="0 0 96 34" aria-hidden>
        <path d="M0 30 H96" stroke="var(--border)" />
      </svg>
    );
  const peak = Math.max(1, ...values);
  const points = values.map(
    (value, index) => [(index * 96) / (values.length - 1), 33 - (value / peak) * 30] as const,
  );
  let path = `M${points[0]![0]},${points[0]![1]}`;
  for (let index = 0; index < points.length - 1; index++) {
    const p0 = points[index - 1] ?? points[index]!,
      p1 = points[index]!,
      p2 = points[index + 1]!,
      p3 = points[index + 2] ?? p2;
    path += ` C${p1[0] + (p2[0] - p0[0]) * 0.18},${p1[1] + (p2[1] - p0[1]) * 0.18} ${p2[0] - (p3[0] - p1[0]) * 0.18},${p2[1] - (p3[1] - p1[1]) * 0.18} ${p2[0]},${p2[1]}`;
  }

  return (
    <svg className="usage-spark" viewBox="0 0 96 34" aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop stopColor="var(--primary)" stopOpacity=".16" />
          <stop offset="1" stopColor="var(--primary)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <g data-usage-lines>
        <path d={`${path} L96,34 L0,34 Z`} fill={`url(#${id})`} />
        <path
          d={path}
          fill="none"
          stroke="var(--foreground)"
          strokeWidth="1.3"
          strokeLinejoin="round"
        />
      </g>
    </svg>
  );
}
