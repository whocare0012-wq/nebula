import { uiText as copy } from "~/i18n";
import { usageHourTicks } from "./usageAxis";
import { useUsageDateFormat } from "./useUsageDateFormat";
import { useUiText } from "~/i18n/useUiText";

import type { UsageProviderKind, UsageSummaryInput } from "@t3tools/contracts";
import { useRef, useState } from "react";

import type { DailyTotals, HourlyTotals, MergedUsage } from "@t3tools/shared/usageMerge";
import { enumerateDays, enumerateHourStarts, formatTokens } from "@t3tools/shared/usageFormat";
import { costDisplayFactor, formatUsd, formatUsdWhole, isWholeDisplayedCost } from "./usageMoney";
import { cn } from "~/lib/utils";
import {
  USAGE_SERIES_ORDER as PROVIDER_ORDER,
  PROVIDER_PRESENTATION,
  usageSeries,
  usageSeriesLabel,
} from "./usageProviders";

const VIEW_WIDTH = 960;
const VIEW_HEIGHT = 260;
/** Widest a cost bar gets, in view units (the plot stretches 960 units across the card). */
const MAX_BAR_WIDTH = 36;
const TICK_COUNT = 4;
const PLOT_TOP = 8;
const NONE_LOADING: ReadonlySet<UsageProviderKind> = new Set();

export type UsageChartMetric = "tokens" | "cost";

interface UsageProviderChartProps {
  readonly previous?: MergedUsage | undefined;
  /** Apple dashboard: one accent line for the period total instead of one line per provider. */
  readonly totalOnly?: boolean;
  /** V9 cost page: draw the period total as bars instead of the filled curve (totalOnly only). */
  readonly chartStyle?: "area" | "bar";
  readonly previousWindow?: UsageSummaryInput;
  readonly providers: readonly UsageProviderKind[];
  readonly loadingProviders?: ReadonlySet<UsageProviderKind>;
  readonly days: readonly string[];
  readonly daily: readonly DailyTotals[];
  readonly hours: readonly string[];
  readonly hourly: readonly HourlyTotals[];
  readonly metric: UsageChartMetric;
  readonly referenceTime: string | undefined;
  readonly resolution: "day" | "hour";
  readonly timeZone: string;
  readonly hour12: boolean;
}

export interface DayColumn {
  readonly bands: readonly {
    readonly provider: UsageProviderKind;
    readonly value: number;
  }[];
  readonly total: number;
}

interface Point {
  readonly x: number;
  readonly y: number;
}

function valueFor(
  totals: DailyTotals | HourlyTotals | undefined,
  provider: UsageProviderKind,
  metric: UsageChartMetric,
): number {
  let value = 0;
  for (const [kind, entry] of totals?.byProvider ?? [])
    if (usageSeries(kind) === provider)
      value += metric === "tokens" ? entry.totalTokens : entry.costUsd;
  return value;
}

export function buildPeriodColumns(
  periods: readonly string[],
  byPeriod: ReadonlyMap<string, DailyTotals | HourlyTotals>,
  metric: UsageChartMetric,
): readonly DayColumn[] {
  return periods.map((period) => {
    const entry = byPeriod.get(period);
    const bands = PROVIDER_ORDER.map((provider) => ({
      provider,
      value: valueFor(entry, provider, metric),
    }));
    return { bands, total: bands.reduce((sum, band) => sum + band.value, 0) };
  });
}

function monotoneTangents(points: readonly Point[]): readonly number[] {
  const count = points.length;
  if (count < 2) return [0];

  const slopes: number[] = [];
  for (let index = 0; index < count - 1; index += 1) {
    const dx = (points[index + 1]?.x ?? 0) - (points[index]?.x ?? 0);
    const dy = (points[index + 1]?.y ?? 0) - (points[index]?.y ?? 0);
    slopes.push(dx === 0 ? 0 : dy / dx);
  }

  const tangents: number[] = Array.from({ length: count }, () => 0);
  tangents[0] = slopes[0] ?? 0;
  tangents[count - 1] = slopes[count - 2] ?? 0;
  for (let index = 1; index < count - 1; index += 1) {
    const previous = slopes[index - 1] ?? 0;
    const next = slopes[index] ?? 0;
    tangents[index] = previous * next <= 0 ? 0 : (previous + next) / 2;
  }

  for (let index = 0; index < count - 1; index += 1) {
    const slope = slopes[index] ?? 0;
    if (slope === 0) {
      tangents[index] = 0;
      tangents[index + 1] = 0;
      continue;
    }
    const a = (tangents[index] ?? 0) / slope;
    const b = (tangents[index + 1] ?? 0) / slope;
    const magnitude = a * a + b * b;
    if (magnitude > 9) {
      const scale = 3 / Math.sqrt(magnitude);
      tangents[index] = scale * a * slope;
      tangents[index + 1] = scale * b * slope;
    }
  }

  return tangents;
}

