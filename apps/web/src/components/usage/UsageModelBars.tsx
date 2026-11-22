import { uiText } from "../../i18n";
import { usageHourTicks } from "./usageAxis";
import { useState } from "react";
import { modelBarGeometry } from "./usageAnalysis";
import { useUsageDateFormat } from "./useUsageDateFormat";
import type { MergedUsage } from "@t3tools/shared/usageMerge";
import { formatTokens } from "@t3tools/shared/usageFormat";
import { costDisplayFactor, formatUsd, formatUsdWhole, isWholeDisplayedCost } from "./usageMoney";
import type { UsageChartWindow } from "./UsageModelDialog";
import { useUiText } from "~/i18n/useUiText";
export function UsageModelBars({
  usage,
  window,
  metric,
}: {
  readonly usage: MergedUsage;
  readonly window: UsageChartWindow;
  readonly metric: "cost" | "tokens";
}) {
  const text = useUiText(),
    date = useUsageDateFormat();
  const [hovered, setHovered] = useState<number | null>(null);
  const periods = window.resolution === "hour" ? window.hours : window.days,
    series = window.resolution === "hour" ? usage.hourly : usage.daily;
  const byPeriod = new Map(
    series.map((v) => [
      "hourStart" in v ? v.hourStart : v.day,
      metric === "cost" ? v.costUsd : v.totalTokens,
    ]),
  );
  const values = periods.map((p) => byPeriod.get(p) ?? 0),
    peak = Math.max(0, ...values),
    // Round the axis in the displayed currency, then convert back to the USD the bars use.
    displayFactor = metric === "cost" ? costDisplayFactor() : 1,
    rawMax = peak * displayFactor || 1;
  const magnitude = 10 ** Math.floor(Math.log10(rawMax));
  const displayStep =
    [1, 2, 5, 10].map((n) => n * magnitude).find((n) => n >= rawMax / 2) ?? magnitude * 10;
  const step = displayStep / displayFactor;
  const max = (Math.ceil(rawMax / displayStep) * displayStep) / displayFactor;
  const plotLeft = 48,
    plotWidth = 420,
    xScale = plotWidth / 456;
  const average = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0,
    geometry = modelBarGeometry(values.length);
  const y = (n: number) => 180 - (n / max) * 160,
    format = metric === "cost" ? formatUsd : formatTokens;
  const label = (p: string) =>
    window.resolution === "hour"
      ? date.formatHourShort(p, window.timeZone, window.hour12)
      : date.formatDayShort(p);
  return (
    <section className="usage-model-bars" onMouseLeave={() => setHovered(null)}>
      <h3>
        {text(window.resolution === "hour" ? uiText("Hourly") : uiText("Daily usage"))}
        {text(metric === "cost" ? uiText("Cost") : uiText("Tokens"))}
      </h3>
      <div className="usage-readout" data-usage-readout role="status">
        <div>
          <span>
            {hovered === null ? text("Dashed line shows average") : label(periods[hovered]!)}
          </span>
          <strong>
            {hovered === null
              ? text("Average {value} per hour", { value: format(average) })
              : format(values[hovered] ?? 0)}
          </strong>
        </div>
      </div>
      <svg
        className="w-full"
        viewBox="0 0 480 212"
        role="img"
        aria-label={text("Average {value}", { value: format(average) })}
      >
        {Array.from({ length: Math.round(max / step) + 1 }, (_, i) => i * step).map((tick) => (
          <g key={tick} data-model-y-tick>
            <text
              x={40}
              y={y(tick)}
              dominantBaseline="middle"
              textAnchor="end"
              fill="var(--muted-foreground)"
              fontSize={11}
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {metric === "cost"
                ? isWholeDisplayedCost(tick)
                  ? formatUsdWhole(tick)
                  : formatUsd(tick)
                : formatTokens(tick)}
            </text>
            <line x1={plotLeft} x2={468} y1={y(tick)} y2={y(tick)} stroke="var(--border)" />
          </g>
        ))}
        <line
          x1={plotLeft}
          x2={468}
          y1={y(average)}
          y2={y(average)}
          stroke="var(--muted-foreground)"
          strokeDasharray="4 4"
        />
        {hovered !== null ? (
          <line
            x1={plotLeft + (hovered + 0.5) * geometry.step * xScale}
            x2={plotLeft + (hovered + 0.5) * geometry.step * xScale}
            y1={0}
            y2={y(values[hovered] ?? 0)}
            stroke="var(--muted-foreground)"
          />
        ) : null}
        {values.map((value, i) => (
          <g key={periods[i]} onMouseEnter={() => setHovered(i)}>
            <rect
              data-usage-bar
              data-hovered={hovered === i || undefined}
              x={plotLeft + i * geometry.step * xScale}
              y={y(value)}
              width={geometry.width * xScale}
              height={value === 0 ? 0 : Math.max(1, 180 - y(value))}
              style={{ transformOrigin: "0 180px", transformBox: "view-box" }}
              rx={3}
              fill={
                i === values.indexOf(peak) && peak > 0
                  ? "var(--primary)"
                  : hovered === i
                    ? "color-mix(in srgb,var(--foreground) 40%,var(--card))"
                    : "color-mix(in srgb,var(--foreground) 22%,var(--card))"
              }
            />
            <rect
              x={plotLeft + i * geometry.step * xScale}
              y={0}
              width={geometry.step * xScale}
              height={184}
              fill="transparent"
              tabIndex={0}
              role="img"
              aria-label={`${label(periods[i]!)} · ${format(value)}`}
              onFocus={() => setHovered(i)}
              onBlur={() => setHovered(null)}
            />
            {window.resolution !== "hour" &&
            i % Math.max(1, Math.floor(values.length / 4)) === 0 ? (
              <text
                x={plotLeft + i * geometry.step * xScale}
                y={206}
                fill="var(--muted-foreground)"
                fontSize={11}
              >
                {label(periods[i]!)}
              </text>
            ) : null}
          </g>
        ))}{" "}
        {window.resolution === "hour"
          ? usageHourTicks(periods, window.timeZone, 6, true).map((tick) => (
              <text
                key={tick.at}
                x={plotLeft + tick.position * plotWidth}
                y={206}
                fill="var(--muted-foreground)"
                fontSize={11}
                textAnchor="middle"
              >
                {tick.label}
              </text>
            ))
          : null}
      </svg>
    </section>
  );
}
