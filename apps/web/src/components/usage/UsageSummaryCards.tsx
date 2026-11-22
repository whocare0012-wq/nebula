import { uiText as copy } from "~/i18n";
import type { MergedUsage } from "@t3tools/shared/usageMerge";
import { formatCount, formatTokens } from "@t3tools/shared/usageFormat";
import { formatUsd } from "./usageMoney";
import { UsageCount } from "./UsageMotion";
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

export function UsageChange({
  current,
  previous,
}: {
  readonly current: number;
  readonly previous: number | undefined;
}) {
  if (previous === undefined) return null;
  if (previous <= 0)
    return current > 0 ? <span className="usage-tag">{copy("New activity")}</span> : null;
  const change = ((current - previous) / previous) * 100;
  return (
    <span
      className="usage-tag"
      data-change={Math.abs(change) < 0.05 ? "flat" : change > 0 ? "up" : "down"}
    >
      {Math.abs(change) < 0.05
        ? copy("Unchanged.")
        : change > 999
          ? copy("About {count}×", { count: Math.round(current / previous) })
          : `${change > 0 ? "+" : "−"}${Math.abs(change).toFixed(1)}%`}
    </span>
  );
}

export function UsageSummaryCards({
  loading = false,
  breakdown,
  merged,
  previous,
  metric,
  hourly,
}: {
  readonly loading?: boolean;
  readonly breakdown: readonly MergedUsage[];
  readonly merged: MergedUsage;
  readonly previous: MergedUsage | undefined;
  readonly metric: "cost" | "tokens";
  readonly hourly: boolean;
}) {
  const series = hourly ? merged.hourly : merged.daily;
  const cards =
    metric === "cost"
      ? [
          {
            label: copy("Estimated cost"),
            value: merged.costUsd,
            before: previous?.costUsd,
            format: formatUsd,
            values: series.map((v) => v.costUsd),
          },
          {
            label: copy("Processed tokens"),
            value: merged.totalTokens,
            before: previous?.totalTokens,
            format: formatTokens,
            values: series.map((v) => v.totalTokens),
          },
          {
            label: copy("Saved through caching"),
            value: merged.costQuality.cacheSavingsUsd,
            before: previous?.costQuality.cacheSavingsUsd,
            format: formatUsd,
            values: breakdown.map((v) => v.costQuality.cacheSavingsUsd),
          },
          {
            label: copy("Conversations"),
            value: merged.sessions,
            before: previous?.sessions,
            format: formatCount,
            values: breakdown.map((v) => v.sessions),
          },
        ]
      : [
          {
            label: copy("Processed tokens"),
            value: merged.totalTokens,
            before: previous?.totalTokens,
            format: formatTokens,
            values: series.map((v) => v.totalTokens),
          },
          {
            label: copy("Cache read"),
            value: merged.cachedInputTokens,
            before: previous?.cachedInputTokens,
            format: formatTokens,
            values: breakdown.map((v) => v.cachedInputTokens),
          },
          {
            label: copy("New input"),
            value: merged.uncachedInputTokens,
            before: previous?.uncachedInputTokens,
            format: formatTokens,
            values: breakdown.map((v) => v.uncachedInputTokens),
          },
          {
            label: copy("Output"),
            value: merged.outputTokens,
            before: previous?.outputTokens,
            format: formatTokens,
            values: breakdown.map((v) => v.outputTokens),
          },
        ];
  return (
    <div data-usage-card className="usage-kpis usage-ribbon">
      {cards.map((c) => (
        <section className="usage-kpi" key={c.label}>
          <div className="usage-card-title">
            <span>{c.label}</span>
            {loading ? (
              <span className="usage-tag">{copy("Calculating")}</span>
            ) : (
              <UsageChange current={c.value} previous={c.before} />
            )}
          </div>
          <div className="usage-kpi-value">
            <strong>
              <UsageCount value={c.value} format={c.format} />
            </strong>
            <UsageSparkline values={c.values} />
          </div>
        </section>
      ))}
    </div>
  );
}