interface CurveSegment {
  readonly from: Point;
  readonly c1: Point;
  readonly c2: Point;
  readonly to: Point;
}

function smoothCurve(points: readonly Point[]): readonly CurveSegment[] {
  if (points.length < 2) return [];
  const tangents = monotoneTangents(points);
  const segments: CurveSegment[] = [];

  for (let index = 0; index < points.length - 1; index += 1) {
    const from = points[index];
    const to = points[index + 1];
    if (from === undefined || to === undefined) continue;
    const dx = to.x - from.x;
    segments.push({
      from,
      c1: { x: from.x + dx / 3, y: from.y + ((tangents[index] ?? 0) * dx) / 3 },
      c2: { x: to.x - dx / 3, y: to.y - ((tangents[index + 1] ?? 0) * dx) / 3 },
      to,
    });
  }
  return segments;
}

function curvePath(segments: readonly CurveSegment[]): string {
  const first = segments[0];
  if (first === undefined) return "";
  let path = `M${first.from.x.toFixed(2)},${first.from.y.toFixed(2)}`;
  for (const segment of segments) {
    path += ` C${segment.c1.x.toFixed(2)},${segment.c1.y.toFixed(2)} ${segment.c2.x.toFixed(2)},${segment.c2.y.toFixed(2)} ${segment.to.x.toFixed(2)},${segment.to.y.toFixed(2)}`;
  }
  return path;
}

function areaPath(line: string) {
  return line === "" ? "" : `${line} L${VIEW_WIDTH},${VIEW_HEIGHT} L0,${VIEW_HEIGHT} Z`;
}

function niceScale(peak: number, count: number): { max: number; ticks: readonly number[] } {
  if (peak <= 0) return { max: 0, ticks: [0] };

  const rawStep = peak / count;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalized = rawStep / magnitude;
  const step = (normalized > 5 ? 10 : normalized > 2 ? 5 : normalized > 1 ? 2 : 1) * magnitude;

  const max = Math.ceil(peak / step) * step;
  const ticks: number[] = [];
  for (let value = 0; value <= max + step * 1e-6; value += step) ticks.push(value);
  return { max, ticks };
}

const PLACEHOLDER_TICKS = Array.from({ length: TICK_COUNT + 1 }, (_, index) => index);

function chartScale(
  columns: readonly DayColumn[],
  loadingProviders: ReadonlySet<UsageProviderKind>,
  previousPeak = 0,
  totalOnly = false,
  displayFactor = 1,
) {
  // Layered series each start at zero; summing peaks would waste plot height.
  const peak = columns.reduce(
    (max, column) =>
      totalOnly
        ? Math.max(max, column.total)
        : column.bands.reduce((inner, band) => Math.max(inner, band.value), max),
    previousPeak,
  );
  return peak === 0 && loadingProviders.size > 0
    ? { max: TICK_COUNT, ticks: PLACEHOLDER_TICKS, labeled: false }
    : { ...displayedNiceScale(peak, displayFactor), labeled: true };
}

// Round the ticks in the displayed unit, so a converted currency still reads ¥50, ¥100.
function displayedNiceScale(peak: number, displayFactor: number) {
  const { max, ticks } = niceScale(peak * displayFactor, TICK_COUNT);
  return { max: max / displayFactor, ticks: ticks.map((tick) => tick / displayFactor) };
}

function valueToY(value: number, max: number) {
  return max === 0 ? VIEW_HEIGHT : VIEW_HEIGHT - (value / max) * (VIEW_HEIGHT - PLOT_TOP);
}

function buildChart(
  periods: readonly string[],
  byPeriod: ReadonlyMap<string, DailyTotals | HourlyTotals>,
  metric: UsageChartMetric,
  providers: readonly UsageProviderKind[],
  loadingProviders: ReadonlySet<UsageProviderKind>,
  previousPeak = 0,
  totalOnly = false,
) {
  const columns = buildPeriodColumns(periods, byPeriod, metric);
  const scale = chartScale(
    columns,
    loadingProviders,
    previousPeak,
    totalOnly,
    metric === "cost" ? costDisplayFactor() : 1,
  );
  const stepX = periods.length < 2 ? 0 : VIEW_WIDTH / (periods.length - 1);
  const paths = providers.map((provider) => {
    const slot = PROVIDER_ORDER.indexOf(provider);
    const line = curvePath(
      smoothCurve(
        columns.map((column, periodIndex) => ({
          x: periodIndex * stepX,
          y: valueToY(column.bands[slot]?.value ?? 0, scale.max),
        })),
      ),
    );
    return {
      provider,
      loading: loadingProviders.has(provider),
      total: columns.reduce((sum, column) => sum + (column.bands[slot]?.value ?? 0), 0),
      line,
      area: areaPath(line),
    };
  });

  const totalLine = curvePath(
    smoothCurve(
      columns.map((column, periodIndex) => ({
        x: periodIndex * stepX,
        y: valueToY(column.total, scale.max),
      })),
    ),
  );
  return {
    columns,
    scale,
    stepX,
    paths: paths.toSorted((a, b) => b.total - a.total),
    total: { line: totalLine, area: areaPath(totalLine) },
  };
}

function UsageChartTooltip({
  tooltipRef,
  previousValue,
  label,
  column,
  providers,
  loadingProviders,
  format,
}: {
  readonly tooltipRef: React.Ref<HTMLDivElement> | undefined;
  readonly previousValue: number | undefined;
  readonly label: string;
  readonly column: DayColumn | undefined;
  readonly providers: readonly UsageProviderKind[];
  readonly loadingProviders: ReadonlySet<UsageProviderKind>;
  readonly format: (value: number) => string;
}) {
  const partial = providers.some((provider) => loadingProviders.has(provider));
  return (
    <div
      ref={tooltipRef}
      className="usage-readout usage-cost-readout"
      data-usage-readout
      role="status"
    >
      <div className="mb-1 text-muted-foreground">{label}</div>
      <strong className="usage-tooltip-total" aria-busy={partial}>
        {format(column?.total ?? 0)}
      </strong>
      {previousValue !== undefined && previousValue > 0 ? (
        <p>{copy("{value} · Previous period", { value: format(previousValue) })}</p>
      ) : null}
      {providers
        .filter(
          (provider) => (column?.bands.find((band) => band.provider === provider)?.value ?? 0) > 0,
        )
        .slice(0, previousValue !== undefined && previousValue > 0 ? 3 : 4)
        .map((provider) => {
          const providerLabel = usageSeriesLabel(provider);
          return (
            <div key={provider} className="flex items-center justify-between gap-3">
              <b className="tabular-nums text-foreground">
                {format(column?.bands.find((band) => band.provider === provider)?.value ?? 0)}
              </b>
              <span className="flex items-center gap-1.5 text-foreground">
                <span
                  className="size-2 rounded-xs"
                  style={{ background: PROVIDER_PRESENTATION[provider].color }}
                />
                {providerLabel}
              </span>
            </div>
          );
        })}
    </div>
  );
}

function UsageChartPlot({
  periods,
  previousValues,
  max,
  columns,
  stepX,
  providers,
  loadingProviders,
  format,
  formatTooltipPeriod,
  children,
}: {
  readonly max: number;
  readonly previousValues: readonly number[] | undefined;
  readonly periods: readonly string[];
  readonly columns: readonly DayColumn[];
  readonly stepX: number;
  readonly providers: readonly UsageProviderKind[];
  readonly loadingProviders: ReadonlySet<UsageProviderKind>;
  readonly format: (value: number) => string;
  readonly formatTooltipPeriod: (period: string) => string;
  readonly children: React.ReactNode;
}) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const plotRef = useRef<HTMLDivElement | null>(null);
  const handleMove = (event: React.MouseEvent<HTMLDivElement>) => {
    const plot = plotRef.current;
    if (plot === null || periods.length === 0) return;
    const bounds = plot.getBoundingClientRect();
    if (bounds.width === 0) return;
    const localX = Math.min(bounds.width, Math.max(0, event.clientX - bounds.left));
    const fraction = localX / bounds.width;
    const index = Math.round(fraction * (periods.length - 1));
    setHoverIndex(Math.min(periods.length - 1, Math.max(0, index)));
  };

  const hoveredPeriod = hoverIndex === null ? undefined : periods[hoverIndex];

  return (
    <div
      ref={plotRef}
      role="img"
      aria-label={
        format === formatUsd
          ? copy("Cost trend. Hover for period details.")
          : copy("Token trend. Hover for period details.")
      }
      className="usage-cost-plot relative flex-1"
      onMouseMove={handleMove}
      onMouseLeave={() => setHoverIndex(null)}
    >
      {hoverIndex === null || hoveredPeriod === undefined ? (
        <div className="usage-readout" data-usage-readout>
          <span>{copy("Hover to see period details")}</span>
        </div>
      ) : (
        <UsageChartTooltip
          previousValue={previousValues?.[hoverIndex]}
          tooltipRef={undefined}
          label={formatTooltipPeriod(hoveredPeriod)}
          column={columns[hoverIndex]}
          providers={providers}
          loadingProviders={loadingProviders}
          format={format}
        />
      )}
      <svg
        className="h-56 w-full"
        viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
        preserveAspectRatio="none"
        aria-hidden
      >
        {children}
        {hoverIndex === null ? null : (
          <>
            <circle
              data-usage-hover="current"
              cx={hoverIndex * stepX}
              cy={valueToY(columns[hoverIndex]?.total ?? 0, max)}
              r="4.5"
              fill="var(--card)"
              stroke="var(--primary)"
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
            />
            {previousValues?.[hoverIndex] !== undefined ? (
              <circle
                data-usage-hover="previous"
                cx={hoverIndex * stepX}
                cy={valueToY(previousValues[hoverIndex]!, max)}
                r="4"
                fill="var(--card)"
                stroke="var(--muted-foreground)"
                strokeWidth="1.5"
                vectorEffect="non-scaling-stroke"
              />
            ) : null}
            <line
              x1={hoverIndex * stepX}
              x2={hoverIndex * stepX}
              y1={PLOT_TOP}
              y2={VIEW_HEIGHT}
              stroke="currentColor"
              strokeWidth={1}
              className="text-muted-foreground"
              vectorEffect="non-scaling-stroke"
            />
          </>
        )}
      </svg>
    </div>
  );
}

export function UsageProviderChart({
  previous,
  totalOnly = false,
  chartStyle = "area",
  previousWindow,
  providers,
  loadingProviders = NONE_LOADING,
  days,
  daily,
  hours,
  hourly,
  metric,
  referenceTime,
  resolution,
  timeZone,
  hour12,
}: UsageProviderChartProps) {
  const uiText = useUiText();
  const { formatDayShort, formatHourShort, formatRelativeHourShort } = useUsageDateFormat();
  const periods = resolution === "hour" ? hours : days;
  const totals: readonly (DailyTotals | HourlyTotals)[] = resolution === "hour" ? hourly : daily;
  const byPeriod = new Map(
    totals.map((entry) => ["hourStart" in entry ? entry.hourStart : entry.day, entry]),
  );
  const previousPeriods = previousWindow
    ? resolution === "hour" && previousWindow.sinceTime && previousWindow.untilTime
      ? enumerateHourStarts(previousWindow.sinceTime, previousWindow.untilTime)
      : enumerateDays(previousWindow.sinceDay, previousWindow.untilDay)
    : [];
  const previousTotals = previous ? (resolution === "hour" ? previous.hourly : previous.daily) : [];
  const previousByPeriod = new Map(
    previousTotals.map((v) => [
      "hourStart" in v ? v.hourStart : v.day,
      metric === "cost" ? v.costUsd : v.totalTokens,
    ]),
  );
  const previousValues =
    previous && previousPeriods.length === periods.length
      ? previousPeriods.map((p) => previousByPeriod.get(p) ?? 0)
      : undefined;
  const { columns, scale, paths, stepX, total } = buildChart(
    periods,
    byPeriod,
    metric,
    providers,
    loadingProviders,
    Math.max(0, ...(previousValues ?? [])),
    totalOnly,
  );
  const anyLoading = providers.some((provider) => loadingProviders.has(provider));

  const toY = (value: number) => valueToY(value, scale.max);
  const seriesClassName = (loading: boolean) =>
    cn("transition-opacity", loading && "opacity-40 delay-150");
  const format = metric === "tokens" ? formatTokens : formatUsd;
  const formatPeriod = (period: string) =>
    resolution === "hour"
      ? formatHourShort(period, timeZone, hour12).replace(/:\d{2}$/, ":00")
      : formatDayShort(period);
  const formatTooltipPeriod = (period: string) =>
    resolution === "hour" && referenceTime !== undefined
      ? formatRelativeHourShort(period, referenceTime, timeZone, hour12)
          .replace(/ today$/, ` ${uiText("today")}`)
          .replace(/ yesterday$/, ` ${uiText("yesterday")}`)
          .replace(/\s*(?:GMT|UTC)[+-]?\d*(?::\d+)?\s*/g, " ")
          .trim()
      : formatPeriod(period);

  return (
    <div className="flex flex-col gap-1">
      {previousValues && !totalOnly ? (
        <span className="usage-previous-legend">{copy("Previous period · Gray dashed line")}</span>
      ) : null}
      <div className="flex gap-2">
        <div aria-hidden className="relative h-56 w-14 shrink-0">
          {scale.labeled
            ? scale.ticks.map((tick) => (
                <span
                  key={tick}
                  className="absolute right-0 -translate-y-1/2 text-3xs text-muted-foreground tabular-nums"
                  style={{ top: `calc(48px + ${(toY(tick) / VIEW_HEIGHT) * 100}%)` }}
                >
                  {tick === 0
                    ? "0"
                    : totalOnly && metric === "cost" && isWholeDisplayedCost(tick)
                      ? formatUsdWhole(tick)
                      : format(tick)}
                </span>
              ))
            : null}
        </div>

        <UsageChartPlot
          max={scale.max}
          previousValues={previousValues}
          periods={periods}
          columns={columns}
          stepX={stepX}
          providers={providers}
          loadingProviders={loadingProviders}
          format={format}
          formatTooltipPeriod={formatTooltipPeriod}
        >
          {scale.ticks.map((tick) => {
            const y = toY(tick);
            return (
              <line
                key={tick}
                x1={0}
                x2={VIEW_WIDTH}
                y1={y}
                y2={y}
                stroke="currentColor"
                strokeWidth={1}
                className="text-border"
                vectorEffect="non-scaling-stroke"
              />
            );
          })}

          <g data-usage-lines>
            {previousValues ? (
              <path
                d={curvePath(
                  smoothCurve(previousValues.map((value, i) => ({ x: i * stepX, y: toY(value) }))),
                )}
                fill="none"
                stroke="var(--muted-foreground)"
                strokeOpacity={totalOnly ? 0.45 : 1}
                strokeDasharray={totalOnly ? "3 4" : "5 5"}
                strokeWidth="1.5"
                vectorEffect="non-scaling-stroke"
              />
            ) : null}
            {totalOnly && chartStyle === "bar" ? (
              <g data-usage-total-bars className={seriesClassName(anyLoading)}>
                {columns.map((column, index) => {
                  // Bars sit on the curve's x positions so hover readouts line up. Width is capped
                  // (few periods would otherwise draw slabs) and edge bars are nudged inward
                  // rather than clipped, so every bar keeps the same width.
                  const width = Math.max(
                    2,
                    Math.min(MAX_BAR_WIDTH, (periods.length < 2 ? VIEW_WIDTH : stepX) * 0.62),
                  );
                  const point = periods.length < 2 ? VIEW_WIDTH / 2 : index * stepX;
                  const center = Math.min(VIEW_WIDTH - width / 2, Math.max(width / 2, point));
                  const left = center - width / 2;
                  const right = center + width / 2;
                  const top = toY(column.total);
                  const base = toY(0);
                  return (
                    <rect
                      key={periods[index]}
                      x={left}
                      y={top}
                      width={Math.max(0, right - left)}
                      height={Math.max(0, base - top)}
                      rx={1.5}
                      fill="var(--primary)"
                      fillOpacity={0.78}
                    />
                  );
                })}
              </g>
            ) : totalOnly ? (
              <>
                <defs>
                  <linearGradient id="usage-total-fill" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.16} />
                    <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <path
                  d={total.area}
                  className={seriesClassName(anyLoading)}
                  fill="url(#usage-total-fill)"
                />
                <path
                  d={total.line}
                  className={seriesClassName(anyLoading)}
                  fill="none"
                  stroke="var(--primary)"
                  strokeWidth={2}
                  vectorEffect="non-scaling-stroke"
                />
              </>
            ) : null}
            {(totalOnly ? [] : paths).map(({ provider, loading, area }) => (
              <path
                key={provider}
                d={area}
                className={seriesClassName(loading)}
                fill={PROVIDER_PRESENTATION[provider].color}
                fillOpacity={0.14}
              />
            ))}
            {(totalOnly ? [] : paths).map(({ provider, loading, line }) => (
              <path
                key={provider}
                d={line}
                className={seriesClassName(loading)}
                fill="none"
                stroke={PROVIDER_PRESENTATION[provider].color}
                strokeWidth={2}
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </g>
        </UsageChartPlot>
      </div>

      {totalOnly && periods.length > 6 ? (
        <div aria-hidden className="usage-axis-labels">
          {resolution === "hour"
            ? usageHourTicks(periods, timeZone).map((tick) => (
                <span
                  key={tick.at}
                  style={{
                    position: "absolute",
                    left: `${tick.position * 100}%`,
                    transform: "translateX(-50%)",
                  }}
                >
                  {tick.label}
                </span>
              ))
            : [0, 1, 2, 3, 4, 5].map((slot) => {
                const index = Math.round((slot * (periods.length - 1)) / 5);
                const period = periods[index];
                return <span key={slot}>{period === undefined ? "" : formatPeriod(period)}</span>;
              })}
        </div>
      ) : (
        <div
          aria-hidden
          className="flex justify-between pl-16 text-3xs text-muted-foreground uppercase"
        >
          <span>{periods[0] === undefined ? "" : formatPeriod(periods[0])}</span>
          <span>
            {periods[Math.floor(periods.length / 2)] === undefined
              ? ""
              : formatPeriod(periods[Math.floor(periods.length / 2)] ?? "")}
          </span>
          <span>
            {periods[periods.length - 1] === undefined
              ? ""
              : formatPeriod(periods[periods.length - 1] ?? "")}
          </span>
        </div>
      )}

      {/* The plot and its axes are hover-only; this carries the same figures for screen readers. */}
      <table className="sr-only">
        <caption>
          {copy("{period} {metric} by provider.", {
            period: copy(resolution === "hour" ? copy("Hourly") : copy("Per day")),
            metric: copy(metric === "tokens" ? copy("Tokens") : copy("Cost")),
          })}
        </caption>
        <thead>
          <tr>
            <th scope="col">{uiText(resolution === "hour" ? "Hour" : "Day")}</th>
            {providers.map((provider) => (
              <th key={provider} scope="col">
                {PROVIDER_PRESENTATION[provider].label}
              </th>
            ))}
            {providers.length > 1 ? <th scope="col">{uiText("Total")}</th> : null}
          </tr>
        </thead>
        <tbody>
          {periods.map((period, index) => {
            const column = columns[index];
            return (
              <tr key={period}>
                <th scope="row">{formatTooltipPeriod(period)}</th>
                {providers.map((provider) => (
                  <td key={provider}>
                    {format(column?.bands.find((band) => band.provider === provider)?.value ?? 0)}
                  </td>
                ))}
                {providers.length > 1 ? <td>{format(column?.total ?? 0)}</td> : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
