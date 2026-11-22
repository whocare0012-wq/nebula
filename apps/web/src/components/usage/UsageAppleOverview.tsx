import { uiText as copy } from "~/i18n";
// Apple-theme usage dashboard pieces (C77 + V9 dedicated Cost & Tokens pages).
// One accent ramp on greys, real data only.
import type { EnvironmentId, UsageProviderKind, UsageSummaryInput } from "@t3tools/contracts";
import {
  enumerateHourStarts,
  formatCount,
  formatPercent,
  formatTokens,
  makeWindow,
} from "@t3tools/shared/usageFormat";
import { costDisplayFactor, formatUsd, formatUsdWhole } from "./usageMoney";
import {
  computeTokensPerSecond,
  isModelCostUnknown,
  type MergedUsage,
} from "@t3tools/shared/usageMerge";
import { Fragment, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { observeResize } from "~/lib/observeResize";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import { Tooltip, TooltipPopup, TooltipProvider, TooltipTrigger } from "../ui/tooltip";
import { UsageDetailsSheet } from "./UsageDetailsSheet";
import { UsageCount } from "./UsageMotion";
import { useUiText } from "~/i18n/useUiText";
import { scopeUsageEnvironments, mergeUsageEnvironments } from "./usageAnalysis";
import { useUsage, type EnvironmentUsageStatus } from "../../state/usage";
import { cacheHitRate, modelShare, sortModelsByTokens } from "./usageBreakdown";
import { cacheInputRate } from "./usagePresentation";
import { PROVIDER_PRESENTATION, usageSeries, usageSeriesLabel } from "./usageProviders";
import { Toggle } from "../ui/toggle-group";
import { UsageSegments as ToggleGroup } from "./UsageSegments";
import "./costTokensV9.css";

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

export const ACCENT_TIERS = [100, 72, 46, 24] as const;
export const accentTier = (index: number) =>
  `color-mix(in srgb, var(--primary) ${ACCENT_TIERS[Math.min(index, 3)]}%, var(--card))`;

export function UsageSectionTitle({
  title,
  hint,
}: {
  readonly title: string;
  readonly hint?: string;
}) {
  return (
    <h2 className="usage-section-title">
      {title}
      {hint ? <span>{hint}</span> : null}
    </h2>
  );
}

type ProviderTotals = {
  readonly provider: UsageProviderKind;
  readonly costUsd: number;
  readonly totalTokens: number;
  readonly inputTokens: number;
  readonly cacheCreationTokens: number;
  readonly cachedInputTokens: number;
  readonly outputTokens: number;
  readonly sessions: number;
  readonly share: number;
};

export function providerTotals(
  merged: MergedUsage,
  rankedProviders: readonly UsageProviderKind[],
  metric: "cost" | "tokens",
): readonly ProviderTotals[] {
  return rankedProviders.map((provider) => {
    const rows = merged.providers.filter((entry) => usageSeries(entry.provider) === provider);
    const modelRows = merged.models.filter((entry) => usageSeries(entry.provider) === provider);
    const sum = (pick: (entry: (typeof rows)[number]) => number) =>
      rows.reduce((total, entry) => total + pick(entry), 0);
    const sumModels = (pick: (entry: (typeof modelRows)[number]) => number) =>
      modelRows.reduce((total, entry) => total + pick(entry), 0);
    return {
      provider,
      costUsd: sum((entry) => entry.costUsd),
      totalTokens: sum((entry) => entry.totalTokens),
      inputTokens: sumModels((entry) => entry.tokens.uncachedInputTokens),
      cacheCreationTokens: sumModels((entry) => entry.tokens.cacheCreationTokens),
      cachedInputTokens: sumModels((entry) => entry.tokens.cachedInputTokens),
      outputTokens: sumModels((entry) => entry.tokens.outputTokens),
      sessions: sum((entry) => entry.sessions),
      share: sum((entry) => (metric === "cost" ? entry.costShare : entry.tokenShare)),
    };
  });
}

/** 圆点 8 + 名称（下行灰色说明）+ 右对齐数值（下行次级值），下方 4 高进度条。 */
export function UsageProviderRows({
  rows,
  metric,
  loadingProviders,
  selectedProvider,
  onSelectProvider,
}: {
  readonly selectedProvider: UsageProviderKind | null;
  readonly onSelectProvider: (provider: UsageProviderKind) => void;
  readonly rows: readonly ProviderTotals[];
  readonly metric: "cost" | "tokens";
  readonly loadingProviders: ReadonlySet<UsageProviderKind>;
}) {
  return (
    <div className="usage-provider-rows" data-spread={rows.length >= 4 || undefined}>
      {rows.length > 1 ? (
        <div className="usage-comp-ribbon" aria-hidden="true">
          {rows.map((row, index) => (
            <span
              key={row.provider}
              data-dim={
                (selectedProvider !== null && selectedProvider !== row.provider) || undefined
              }
              style={{
                width: `${Math.max(2, Math.min(1, row.share) * 100)}%`,
                background: accentTier(index),
              }}
            />
          ))}
        </div>
      ) : null}
      {rows.map((row, index) => {
        const ioTotal = Math.max(1, row.cachedInputTokens + row.inputTokens + row.outputTokens);
        const cachePct = (row.cachedInputTokens / ioTotal) * 100;
        const inputPct = (row.inputTokens / ioTotal) * 100;
        const outputPct = (row.outputTokens / ioTotal) * 100;
        return (
          <button
            type="button"
            aria-pressed={selectedProvider === row.provider}
            onClick={() => onSelectProvider(row.provider)}
            data-dim={(selectedProvider !== null && selectedProvider !== row.provider) || undefined}
            key={row.provider}
            className="usage-provider-row"
            data-loading={loadingProviders.has(row.provider) || undefined}
          >
            <span className="usage-dot" style={{ background: accentTier(index) }} />
            <div className="usage-provider-name">
              <span>{usageSeriesLabel(row.provider)}</span>
              <small>
                {copy("{count} conversations · {share}", {
                  count: formatCount(row.sessions),
                  share: formatPercent(row.share),
                })}
                {/* V9: input/output ratio per provider on the tokens page. */}
                {metric === "tokens" && row.outputTokens > 0
                  ? ` · ${copy("In:Out {ratio}:1", {
                      ratio: ((row.inputTokens + row.cachedInputTokens) / row.outputTokens).toFixed(
                        (row.inputTokens + row.cachedInputTokens) / row.outputTokens >= 10 ? 0 : 1,
                      ),
                    })}`
                  : null}
              </small>
            </div>
            <div className="usage-provider-value">
              <strong>
                {metric === "cost" ? formatUsd(row.costUsd) : formatTokens(row.totalTokens)}
              </strong>
              <small>
                {metric === "cost" ? formatTokens(row.totalTokens) : formatUsd(row.costUsd)}
              </small>
            </div>
            {metric === "tokens" && row.totalTokens > 0 ? (
              <div className="usage-provider-bar usage-provider-io-bar" aria-hidden="true">
                {cachePct > 0 ? (
                  <span className="usage-io-cache" style={{ width: `${cachePct}%` }} />
                ) : null}
                {inputPct > 0 ? (
                  <span className="usage-io-input" style={{ width: `${inputPct}%` }} />
                ) : null}
                {outputPct > 0 ? (
                  <span className="usage-io-output" style={{ width: `${outputPct}%` }} />
                ) : null}
              </div>
            ) : (
              <div className="usage-provider-bar">
                <span
                  className="usage-grow"
                  style={{
                    width: `${Math.max(0, Math.min(1, row.share)) * 100}%`,
                    background: accentTier(index),
                  }}
                />
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** 费用页右侧：缓存省钱环形摘要 + beUI 平滑折叠洞察条。 */
export function UsageCostSavingsSummary({ merged }: { readonly merged: MergedUsage }) {
  const text = useUiText();
  const [insightOpen, setInsightOpen] = useState(false);
  const saved = merged.costQuality.cacheSavingsUsd;
  const actual = merged.costUsd;
  const baseline = actual + saved;
  const saveRate = baseline > 0 ? Math.max(0, Math.min(1, saved / baseline)) : 0;
  if (saved <= 0 && actual <= 0) return null;
  const radius = 34;
  const circumference = 2 * Math.PI * radius;
  return (
    <div className="usage-cost-savings">
      <div className="usage-cost-savings-top">
        <svg viewBox="0 0 84 84" className="usage-cost-ring" aria-hidden="true">
          <circle cx="42" cy="42" r={radius} fill="none" stroke="var(--muted)" strokeWidth="7" />
          <circle
            cx="42"
            cy="42"
            r={radius}
            fill="none"
            stroke="var(--primary)"
            strokeWidth="7"
            strokeLinecap="round"
            strokeDasharray={`${circumference * saveRate} ${circumference}`}
            transform="rotate(-90 42 42)"
          />
          <text x="42" y="46" textAnchor="middle" className="usage-cost-ring-pct">
            {Math.round(saveRate * 100)}%
          </text>
        </svg>
        <div className="usage-cost-savings-meta">
          <span>{text("Saved by cache")}</span>
          <strong>{formatUsd(saved)}</strong>
          <small>
            {copy("{count} cache reads", { count: formatTokens(merged.cachedInputTokens) })}
          </small>
        </div>
      </div>
      <div className="usage-beui-insight" data-open={insightOpen || undefined}>
        <button
          type="button"
          className="usage-beui-insight-head"
          aria-expanded={insightOpen}
          onClick={() => setInsightOpen((prev) => !prev)}
        >
          <span>{text("Cost efficiency insight")}</span>
          <small>{insightOpen ? text("Collapse") : text("Details")}</small>
        </button>
        <div className="usage-beui-insight-body">
          <p className="usage-beui-insight-inner">
            {copy(
              "Cache reduced estimated spend by {percent} (saved {savings} vs uncached input).",
              {
                percent: formatPercent(saveRate),
                savings: formatUsd(saved),
              },
            )}
          </p>
        </div>
      </div>
    </div>
  );
}

/** 令牌页右侧：缓存命中半圆 + 提供方列表。 */
export function UsageCacheGauge({ merged }: { readonly merged: MergedUsage }) {
  const rate = Math.max(0, Math.min(1, cacheInputRate(merged) ?? 0));
  const radius = 60;
  const half = Math.PI * radius;
  return (
    <div className="usage-cache-gauge">
      <svg viewBox="0 0 160 92" aria-hidden>
        <path
          d="M 20 80 A 60 60 0 0 1 140 80"
          fill="none"
          stroke="var(--muted)"
          strokeWidth="12"
          strokeLinecap="round"
        />
        <path
          className="usage-gauge-arc"
          d="M 20 80 A 60 60 0 0 1 140 80"
          fill="none"
          stroke="var(--primary)"
          strokeWidth="12"
          strokeLinecap="round"
          strokeDasharray={`${half * rate} ${half}`}
        />
      </svg>
      <div className="usage-gauge-value">
        <strong>{(rate * 100).toFixed(1)}</strong>
        <small>%</small>
      </div>
      <p>
        {copy("{count} cache reads · Saved {savings}", {
          count: formatTokens(merged.cachedInputTokens),
          savings: formatUsd(merged.costQuality.cacheSavingsUsd),
        })}
      </p>
    </div>
  );
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

function heatSummary(grid: readonly (readonly number[])[], weekdayOf: readonly number[]): string {
  const total = grid.flat().reduce((a, b) => a + b, 0);
  if (total <= 0) return copy("No usage in the last 7 days");
  const bands = [
    { label: copy("Night"), from: 0, to: 6 },
    { label: copy("Morning"), from: 6, to: 12 },
    { label: copy("Afternoon"), from: 12, to: 18 },
    { label: copy("Evening"), from: 18, to: 24 },
  ];
  const bandSums = bands.map((band) =>
    grid.reduce((sum, row) => sum + row.slice(band.from, band.to).reduce((a, b) => a + b, 0), 0),
  );
  const busiest = bands[bandSums.indexOf(Math.max(...bandSums))]?.label ?? "";
  let weekend = 0;
  let weekendDays = 0;
  grid.forEach((row, index) => {
    const day = weekdayOf[index] ?? 1;
    if (day === 0 || day === 6) {
      weekendDays += 1;
      weekend += row.reduce((a, b) => a + b, 0);
    }
  });
  const weekendLight = weekendDays > 0 && weekend / total < 0.08;
  return copy(
    weekendLight
      ? "Weekday {period} is busiest · Little weekend activity"
      : weekendDays > 0
        ? "Busiest in the {period}"
        : "Busiest on weekday {period}",
    { period: busiest },
  );
}

/** 活跃时段：最近 7 天 × 24 小时圆点热力图（真实小时数据，服务端按小时汇总）。 */
export function UsageActivityHeatmap({
  environmentIds,
  hiddenProviders,
  metric,
  selectedProvider,
  referenceTime,
}: {
  readonly referenceTime?: string;
  readonly selectedProvider?: UsageProviderKind | null;
  readonly environmentIds: ReadonlySet<EnvironmentId>;
  readonly hiddenProviders: ReadonlySet<UsageProviderKind>;
  readonly metric: "cost" | "tokens";
}) {
  const [window] = useState(() =>
    makeWindow(7, referenceTime === undefined ? undefined : new Date(referenceTime), "hour"),
  );
  const usage = useUsage(window, environmentIds, hiddenProviders);
  const [open, setOpen] = useState(false);
  const text = useUiText();
  const [view, setView] = useState("grid");
  const [hovered, setHovered] = useState<{ label: string; value: number } | null>(null);
  const merged = mergeUsageEnvironments(
    scopeUsageEnvironments(usage.selectedEnvironments, hiddenProviders, selectedProvider ?? null),
  );
  const timeZone = window.timeZone;
  const dayFormat = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const hourFormat = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    hourCycle: "h23",
  });
  // A rolling seven-day interval can cross eight calendar dates. Keep both partial days.
  const days = [
    ...new Set(
      enumerateHourStarts(window.sinceTime ?? "", window.untilTime ?? "").map((start) =>
        dayFormat.format(new Date(start)),
      ),
    ),
  ];
  const weekdayOf = days.map((day) => new Date(`${day}T12:00:00Z`).getUTCDay());
  const grid = days.map(() => Array.from({ length: 24 }, () => 0));
  for (const entry of merged.hourly) {
    const at = new Date(entry.hourStart);
    const row = days.indexOf(dayFormat.format(at));
    const hour = Number.parseInt(hourFormat.format(at), 10) % 24;
    const cells = grid[row];
    if (cells && Number.isFinite(hour)) {
      cells[hour] = (cells[hour] ?? 0) + (metric === "cost" ? entry.costUsd : entry.totalTokens);
    }
  }
  const peak = Math.max(0, ...grid.flat());
  // Hours under 3% of the busiest hour stay grey so the busy pattern reads at a glance.
  const level = (value: number) =>
    value <= 0 || peak <= 0 || value / peak < 0.03 ? 0 : Math.max(1, Math.ceil((value / peak) * 5));
  const pending = usage.isPending && usage.merged.hourly.length === 0;
  const weekdays = [1, 2, 3, 4, 5, 6, 0].map((day) => ({
    label: copy(WEEKDAYS[day]!),
    value: grid.reduce(
      (sum, row, index) => (weekdayOf[index] === day ? sum + row.reduce((a, b) => a + b, 0) : sum),
      0,
    ),
  }));
  const rhythm = HOURS.map((hour) => ({
    label: `${String(hour).padStart(2, "0")}:00`,
    value: grid.reduce((sum, row) => sum + (row[hour] ?? 0), 0),
  }));
  const format = metric === "cost" ? formatUsd : formatTokens;
  const heatGrid = (
    <div
      className="usage-heat-grid"
      role="img"
      aria-label={copy("Hourly usage over the last 7 days")}
    >
      {grid.map((cells, row) => (
        <div className="usage-heat-row" key={days[row]}>
          <span>{copy(WEEKDAYS[weekdayOf[row] ?? 0] ?? "")}</span>
          {HOURS.map((hour) => (
            <i
              key={hour}
              data-level={level(cells[hour] ?? 0)}
              style={{ animationDelay: `${(row * 24 + hour) * 7}ms` }}
            />
          ))}
        </div>
      ))}
    </div>
  );
  return (
    <>
      <section data-usage-card className="usage-heat-card" aria-busy={pending}>
        <div className="usage-card-title">
          <span>
            {copy("Activity by time")}
            <em>{copy("Last 7 days")}</em>
          </span>
          <button type="button" className="usage-expand" onClick={() => setOpen(true)}>
            {copy("Expand")}
          </button>
        </div>
        {heatGrid}
        <div className="usage-heat-foot">
          <span>{pending ? copy("Loading….") : heatSummary(grid, weekdayOf)}</span>
          <span className="usage-heat-legend" aria-hidden>
            {copy("Less")}
            {[0, 1, 2, 3, 4, 5].map((value) => (
              <i key={value} data-level={value} />
            ))}
            {copy("More.")}
          </span>
        </div>
      </section>
      <UsageDetailsSheet
        open={open}
        onOpenChange={setOpen}
        width={720}
        title={copy("Activity by time")}
        description={copy("{provider} · Last 7 days · One hour per cell", {
          provider: selectedProvider ? usageSeriesLabel(selectedProvider) : copy("All providers"),
        })}
      >
        <dl className="usage-model-stats">
          <div>
            <dt>{copy("7-day total")}</dt>
            <dd>{format(grid.flat().reduce((a, b) => a + b, 0))}</dd>
          </div>
          <div>
            <dt>{copy("Busiest hour")}</dt>
            <dd>{format(peak)}</dd>
          </div>
          <div>
            <dt>{copy("Days with usage")}</dt>
            <dd>
              {copy("{count} days", { count: grid.filter((row) => row.some((v) => v > 0)).length })}
            </dd>
          </div>
          <div>
            <dt>{copy("Today")}</dt>
            <dd>{format(grid.at(-1)?.reduce((a, b) => a + b, 0) ?? 0)}</dd>
          </div>
        </dl>
        <ToggleGroup
          aria-label={text("Activity view")}
          value={[view]}
          onValueChange={(values) => {
            if (values[0]) {
              setView(values[0]);
              setHovered(null);
            }
          }}
        >
          <Toggle value="grid">{text("By hour")}</Toggle>
          <Toggle value="week">{text("By weekday")}</Toggle>
          <Toggle value="day">{text("Time of day")}</Toggle>
        </ToggleGroup>
        <div className="usage-readout" data-usage-readout role="status">
          <div>
            <span>{hovered?.label ?? text("Hover over an hour to see its usage")}</span>
            <strong>
              {hovered
                ? format(hovered.value)
                : text("7-day total: {value}", {
                    value: format(grid.flat().reduce((a, b) => a + b, 0)),
                  })}
            </strong>
          </div>
        </div>
        <div className="usage-activity-view" onMouseLeave={() => setHovered(null)}>
          <svg
            viewBox={`0 0 672 ${view === "grid" ? days.length * 30 + 28 : 236}`}
            role="img"
            aria-label={text("Heatmap of hourly usage over the last 7 days")}
          >
            {view === "grid" ? (
              <>
                {grid.map((row, r) => (
                  <g key={days[r]}>
                    <text x={0} y={r * 30 + 20}>
                      {copy(WEEKDAYS[weekdayOf[r] ?? 0] ?? "")}
                    </text>
                    {row.map((value, h) => (
                      <rect
                        key={HOURS[h]}
                        data-heat-cell
                        data-value={value}
                        x={40 + h * (632 / 24) + 1.5}
                        y={r * 30 + 4}
                        width={632 / 24 - 3}
                        height={24}
                        rx={5}
                        fill={
                          level(value) === 0
                            ? "var(--muted)"
                            : accentTier(4 - Math.min(4, level(value)))
                        }
                        stroke={
                          hovered?.label === `${days[r]} ${String(h).padStart(2, "0")}:00`
                            ? "var(--foreground)"
                            : "none"
                        }
                        strokeWidth={1.5}
                        tabIndex={0}
                        role="img"
                        aria-label={`${days[r]} ${h}:00 · ${format(value)}`}
                        onMouseEnter={() =>
                          setHovered({
                            label: `${days[r]} ${String(h).padStart(2, "0")}:00`,
                            value,
                          })
                        }
                        onFocus={() =>
                          setHovered({
                            label: `${days[r]} ${String(h).padStart(2, "0")}:00`,
                            value,
                          })
                        }
                      />
                    ))}
                  </g>
                ))}
                {[0, 6, 12, 18].map((hour) => (
                  <text
                    key={hour}
                    x={40 + ((hour + 0.5) * 632) / 24}
                    y={days.length * 30 + 22}
                    textAnchor="middle"
                  >
                    {String(hour).padStart(2, "0")}:00
                  </text>
                ))}
              </>
            ) : (
              (() => {
                const rows = view === "week" ? weekdays : rhythm;
                const max = Math.max(1, ...rows.map((r) => r.value)),
                  step = 632 / rows.length;
                return rows.map((row, i) => (
                  <g key={row.label} onMouseEnter={() => setHovered(row)}>
                    <rect
                      data-activity-bar
                      x={40 + i * step + step * 0.15}
                      y={200 - (row.value / max) * 180}
                      width={step * 0.7}
                      height={(row.value / max) * 180}
                      rx={3}
                      fill={
                        row.value === max
                          ? "var(--primary)"
                          : "color-mix(in srgb,var(--foreground) 22%,var(--card))"
                      }
                    />
                    <rect
                      x={40 + i * step}
                      y={0}
                      width={step}
                      height={202}
                      fill="transparent"
                      tabIndex={0}
                      role="img"
                      aria-label={`${row.label} · ${format(row.value)}`}
                      onFocus={() => setHovered(row)}
                    />
                    {view === "week" || i % 6 === 0 ? (
                      <text x={40 + (i + 0.5) * step} y={224} textAnchor="middle">
                        {row.label}
                      </text>
                    ) : null}
                  </g>
                ));
              })()
            )}
          </svg>
        </div>
        <p className="usage-card-hint">
          {copy("Hours are grouped by local weekday and time. Hours with no usage show zero.")}
        </p>
      </UsageDetailsSheet>
    </>
  );
}

type BreakdownTab = "model" | "project" | "time";

/** 按模型 / 项目 / 小时：固定 6 行，序号 01、色点、名称、右对齐数值、占比；点模型行滑出详情。 */
export function UsageBreakdownCard({
  merged,
  metric,
  hourly,
  formatPeriod,
  onSelectModel,
  aside,
  selectedHour,
  onClearHour,
}: {
  readonly merged: MergedUsage;
  readonly metric: "cost" | "tokens";
  readonly hourly: boolean;
  readonly formatPeriod: (period: string) => string;
  readonly onSelectModel: (key: string) => void;
  readonly aside?: ReactNode;
  readonly selectedHour?: string | null;
  readonly onClearHour?: () => void;
}) {
  const [tab, setTab] = useState<BreakdownTab>("model");
  const [expandedTab, setExpandedTab] = useState<BreakdownTab | null>(null);
  const value = (row: { costUsd: number; totalTokens: number }) =>
    metric === "cost" ? row.costUsd : row.totalTokens;
  const total = metric === "cost" ? merged.costUsd : merged.totalTokens;
  const share = (amount: number) => (total > 0 ? amount / total : 0);
  type Row = {
    key: string;
    label: string;
    amount: number;
    shown: string;
    pct: number | null;
    onClick?: () => void;
  };
  const format = metric === "cost" ? formatUsd : formatTokens;
  const rows: Row[] =
    tab === "model"
      ? (metric === "tokens" ? sortModelsByTokens(merged.models) : merged.models).map((model) => {
          const key = `${model.provider}:${model.model}`;
          return {
            key,
            label: model.model,
            amount: value(model),
            shown:
              metric === "cost" && isModelCostUnknown(model)
                ? copy("Unpriced")
                : format(value(model)),
            pct: modelShare(model, metric),
            onClick: () => onSelectModel(key),
          };
        })
      : tab === "project"
        ? merged.projects
            .toSorted((a, b) => value(b) - value(a))
            .map((project) => ({
              key: String(project.key),
              label:
                project.kind === "project"
                  ? project.title
                  : project.kind === "unlinked"
                    ? copy("Outside T3 conversations")
                    : copy("Not reported by this server."),
              amount: value(project),
              shown: format(value(project)),
              pct: share(value(project)),
            }))
        : (hourly ? merged.hourly : merged.daily)
            .map((period) => {
              const id = String("hourStart" in period ? period.hourStart : period.day);
              return {
                key: id,
                label: formatPeriod(id),
                amount: value(period),
                shown: format(value(period)),
                pct: share(value(period)),
              };
            })
            .toSorted((a, b) => b.amount - a.amount);
  const expanded = expandedTab === tab;
  const visible = expanded ? rows : rows.slice(0, 6);
  const peak = Math.max(0, ...visible.map((row) => row.amount));
  const rank = (amount: number) =>
    peak <= 0 ? 3 : amount >= peak ? 0 : amount >= peak * 0.4 ? 1 : amount >= peak * 0.1 ? 2 : 3;
  return (
    <section data-usage-card className="usage-breakdown-card">
      <div className="usage-card-title">
        <span>
          {tab === "model"
            ? copy("By model")
            : tab === "project"
              ? copy("By project.")
              : hourly
                ? copy("By hour")
                : copy("By day")}
        </span>
        <ToggleGroup
          aria-label={copy("Usage breakdown")}
          variant="segmented"
          value={[tab]}
          onValueChange={(next) => {
            const picked = next[0];
            if (picked === "model" || picked === "project" || picked === "time") setTab(picked);
          }}
        >
          <Toggle value="model">{copy("Model")}</Toggle>
          <Toggle value="project">{copy("Project")}</Toggle>
          <Toggle value="time">{hourly ? copy("hour") : copy("day")}</Toggle>
        </ToggleGroup>
      </div>
      {selectedHour ? (
        <p className="usage-hour-filter">
          {copy("Show only {period}", { period: formatPeriod(selectedHour) })}
          <button type="button" onClick={onClearHour}>
            {copy("Clear hour filter")}
          </button>
        </p>
      ) : null}
      <table className="usage-breakdown-table">
        <thead>
          <tr>
            <th>#</th>
            <th>
              {tab === "model"
                ? copy("Model")
                : tab === "project"
                  ? copy("Project")
                  : hourly
                    ? copy("hour")
                    : copy("Date")}
            </th>
            <th>{metric === "cost" ? copy("Cost") : copy("Tokens")}</th>
            <th>{copy("Share")}</th>
          </tr>
        </thead>
        <tbody>
          {visible.length === 0 ? (
            <tr>
              <td colSpan={4} className="usage-breakdown-empty">
                {copy("No usage in this period")}
              </td>
            </tr>
          ) : (
            visible.map((row, index) => (
              <tr
                key={row.key}
                data-clickable={row.onClick ? true : undefined}
                onClick={row.onClick}
                onKeyDown={(event) => {
                  if (row.onClick && (event.key === "Enter" || event.key === " ")) {
                    event.preventDefault();
                    row.onClick();
                  }
                }}
                tabIndex={row.onClick ? 0 : undefined}
                aria-label={
                  row.onClick ? copy("View details for {model}", { model: row.label }) : undefined
                }
              >
                <td>{String(index + 1).padStart(2, "0")}</td>
                <td>
                  {row.onClick ? (
                    <span className="usage-breakdown-label">
                      <span
                        className="usage-swatch"
                        style={{ background: accentTier(rank(row.amount)) }}
                      />
                      {row.label}
                    </span>
                  ) : (
                    <span className="usage-breakdown-label">
                      <span
                        className="usage-swatch"
                        style={{ background: accentTier(rank(row.amount)) }}
                      />
                      {row.label}
                    </span>
                  )}
                </td>
                <td>{row.shown}</td>
                <td>{row.pct === null ? "" : formatPercent(row.pct)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
      {rows.length > 6 ? (
        <button
          type="button"
          className="usage-breakdown-more"
          aria-expanded={expanded}
          onClick={() => setExpandedTab(expanded ? null : tab)}
        >
          {copy("{action} · Sorted by {metric}", {
            action: expanded
              ? copy("Collapse recommendation")
              : copy("Show all · {count} more", { count: rows.length - 6 }),
            metric: copy(metric === "cost" ? copy("Cost") : copy("Tokens")),
          })}
        </button>
      ) : (
        (aside ?? null)
      )}
    </section>
  );
}

export const PROVIDER_LABEL = (provider: UsageProviderKind) =>
  PROVIDER_PRESENTATION[provider].label;

const V9_PROVIDER_COLOR: Record<UsageProviderKind, string> = {
  codex: "var(--ctv9-prov-codex)",
  claude: "var(--ctv9-prov-claude)",
  antigravity: "var(--ctv9-prov-antigravity)",
  grok: "var(--ctv9-prov-grok)",
  cursor: "var(--ctv9-prov-other)",
  opencode: "var(--ctv9-prov-other)",
  pi: "var(--ctv9-prov-other)",
  muse: "var(--ctv9-prov-other)",
};

function v9ProviderColor(provider: UsageProviderKind): string {
  return V9_PROVIDER_COLOR[provider] ?? "var(--ctv9-prov-other)";
}

function formatUsdCompact(value: number): string {
  if (Math.abs(value * costDisplayFactor()) >= 100) return formatUsdWhole(value);
  return formatUsd(value);
}

function formatAxisUsd(value: number, maxValue: number): string {
  if (value <= 0 || maxValue * costDisplayFactor() >= 4) return formatUsdWhole(value);
  return formatUsd(value);
}

function formatHourRangeLabel(label: string): string {
  const match = /^(\d{1,2}):(\d{2})$/.exec(label.trim());
  if (!match) return label;
  const start = Number.parseInt(match[1] ?? "0", 10);
  const next = (start + 1) % 24;
  return `${String(start).padStart(2, "0")}:00 – ${String(next).padStart(2, "0")}:00`;
}

function scopeEnvironmentsByPeriod(
  environments: readonly EnvironmentUsageStatus[],
  period: string | null,
  hourly: boolean,
): readonly EnvironmentUsageStatus[] {
  if (period === null) return environments;
  if (hourly) {
    return scopeUsageEnvironments(environments, new Set(), null, period);
  }
  return environments.map((environment) => {
    if (!environment.summary) return environment;
    const { projectTotals: _ignored, ...summary } = environment.summary;
    return {
      ...environment,
      summary: {
        ...summary,
        buckets: summary.buckets.filter((bucket) => bucket.day === period),
      },
    };
  });
}

function providerTimeSeries(
  merged: MergedUsage,
  periods: readonly string[],
  provider: UsageProviderKind,
  hourly: boolean,
  metric: "cost" | "tokens",
): readonly number[] {
  const map = new Map<string, number>();
  if (hourly) {
    for (const entry of merged.hourly) {
      let sum = 0;
      for (const [kind, val] of entry.byProvider) {
        if (usageSeries(kind) === provider) {
          sum += metric === "cost" ? val.costUsd : val.totalTokens;
        }
      }
      map.set(entry.hourStart, (map.get(entry.hourStart) ?? 0) + sum);
    }
  } else {
    for (const entry of merged.daily) {
      let sum = 0;
      for (const [kind, val] of entry.byProvider) {
        if (usageSeries(kind) === provider) {
          sum += metric === "cost" ? val.costUsd : val.totalTokens;
        }
      }
      map.set(entry.day, (map.get(entry.day) ?? 0) + sum);
    }
  }
  return periods.map((period) => map.get(period) ?? 0);
}

/** V9 Segmented control with spring sliding pill (340ms cubic-bezier(0.3, 0.7, 0.2, 1)). */
export function V9SegControl<T extends string>({
  ariaLabel,
  value,
  options,
  onChange,
}: {
  readonly ariaLabel: string;
  readonly value: T;
  readonly options: readonly {
    readonly value: T;
    readonly label: string;
    readonly title?: string;
  }[];
  readonly onChange: (value: T) => void;
}) {
  const segRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLSpanElement>(null);
  const initializedRef = useRef(false);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- syncs the V9 sliding pill geometry to the active segment button
  useLayoutEffect(() => {
    const seg = segRef.current;
    const pill = pillRef.current;
    if (!seg || !pill || options.length === 0) return;
    const move = (instant: boolean) => {
      const buttons = [...seg.querySelectorAll<HTMLButtonElement>("button[data-seg-val]")];
      const active = buttons.find((button) => button.dataset.segVal === value) ?? buttons[0];
      if (!active) return;
      if (instant) pill.style.transition = "none";
      pill.style.width = `${active.offsetWidth}px`;
      pill.style.transform = `translateX(${active.offsetLeft}px)`;
      if (instant) {
        void pill.offsetHeight;
        pill.style.transition = "";
      }
    };
    move(!initializedRef.current);
    initializedRef.current = true;
    return observeResize(seg, () => move(true));
  }, [value, options.length]);

  return (
    <div ref={segRef} data-ctv9="seg" role="group" aria-label={ariaLabel}>
      <span ref={pillRef} data-ctv9="seg-pill" aria-hidden />
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            data-seg-val={option.value}
            data-on={active ? "true" : undefined}
            aria-pressed={active}
            aria-description={option.title}
            onClick={() => {
              if (!active) onChange(option.value);
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/** Authentic brand vector logos matching V9 `.logo-slot` (20×20 rounded 6px, 13×13 SVG). */
function V9BrandLogo({ provider }: { readonly provider: UsageProviderKind }) {
  const gemGradId = useId();
  const series = usageSeries(provider);
  const presentation = PROVIDER_PRESENTATION[provider];

  if (series === "claude") {
    return (
      <span data-ctv9="logo-slot" aria-hidden>
        <svg viewBox="0 0 16 16" fill="var(--ctv9-claude-logo)">
          <path d="m3.127 10.604 3.135-1.76.053-.153-.053-.085H6.11l-.525-.032-1.791-.048-1.554-.065-1.505-.08-.38-.081L0 7.832l.036-.234.32-.214.455.04 1.009.069 1.513.105 1.097.064 1.626.17h.259l.036-.105-.089-.065-.068-.064-1.566-1.062-1.695-1.121-.887-.646-.48-.327-.243-.306-.104-.67.435-.48.585.04.15.04.593.456 1.267.981 1.654 1.218.242.202.097-.068.012-.049-.109-.181-.9-1.626-.96-1.655-.428-.686-.113-.411a2 2 0 0 1-.068-.484l.496-.674L4.446 0l.662.089.279.242.411.94.666 1.48 1.033 2.014.302.597.162.553.06.17h.105v-.097l.085-1.134.157-1.392.154-1.792.052-.504.25-.605.497-.327.387.186.319.456-.045.294-.19 1.23-.37 1.93-.243 1.29h.142l.161-.16.654-.868 1.097-1.372.484-.545.565-.601.363-.287h.686l.505.751-.226.775-.707.895-.585.759-.839 1.13-.524.904.048.072.125-.012 1.897-.403 1.024-.186 1.223-.21.553.258.06.263-.218.536-1.307.323-1.533.307-2.284.54-.028.02.032.04 1.029.098.44.024h1.077l2.005.15.525.346.315.424-.053.323-.807.411-3.631-.863-.872-.218h-.12v.073l.726.71 1.331 1.202 1.667 1.55.084.383-.214.302-.226-.032-1.464-1.101-.565-.497-1.28-1.077h-.084v.113l.295.432 1.557 2.34.08.718-.112.234-.404.141-.444-.08-.911-1.28-.94-1.44-.759-1.291-.093.053-.448 4.821-.21.246-.484.186-.403-.307-.214-.496.214-.98.258-1.28.21-1.016.19-1.263.112-.42-.008-.028-.092.012-.953 1.307-1.448 1.957-1.146 1.227-.274.109-.477-.247.045-.44.266-.39 1.586-2.018.956-1.25.617-.723-.004-.105h-.036l-4.212 2.736-.75.096-.324-.302.04-.496.154-.162 1.267-.871z" />
        </svg>
      </span>
    );
  }
  if (series === "codex") {
    return (
      <span data-ctv9="logo-slot" aria-hidden>
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z" />
        </svg>
      </span>
    );
  }
  if (series === "antigravity") {
    return (
      <span data-ctv9="logo-slot" aria-hidden>
        <svg viewBox="0 0 24 24" fill="none">
          <defs>
            <linearGradient
              id={gemGradId}
              x1="0"
              y1="0"
              x2="24"
              y2="24"
              gradientUnits="userSpaceOnUse"
            >
              <stop offset="0%" stopColor="var(--ctv9-gem-0)" />
              <stop offset="52%" stopColor="var(--ctv9-gem-1)" />
              <stop offset="100%" stopColor="var(--ctv9-gem-2)" />
            </linearGradient>
          </defs>
          <path
            d="M12 1.5C12.8 7.6 16.4 11.2 22.5 12C16.4 12.8 12.8 16.4 12 22.5C11.2 16.4 7.6 12.8 1.5 12C7.6 11.2 11.2 7.6 12 1.5Z"
            fill={`url(#${gemGradId})`}
          />
        </svg>
      </span>
    );
  }
  if (series === "grok") {
    return (
      <span data-ctv9="logo-slot" aria-hidden>
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d="M10.45 14.88 18.88 4.2a1.05 1.05 0 0 1 1.62 1.32l-8.43 10.68a1.05 1.05 0 0 1-1.62-1.32Z" />
          <path d="M12 21.2A9.2 9.2 0 1 1 17.6 4.7a1.05 1.05 0 0 1-1.26 1.68A7.1 7.1 0 1 0 19.1 12a7 7 0 0 0-.35-2.2 1.05 1.05 0 0 1 2-.65A9.2 9.2 0 0 1 12 21.2Z" />
        </svg>
      </span>
    );
  }
  return (
    <span data-ctv9="logo-slot" aria-hidden>
      <ProviderInstanceIcon
        driverKind={presentation.driverKind}
        displayName={presentation.label}
        iconClassName="size-3"
      />
    </span>
  );
}

/** V9 76×26 provider micro-sparkline (`sparkSvg` equivalent). */
function V9ProviderSparkline({
  values,
  color,
}: {
  readonly values: readonly number[];
  readonly color: string;
}) {
  const w = 76;
  const h = 26;
  if (values.length < 2) {
    return (
      <svg data-ctv9="prov-spark-svg" viewBox={`0 0 ${w} ${h}`} aria-hidden>
        <line
          x1={0}
          y1={h - 3}
          x2={w}
          y2={h - 3}
          stroke={color}
          strokeOpacity={0.35}
          strokeWidth={1.5}
        />
      </svg>
    );
  }
  const max = Math.max(...values, 0.0001);
  const min = Math.min(...values, 0);
  const span = Math.max(0.0001, max - min);
  const coords = values.map(
    (v, i) => [(i / (values.length - 1)) * w, h - ((v - min) / span) * (h - 6) - 3] as const,
  );
  const d = coords
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p[0].toFixed(2)} ${p[1].toFixed(2)}`)
    .join(" ");
  return (
    <svg data-ctv9="prov-spark-svg" viewBox={`0 0 ${w} ${h}`} aria-hidden>
      <path d={`${d} L ${w} ${h} L 0 ${h} Z`} fill={color} opacity={0.12} />
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** V9 7×24 Activity Dot Matrix with missing (dashed), zero (gray), and 4 heat tiers. */
function V9ActivityHeatmapCard({
  environmentIds,
  hiddenProviders,
  metric,
  selectedProvider,
  referenceTime,
}: {
  readonly environmentIds: ReadonlySet<EnvironmentId>;
  readonly hiddenProviders: ReadonlySet<UsageProviderKind>;
  readonly metric: "cost" | "tokens";
  readonly selectedProvider: UsageProviderKind | null;
  readonly referenceTime?: string;
}) {
  const text = useUiText();
  const [window] = useState(() =>
    makeWindow(7, referenceTime === undefined ? undefined : new Date(referenceTime), "hour"),
  );
  const usage = useUsage(window, environmentIds, hiddenProviders);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetView, setSheetView] = useState("grid");
  const [sheetHovered, setSheetHovered] = useState<{ label: string; value: number } | null>(null);
  const [dotReadout, setDotReadout] = useState<string | null>(null);

  const scoped = scopeUsageEnvironments(
    usage.selectedEnvironments,
    hiddenProviders,
    selectedProvider,
  );
  const merged = mergeUsageEnvironments(scoped);

  const timeZone = window.timeZone;
  const dayFormat = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const hourFormat = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    hourCycle: "h23",
  });

  const windowHours = enumerateHourStarts(window.sinceTime ?? "", window.untilTime ?? "");
  const coveredSlots = new Set<string>();
  const allDaysOrdered: string[] = [];
  for (const start of windowHours) {
    const at = new Date(start);
    const dayKey = dayFormat.format(at);
    const hr = Number.parseInt(hourFormat.format(at), 10) % 24;
    if (!allDaysOrdered.includes(dayKey)) allDaysOrdered.push(dayKey);
    coveredSlots.add(`${dayKey}#${hr}`);
  }
  // Keep the 7 most recent calendar days so the matrix stays a clean 7×24 grid like V9.
  const days = allDaysOrdered.slice(-7);
  const weekdayOf = days.map((day) => new Date(`${day}T12:00:00Z`).getUTCDay());
  const grid = days.map(() => Array.from({ length: 24 }, () => 0));
  const hitGrid = days.map(() => Array.from({ length: 24 }, () => ({ cached: 0, input: 0 })));

  for (const entry of merged.hourly) {
    const at = new Date(entry.hourStart);
    const row = days.indexOf(dayFormat.format(at));
    const hour = Number.parseInt(hourFormat.format(at), 10) % 24;
    const cells = grid[row];
    if (cells && Number.isFinite(hour)) {
      cells[hour] = (cells[hour] ?? 0) + (metric === "cost" ? entry.costUsd : entry.totalTokens);
    }
  }
  if (metric === "tokens") {
    for (const env of scoped) {
      for (const bucket of env.summary?.buckets ?? []) {
        if (!bucket.hourStart) continue;
        const at = new Date(bucket.hourStart);
        const row = days.indexOf(dayFormat.format(at));
        const hour = Number.parseInt(hourFormat.format(at), 10) % 24;
        const cell = hitGrid[row]?.[hour];
        if (cell) {
          cell.cached += bucket.totals.cachedInputTokens;
          cell.input +=
            bucket.totals.cachedInputTokens +
            bucket.totals.uncachedInputTokens +
            bucket.totals.cacheCreationTokens;
        }
      }
    }
  }

  let peak = 0;
  let peakRow = -1;
  let peakHour = -1;
  grid.forEach((cells, r) => {
    cells.forEach((val, h) => {
      if (val > peak) {
        peak = val;
        peakRow = r;
        peakHour = h;
      }
    });
  });

  const format = metric === "cost" ? formatUsd : formatTokens;
  const weekdayLabel = (row: number) => copy(WEEKDAYS[weekdayOf[row] ?? 0] ?? "");
  const defaultReadout =
    metric === "cost"
      ? text("Hover a dot for hourly cost")
      : text("Hover a dot for hourly tokens and hit rate");

  const peakLabel =
    peak > 0 && peakRow >= 0 && peakHour >= 0
      ? metric === "cost"
        ? text("Peak: {day} {hour} · {value}", {
            day: weekdayLabel(peakRow),
            hour: `${String(peakHour).padStart(2, "0")}:00`,
            value: formatUsd(peak),
          })
        : text("Peak: {day} {hour} · {value} tokens", {
            day: weekdayLabel(peakRow),
            hour: `${String(peakHour).padStart(2, "0")}:00`,
            value: formatTokens(peak),
          })
      : copy("No usage in the last 7 days");

  const sheetWeekdays = [1, 2, 3, 4, 5, 6, 0].map((day) => ({
    label: copy(WEEKDAYS[day]!),
    value: grid.reduce(
      (sum, row, index) => (weekdayOf[index] === day ? sum + row.reduce((a, b) => a + b, 0) : sum),
      0,
    ),
  }));
  const sheetRhythm = HOURS.map((hour) => ({
    label: `${String(hour).padStart(2, "0")}:00`,
    value: grid.reduce((sum, row) => sum + (row[hour] ?? 0), 0),
  }));
  const sheetLevel = (value: number) =>
    value <= 0 || peak <= 0 || value / peak < 0.03 ? 0 : Math.max(1, Math.ceil((value / peak) * 5));

  return (
    <>
      <section data-ctv9="card" data-layout="col-between" data-usage-card>
        <div>
          <div data-ctv9="card-title">
            <span>
              {metric === "cost" ? text("7×24 cost activity") : text("7×24 token activity")}
            </span>
            <span data-ctv9="spacer" />
            <span data-ctv9="card-sub" data-ctv9-num>
              {dotReadout ?? defaultReadout}
            </span>
            <button type="button" data-ctv9="hm-expand-btn" onClick={() => setSheetOpen(true)}>
              {copy("Expand")}
            </button>
          </div>
          <div
            data-ctv9="hm-grid"
            role="img"
            aria-label={copy("Hourly usage over the last 7 days")}
            onMouseLeave={() => setDotReadout(null)}
          >
            <div />
            {HOURS.map((hour) => (
              <div key={hour} data-ctv9="hm-axis-lbl" data-ctv9-num>
                {hour % 4 === 0 ? hour : ""}
              </div>
            ))}
            {days.map((day, row) => {
              const dLabel = weekdayLabel(row);
              return (
                <Fragment key={day}>
                  <div data-ctv9="hm-lbl">{dLabel}</div>
                  {HOURS.map((hour) => {
                    const hrText = `${String(hour).padStart(2, "0")}:00`;
                    const covered = coveredSlots.has(`${day}#${hour}`);
                    const val = grid[row]?.[hour] ?? 0;
                    if (!covered) {
                      const info = text("{day} {hour} · Missing data", {
                        day: dLabel,
                        hour: hrText,
                      });
                      return (
                        <div
                          key={hour}
                          data-ctv9="hm-dot"
                          data-hm-state="missing"
                          onMouseEnter={() => setDotReadout(info)}
                        />
                      );
                    }
                    if (val <= 0) {
                      const info = text("{day} {hour} · Zero usage", {
                        day: dLabel,
                        hour: hrText,
                      });
                      return (
                        <div
                          key={hour}
                          data-ctv9="hm-dot"
                          data-hm-state="zero"
                          onMouseEnter={() => setDotReadout(info)}
                        />
                      );
                    }
                    const lv = Math.min(3, Math.floor((val / Math.max(peak, 0.0001)) * 3.999));
                    const hitCell = hitGrid[row]?.[hour];
                    const hitPct =
                      hitCell && hitCell.input > 0
                        ? formatPercent(hitCell.cached / hitCell.input)
                        : null;
                    const info =
                      metric === "cost"
                        ? text("{day} {hour} · Est. {value}", {
                            day: dLabel,
                            hour: hrText,
                            value: formatUsd(val),
                          })
                        : hitPct
                          ? text("{day} {hour} · {value} tokens · Hit {rate}", {
                              day: dLabel,
                              hour: hrText,
                              value: formatTokens(val),
                              rate: hitPct,
                            })
                          : text("{day} {hour} · {value} tokens", {
                              day: dLabel,
                              hour: hrText,
                              value: formatTokens(val),
                            });
                    return (
                      <div
                        key={hour}
                        data-ctv9="hm-dot"
                        data-lv={lv}
                        data-hm-state="active"
                        onMouseEnter={() => setDotReadout(info)}
                      />
                    );
                  })}
                </Fragment>
              );
            })}
          </div>
        </div>
        <div data-ctv9="hm-foot">
          <span>{text("Dashed: missing · Gray: zero · 4 heat levels")}</span>
          <span data-ctv9-num>{peakLabel}</span>
        </div>
      </section>

      <UsageDetailsSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        width={720}
        title={copy("Activity by time")}
        description={copy("{provider} · Last 7 days · One hour per cell", {
          provider: selectedProvider ? usageSeriesLabel(selectedProvider) : copy("All providers"),
        })}
      >
        <dl className="usage-model-stats">
          <div>
            <dt>{copy("7-day total")}</dt>
            <dd>{format(grid.flat().reduce((a, b) => a + b, 0))}</dd>
          </div>
          <div>
            <dt>{copy("Busiest hour")}</dt>
            <dd>{format(peak)}</dd>
          </div>
          <div>
            <dt>{copy("Days with usage")}</dt>
            <dd>
              {copy("{count} days", { count: grid.filter((row) => row.some((v) => v > 0)).length })}
            </dd>
          </div>
          <div>
            <dt>{copy("Today")}</dt>
            <dd>{format(grid.at(-1)?.reduce((a, b) => a + b, 0) ?? 0)}</dd>
          </div>
        </dl>
        <ToggleGroup
          aria-label={text("Activity view")}
          value={[sheetView]}
          onValueChange={(values) => {
            if (values[0]) {
              setSheetView(values[0]);
              setSheetHovered(null);
            }
          }}
        >
          <Toggle value="grid">{text("By hour")}</Toggle>
          <Toggle value="week">{text("By weekday")}</Toggle>
          <Toggle value="day">{text("Time of day")}</Toggle>
        </ToggleGroup>
        <div className="usage-readout" data-usage-readout role="status">
          <div>
            <span>{sheetHovered?.label ?? text("Hover over an hour to see its usage")}</span>
            <strong>
              {sheetHovered
                ? format(sheetHovered.value)
                : text("7-day total: {value}", {
                    value: format(grid.flat().reduce((a, b) => a + b, 0)),
                  })}
            </strong>
          </div>
        </div>
        <div className="usage-activity-view" onMouseLeave={() => setSheetHovered(null)}>
          <svg
            viewBox={`0 0 672 ${sheetView === "grid" ? days.length * 30 + 28 : 236}`}
            role="img"
            aria-label={text("Heatmap of hourly usage over the last 7 days")}
          >
            {sheetView === "grid" ? (
              <>
                {grid.map((row, r) => (
                  <g key={days[r]}>
                    <text x={0} y={r * 30 + 20}>
                      {weekdayLabel(r)}
                    </text>
                    {row.map((value, h) => (
                      <rect
                        key={HOURS[h]}
                        data-heat-cell
                        data-value={value}
                        x={40 + h * (632 / 24) + 1.5}
                        y={r * 30 + 4}
                        width={632 / 24 - 3}
                        height={24}
                        rx={5}
                        fill={
                          sheetLevel(value) === 0
                            ? "var(--muted)"
                            : accentTier(4 - Math.min(4, sheetLevel(value)))
                        }
                        stroke={
                          sheetHovered?.label === `${days[r]} ${String(h).padStart(2, "0")}:00`
                            ? "var(--foreground)"
                            : "none"
                        }
                        strokeWidth={1.5}
                        tabIndex={0}
                        role="img"
                        aria-label={`${days[r]} ${h}:00 · ${format(value)}`}
                        onMouseEnter={() =>
                          setSheetHovered({
                            label: `${days[r]} ${String(h).padStart(2, "0")}:00`,
                            value,
                          })
                        }
                        onFocus={() =>
                          setSheetHovered({
                            label: `${days[r]} ${String(h).padStart(2, "0")}:00`,
                            value,
                          })
                        }
                      />
                    ))}
                  </g>
                ))}
                {[0, 6, 12, 18].map((hour) => (
                  <text
                    key={hour}
                    x={40 + ((hour + 0.5) * 632) / 24}
                    y={days.length * 30 + 22}
                    textAnchor="middle"
                  >
                    {String(hour).padStart(2, "0")}:00
                  </text>
                ))}
              </>
            ) : (
              (() => {
                const rows = sheetView === "week" ? sheetWeekdays : sheetRhythm;
                const max = Math.max(1, ...rows.map((r) => r.value));
                const step = 632 / rows.length;
                return rows.map((row, i) => (
                  <g key={row.label} onMouseEnter={() => setSheetHovered(row)}>
                    <rect
                      data-activity-bar
                      x={40 + i * step + step * 0.15}
                      y={200 - (row.value / max) * 180}
                      width={step * 0.7}
                      height={(row.value / max) * 180}
                      rx={3}
                      fill={
                        row.value === max
                          ? "var(--primary)"
                          : "color-mix(in srgb,var(--foreground) 22%,var(--card))"
                      }
                    />
                    <rect
                      x={40 + i * step}
                      y={0}
                      width={step}
                      height={202}
                      fill="transparent"
                      tabIndex={0}
                      role="img"
                      aria-label={`${row.label} · ${format(row.value)}`}
                      onFocus={() => setSheetHovered(row)}
                    />
                    {sheetView === "week" || i % 6 === 0 ? (
                      <text x={40 + (i + 0.5) * step} y={224} textAnchor="middle">
                        {row.label}
                      </text>
                    ) : null}
                  </g>
                ));
              })()
            )}
          </svg>
        </div>
        <p className="usage-card-hint">
          {copy("Hours are grouped by local weekday and time. Hours with no usage show zero.")}
        </p>
      </UsageDetailsSheet>
    </>
  );
}

export interface V9PeriodOption {
  readonly days: number;
  readonly label: string;
  readonly title?: string;
}

interface V9CostDashboardProps {
  readonly merged: MergedUsage;
  readonly previous: MergedUsage | undefined;
  readonly selectedEnvironments: readonly EnvironmentUsageStatus[];
  readonly priorEnvironments: readonly EnvironmentUsageStatus[];
  readonly environmentIds: ReadonlySet<EnvironmentId>;
  readonly hiddenProviders: ReadonlySet<UsageProviderKind>;
  readonly rankedProviders: readonly UsageProviderKind[];
  readonly shownWindow: UsageSummaryInput;
  readonly periods: readonly string[];
  readonly hourly: boolean;
  readonly formatPeriod: (period: string) => string;
  readonly windowDays: number;
  readonly periodOptions: readonly V9PeriodOption[];
  readonly onSelectWindow: (days: number) => void;
  readonly chartStyle: "bar" | "area";
  readonly onChangeChartStyle: (style: "bar" | "area") => void;
  readonly selectedProvider: UsageProviderKind | null;
  readonly onSelectProvider: (provider: UsageProviderKind | null) => void;
  readonly selectedPeriod: string | null;
  readonly onSelectPeriod: (period: string | null) => void;
  readonly onSelectModel: (key: string) => void;
  readonly chatGptAction?: ReactNode;
  readonly loading?: boolean;
  readonly heatmapReferenceTime?: string;
}

/** V9 TAB 6: Dedicated Cost Page. */
export function V9CostDashboard({
  merged,
  previous,
  selectedEnvironments,
  priorEnvironments,
  environmentIds,
  hiddenProviders,
  rankedProviders,
  periods,
  hourly,
  formatPeriod,
  windowDays,
  periodOptions,
  onSelectWindow,
  chartStyle,
  onChangeChartStyle,
  selectedProvider,
  onSelectProvider,
  selectedPeriod,
  onSelectPeriod,
  onSelectModel,
  chatGptAction,
  loading = false,
  heatmapReferenceTime,
}: V9CostDashboardProps) {
  const text = useUiText();
  const areaGradId = useId();
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [insightOpen, setInsightOpen] = useState(true);
  const [rankTab, setRankTab] = useState<"model" | "project" | "hour">("model");
  const [rankExpanded, setRankExpanded] = useState(false);

  const scopedEnvs = scopeUsageEnvironments(
    selectedEnvironments,
    hiddenProviders,
    selectedProvider,
  );
  const providerScoped = selectedProvider === null ? merged : mergeUsageEnvironments(scopedEnvs);
  const detailEnvs = scopeEnvironmentsByPeriod(scopedEnvs, selectedPeriod, hourly);
  const detailUsage = selectedPeriod === null ? providerScoped : mergeUsageEnvironments(detailEnvs);

  const filteredPrevious =
    previous && selectedProvider !== null
      ? mergeUsageEnvironments(
          scopeUsageEnvironments(priorEnvironments, hiddenProviders, selectedProvider),
        )
      : previous;

  const byPeriod = new Map<string, { costUsd: number; totalTokens: number }>();
  if (hourly) {
    for (const entry of providerScoped.hourly) {
      const prev = byPeriod.get(entry.hourStart);
      byPeriod.set(entry.hourStart, {
        costUsd: (prev?.costUsd ?? 0) + entry.costUsd,
        totalTokens: (prev?.totalTokens ?? 0) + entry.totalTokens,
      });
    }
  } else {
    for (const entry of providerScoped.daily) {
      const prev = byPeriod.get(entry.day);
      byPeriod.set(entry.day, {
        costUsd: (prev?.costUsd ?? 0) + entry.costUsd,
        totalTokens: (prev?.totalTokens ?? 0) + entry.totalTokens,
      });
    }
  }
  const chartRows = periods.map((period) => ({
    period,
    label: hourly ? formatPeriod(period).replace(/:\d{2}$/, ":00") : formatPeriod(period),
    costUsd: byPeriod.get(period)?.costUsd ?? 0,
    totalTokens: byPeriod.get(period)?.totalTokens ?? 0,
  }));

  const L = 42;
  const R = 1024;
  const T = 12;
  const B = 158;
  const CW = R - L;
  const CH = B - T;
  const maxRaw = Math.max(...chartRows.map((row) => row.costUsd), 0);
  const maxV = (maxRaw > 0 ? maxRaw : 1) * 1.12;
  const slotW = CW / Math.max(1, chartRows.length);
  const bw = Math.min(26, slotW * 0.62);
  const labelEvery = hourly
    ? 3
    : chartRows.length <= 10
      ? 1
      : Math.max(1, Math.ceil(chartRows.length / 8));

  const areaPoints = chartRows.map(
    (row, i) => [L + (i + 0.5) * slotW, B - (row.costUsd / maxV) * CH] as const,
  );
  const areaLineD = areaPoints
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p[0].toFixed(2)} ${p[1].toFixed(2)}`)
    .join(" ");

  const hoveredRow = hoveredIndex === null ? undefined : chartRows[hoveredIndex];
  const readoutText = hoveredRow
    ? text("{period} · Est. {cost} · {tokens} tokens", {
        period: hoveredRow.label,
        cost: formatUsd(hoveredRow.costUsd),
        tokens: formatTokens(hoveredRow.totalTokens),
      })
    : hourly
      ? text("Hover chart for hourly details")
      : text("Hover chart for daily details");

  const periodRows = providerTotals(
    selectedPeriod === null
      ? merged
      : mergeUsageEnvironments(
          scopeEnvironmentsByPeriod(selectedEnvironments, selectedPeriod, hourly),
        ),
    rankedProviders,
    "cost",
  );
  const totalProviderCost = periodRows.reduce((sum, r) => sum + r.costUsd, 0) || 1;
  const providerSeriesMap = new Map(
    rankedProviders.map((provider) => [
      provider,
      providerTimeSeries(merged, periods, provider, hourly, "cost"),
    ]),
  );

  const savedUsd = detailUsage.costQuality.cacheSavingsUsd;
  const origUsd = detailUsage.costUsd + savedUsd;
  const saveRate = origUsd > 0 ? Math.max(0, Math.min(1, savedUsd / origUsd)) : 0;
  const saveDashOffset = (326.7 * (1 - saveRate)).toFixed(1);
  const cacheReadUsd = detailUsage.categoryCost.cacheRead;
  const freshInputUsd = detailUsage.categoryCost.input + detailUsage.categoryCost.cacheWrite;
  const outputUsd = detailUsage.categoryCost.output;
  const unsplitUsd = detailUsage.categoryCost.unsplit;

  const topModel = detailUsage.models[0];
  const prevCost = filteredPrevious?.costUsd;
  const deltaPct =
    prevCost !== undefined && prevCost > 0 && selectedPeriod === null
      ? ((detailUsage.costUsd - prevCost) / prevCost) * 100
      : null;
  const periodSpanText =
    windowDays === 1 ? copy("24 hours") : copy("{count} days", { count: windowDays });

  const scopePillText = `${selectedProvider === null ? copy("All providers") : usageSeriesLabel(selectedProvider)}${
    selectedPeriod !== null
      ? ` · ${hourly ? formatPeriod(selectedPeriod).replace(/:\d{2}$/, ":00") : formatPeriod(selectedPeriod)}`
      : ""
  }`;

  type CostRankRow = {
    readonly key: string;
    readonly provider?: UsageProviderKind;
    readonly name: string;
    readonly costUsd: number;
    readonly shownCost: string;
    readonly share: number | null;
    readonly onClick?: () => void;
  };
  const rankRows: readonly CostRankRow[] =
    rankTab === "model"
      ? detailUsage.models.map((model) => {
          const key = `${model.provider}:${model.model}`;
          const unknown = isModelCostUnknown(model);
          return {
            key,
            provider: model.provider,
            name: model.model,
            costUsd: model.costUsd,
            shownCost: unknown ? copy("Unpriced") : formatUsd(model.costUsd),
            share: modelShare(model, "cost"),
            onClick: () => onSelectModel(key),
          };
        })
      : rankTab === "project"
        ? detailUsage.projects
            .toSorted((a, b) => b.costUsd - a.costUsd)
            .map((project) => ({
              key: String(project.key),
              name:
                project.kind === "project"
                  ? project.title
                  : project.kind === "unlinked"
                    ? copy("Outside T3 conversations")
                    : copy("Not reported by this server."),
              costUsd: project.costUsd,
              shownCost: formatUsd(project.costUsd),
              share: detailUsage.costUsd > 0 ? project.costUsd / detailUsage.costUsd : 0,
            }))
        : [...chartRows]
            .toSorted((a, b) => b.costUsd - a.costUsd)
            .filter((row) => row.costUsd > 0)
            .slice(0, rankExpanded ? 24 : 5)
            .map((row) => ({
              key: row.period,
              name: hourly ? formatHourRangeLabel(row.label) : row.label,
              costUsd: row.costUsd,
              shownCost: formatUsd(row.costUsd),
              share: null,
              onClick: () => onSelectPeriod(selectedPeriod === row.period ? null : row.period),
            }));

  const rankSum = rankRows.reduce((sum, r) => sum + r.costUsd, 0) || 1;
  const visibleRankRows = rankTab === "hour" || rankExpanded ? rankRows : rankRows.slice(0, 6);

  return (
    <div data-ctv9-root data-v9-cost-page aria-busy={loading}>
      <div data-ctv9="toolbar">
        <div data-ctv9="toolbar-controls">
          <V9SegControl
            ariaLabel={text("Usage period")}
            value={String(windowDays)}
            options={periodOptions.map((opt) => ({
              value: String(opt.days),
              label: opt.label,
              ...(opt.title ? { title: opt.title } : {}),
            }))}
            onChange={(next) => onSelectWindow(Number(next))}
          />
          <V9SegControl
            ariaLabel={copy("Chart style")}
            value={chartStyle}
            options={[
              { value: "bar", label: copy("Bar chart") },
              { value: "area", label: copy("Area chart") },
            ]}
            onChange={onChangeChartStyle}
          />
        </div>
      </div>

      <section data-ctv9="hero-chart-card" data-usage-card>
        <div data-ctv9="hero-top-row">
          <div>
            <div data-ctv9="hero-kicker">
              <span>{text("Estimated total cost")}</span>
              <span data-ctv9="badge" data-tone="muted">
                {scopePillText}
              </span>
            </div>
            <div data-ctv9="hero-big-num" data-ctv9-num>
              <UsageCount value={detailUsage.costUsd} format={formatUsd} />
            </div>
            <div data-ctv9="hero-subline">
              <span data-ctv9="badge" data-tone="ok" data-ctv9-num>
                {text("Cache saved {amount}", { amount: formatUsdCompact(savedUsd) })}
              </span>
              <span>
                {deltaPct !== null
                  ? `${text("vs prior {period} {delta}", {
                      period: periodSpanText,
                      delta: `${deltaPct >= 0 ? "+" : "−"}${Math.abs(deltaPct).toFixed(1)}%`,
                    })} · `
                  : ""}
                {text("{count} active sessions", { count: formatCount(detailUsage.sessions) })}
                {" · "}
                {hourly
                  ? text("Click a bar or provider row to drill down")
                  : text("Click a day bar or provider row to drill down")}
              </span>
            </div>
          </div>
          <div data-ctv9="hero-readout-actions">
            <div data-ctv9="hero-readout-pill" data-ctv9-num data-usage-readout role="status">
              {readoutText}
            </div>
            {selectedProvider !== null || selectedPeriod !== null ? (
              <button
                type="button"
                data-ctv9="chip-btn"
                onClick={() => {
                  onSelectProvider(null);
                  onSelectPeriod(null);
                }}
              >
                {text("Reset filters")}
              </button>
            ) : null}
          </div>
        </div>

        <svg
          data-ctv9="hero-chart-svg"
          viewBox="0 0 1040 184"
          role="img"
          aria-label={copy("Cost trend. Hover for period details.")}
          onMouseLeave={() => setHoveredIndex(null)}
        >
          {[0, 1, 2, 3].map((i) => {
            const y = B - (i / 3) * CH;
            const v = (i / 3) * maxV;
            return (
              <g key={i}>
                <line x1={L} y1={y} x2={R} y2={y} stroke="var(--hair)" />
                <text
                  x={L - 8}
                  y={y + 3.5}
                  textAnchor="end"
                  fontSize="10.5"
                  fill="var(--fg-3)"
                  data-ctv9-num
                >
                  {formatAxisUsd(v, maxV)}
                </text>
              </g>
            );
          })}

          {chartStyle === "bar" ? (
            <g data-v9-cost-bars>
              {chartRows.map((row, i) => {
                const cx = L + (i + 0.5) * slotW;
                const bh = row.costUsd > 0 ? Math.max(3, (row.costUsd / maxV) * CH) : 0;
                const sel = selectedPeriod === row.period;
                const op = selectedPeriod !== null && !sel ? 0.32 : 1;
                const showTick = i % labelEvery === 0 || sel;
                return (
                  <g
                    key={row.period}
                    data-ctv9="chart-col-g"
                    data-period={row.period}
                    opacity={op}
                    onMouseEnter={() => setHoveredIndex(i)}
                    onClick={() => onSelectPeriod(sel ? null : row.period)}
                  >
                    <rect x={L + i * slotW} y={T} width={slotW} height={CH} fill="transparent" />
                    {bh > 0 ? (
                      <rect
                        x={cx - bw / 2}
                        y={B - bh}
                        width={bw}
                        height={bh}
                        rx={5}
                        fill="var(--ac)"
                      />
                    ) : null}
                    {showTick ? (
                      <text
                        x={cx}
                        y={B + 18}
                        textAnchor="middle"
                        fontSize="10.5"
                        fill={sel ? "var(--fg)" : "var(--fg-3)"}
                        fontWeight={sel ? 700 : 400}
                        data-ctv9-num
                      >
                        {row.label}
                      </text>
                    ) : null}
                  </g>
                );
              })}
            </g>
          ) : (
            <g data-v9-cost-area>
              <defs>
                <linearGradient id={areaGradId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--ac)" stopOpacity={0.26} />
                  <stop offset="100%" stopColor="var(--ac)" stopOpacity={0.01} />
                </linearGradient>
              </defs>
              {areaPoints.length >= 2 ? (
                <>
                  <path
                    d={`${areaLineD} L ${areaPoints.at(-1)![0].toFixed(2)} ${B} L ${areaPoints[0]![0].toFixed(2)} ${B} Z`}
                    fill={`url(#${areaGradId})`}
                  />
                  <path
                    d={areaLineD}
                    fill="none"
                    stroke="var(--ac)"
                    strokeWidth={2.2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </>
              ) : null}
              {areaPoints.map((pt, i) => {
                const row = chartRows[i]!;
                const sel = selectedPeriod === row.period;
                const showTick = i % labelEvery === 0 || sel;
                return (
                  <g
                    key={row.period}
                    data-ctv9="chart-col-g"
                    data-period={row.period}
                    onMouseEnter={() => setHoveredIndex(i)}
                    onClick={() => onSelectPeriod(sel ? null : row.period)}
                  >
                    <circle cx={pt[0]} cy={pt[1]} r={sel ? 5 : 2.8} fill="var(--ac)" />
                    <rect
                      x={pt[0] - slotW / 2}
                      y={T}
                      width={slotW}
                      height={CH}
                      fill="transparent"
                    />
                    {showTick ? (
                      <text
                        x={pt[0]}
                        y={B + 18}
                        textAnchor="middle"
                        fontSize="10.5"
                        fill={sel ? "var(--fg)" : "var(--fg-3)"}
                        fontWeight={sel ? 700 : 400}
                        data-ctv9-num
                      >
                        {row.label}
                      </text>
                    ) : null}
                  </g>
                );
              })}
            </g>
          )}
        </svg>
      </section>

      <div data-ctv9="two-col-eq">
        <section data-ctv9="card" data-layout="col-between" data-usage-card>
          <div>
            <div data-ctv9="card-title">
              <span>{text("Cost by provider")}</span>
              <span data-ctv9="card-sub">{text("Select a row to filter")}</span>
              {chatGptAction ? (
                <>
                  <span data-ctv9="spacer" />
                  {chatGptAction}
                </>
              ) : null}
            </div>
            {periodRows.length > 0 ? (
              <div data-ctv9="comp-ribbon">
                {periodRows.map((row) => {
                  const pct = (row.costUsd / totalProviderCost) * 100;
                  const col = v9ProviderColor(row.provider);
                  const sel = selectedProvider === row.provider;
                  const dim = selectedProvider !== null && !sel;
                  return (
                    <button
                      key={row.provider}
                      type="button"
                      data-ctv9="comp-seg"
                      data-dim={dim ? "true" : undefined}
                      style={{ width: `${Math.max(1.5, pct).toFixed(1)}%`, background: col }}
                      aria-label={`${usageSeriesLabel(row.provider)} ${pct.toFixed(1)}%`}
                      onClick={() => onSelectProvider(sel ? null : row.provider)}
                    />
                  );
                })}
              </div>
            ) : null}
            <div data-ctv9="prov-list">
              {periodRows.map((row) => {
                const pct = (row.costUsd / totalProviderCost) * 100;
                const col = v9ProviderColor(row.provider);
                const sel = selectedProvider === row.provider;
                const dim = selectedProvider !== null && !sel;
                const series = providerSeriesMap.get(row.provider) ?? [];
                return (
                  <button
                    key={row.provider}
                    type="button"
                    data-ctv9="prov-row"
                    data-sel={sel ? "true" : undefined}
                    data-dim={dim ? "true" : undefined}
                    aria-pressed={sel}
                    onClick={() => onSelectProvider(sel ? null : row.provider)}
                  >
                    <V9BrandLogo provider={row.provider} />
                    <div>
                      <div data-ctv9="prov-name">{usageSeriesLabel(row.provider)}</div>
                      <div data-ctv9="prov-meta">
                        {copy("{count} conversations · {share}", {
                          count: formatCount(row.sessions),
                          share: `${pct.toFixed(1)}%`,
                        })}
                      </div>
                      <div data-ctv9="prov-bar-bg">
                        <div
                          data-ctv9="prov-bar-fill"
                          style={{ width: `${Math.min(100, pct).toFixed(1)}%`, background: col }}
                        />
                      </div>
                    </div>
                    <div>
                      <V9ProviderSparkline values={series} color={col} />
                    </div>
                    <div data-ctv9="prov-right">
                      <div data-ctv9="prov-right-main" data-ctv9-num>
                        {formatUsd(row.costUsd)}
                      </div>
                      <div data-ctv9="prov-right-sub" data-ctv9-num>
                        {formatTokens(row.totalTokens)}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        <section data-ctv9="card" data-layout="col-between" data-usage-card>
          <div>
            <div data-ctv9="card-title">
              <span>{text("Cache savings & cost breakdown")}</span>
              <span data-ctv9="spacer" />
              <span data-ctv9="badge" data-tone="ok" data-ctv9-num>
                {text("Saved {percent}", { percent: `${(saveRate * 100).toFixed(1)}%` })}
              </span>
            </div>
            <div data-ctv9="cost-savings-grid">
              <svg width={132} height={132} viewBox="0 0 132 132" aria-hidden>
                <circle cx={66} cy={66} r={52} fill="none" stroke="var(--r0)" strokeWidth={11} />
                <circle
                  data-ctv9="cost-save-arc"
                  cx={66}
                  cy={66}
                  r={52}
                  fill="none"
                  stroke="var(--ok)"
                  strokeWidth={11}
                  strokeLinecap="round"
                  strokeDasharray={326.7}
                  strokeDashoffset={saveDashOffset}
                  transform="rotate(-90 66 66)"
                />
                <text
                  x={66}
                  y={62}
                  textAnchor="middle"
                  fontSize="18"
                  fontWeight={750}
                  fill="var(--fg)"
                  data-ctv9-num
                >
                  {formatUsdCompact(savedUsd)}
                </text>
                <text x={66} y={79} textAnchor="middle" fontSize="10.5" fill="var(--fg-2)">
                  {text("Saved by cache")}
                </text>
              </svg>
              <div data-ctv9="cost-split-list">
                <div data-ctv9="cost-split-row">
                  <span data-ctv9="cost-split-label">{text("Cache read spend")}</span>
                  <b data-ctv9-num>{formatUsd(cacheReadUsd)}</b>
                </div>
                <div data-ctv9="cost-split-row">
                  <span data-ctv9="cost-split-label">{text("Fresh input spend")}</span>
                  <b data-ctv9-num>{formatUsd(freshInputUsd)}</b>
                </div>
                <div data-ctv9="cost-split-row">
                  <span data-ctv9="cost-split-label">{text("Model output spend")}</span>
                  <b data-ctv9-num>{formatUsd(outputUsd)}</b>
                </div>
                {unsplitUsd >= 0.005 ? (
                  <div data-ctv9="cost-split-row">
                    <span data-ctv9="cost-split-label">{copy("Unsplit cost")}</span>
                    <b data-ctv9-num>{formatUsd(unsplitUsd)}</b>
                  </div>
                ) : null}
                <div data-ctv9="cost-split-divider" />
                <div data-ctv9="cost-split-orig">
                  <span>{text("Estimated uncached total")}</span>
                  <span data-ctv9="cost-split-strike" data-ctv9-num>
                    {formatUsd(origUsd)}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div data-ctv9="beui-insight" data-open={insightOpen ? "true" : undefined}>
            <button
              type="button"
              data-ctv9="beui-insight-head"
              aria-expanded={insightOpen}
              onClick={() => setInsightOpen((open) => !open)}
            >
              <span data-ctv9="beui-insight-title">
                <span data-ctv9="beui-insight-dot" aria-hidden />
                <span>{text("Cost routing insight")}</span>
              </span>
              <span data-ctv9="beui-insight-toggle">
                {insightOpen ? copy("Collapse recommendation") : copy("Expand")}
              </span>
            </button>
            <div data-ctv9="beui-insight-body">
              <div data-ctv9="beui-insight-inner">
                {topModel
                  ? text(
                      "Long-context caching lowered effective spend by {percent} (saved {savings}). Highest cost share is {model} ({share}); routing routine lookup tasks to a lighter model can reduce spend further.",
                      {
                        percent: `${(saveRate * 100).toFixed(1)}%`,
                        savings: formatUsdCompact(savedUsd),
                        model: topModel.model,
                        share: formatPercent(topModel.costShare),
                      },
                    )
                  : copy(
                      "Cache reduced estimated spend by {percent} (saved {savings} vs uncached input).",
                      {
                        percent: formatPercent(saveRate),
                        savings: formatUsd(savedUsd),
                      },
                    )}
              </div>
            </div>
          </div>
        </section>
      </div>

      <div data-ctv9="two-col-eq">
        <V9ActivityHeatmapCard
          environmentIds={environmentIds}
          hiddenProviders={hiddenProviders}
          metric="cost"
          selectedProvider={selectedProvider}
          {...(heatmapReferenceTime !== undefined ? { referenceTime: heatmapReferenceTime } : {})}
        />

        <section data-ctv9="card" data-usage-card>
          <div data-ctv9="card-title">
            <span>{text("Cost breakdown ranking")}</span>
            <span data-ctv9="spacer" />
            <V9SegControl
              ariaLabel={copy("Usage breakdown")}
              value={rankTab}
              options={[
                { value: "model", label: copy("By model") },
                { value: "project", label: copy("By project.") },
                { value: "hour", label: hourly ? text("Peak hours") : text("Peak days") },
              ]}
              onChange={(next) => {
                setRankTab(next);
                setRankExpanded(false);
              }}
            />
          </div>
          <table data-ctv9="rank-table">
            <thead>
              <tr>
                <th data-col="rank">#</th>
                <th>{text("Name")}</th>
                <th data-align="right">{copy("Cost")}</th>
                <th data-align="right" data-col="share">
                  {copy("Share")}
                </th>
              </tr>
            </thead>
            <tbody>
              {visibleRankRows.length === 0 ? (
                <tr>
                  <td colSpan={4} data-ctv9="rank-empty">
                    {copy("No usage in this period")}
                  </td>
                </tr>
              ) : (
                visibleRankRows.map((row, idx) => {
                  const pct = row.share !== null ? row.share * 100 : (row.costUsd / rankSum) * 100;
                  return (
                    <tr
                      key={row.key}
                      data-static={row.onClick ? undefined : "true"}
                      tabIndex={row.onClick ? 0 : undefined}
                      onClick={row.onClick}
                      onKeyDown={(event) => {
                        if (row.onClick && (event.key === "Enter" || event.key === " ")) {
                          event.preventDefault();
                          row.onClick();
                        }
                      }}
                    >
                      <td data-ctv9="rank-idx" data-ctv9-num>
                        {String(idx + 1).padStart(2, "0")}
                      </td>
                      <td>
                        <span data-ctv9="rank-name-cell">
                          {row.provider ? <V9BrandLogo provider={row.provider} /> : null}
                          <b>{row.name}</b>
                        </span>
                      </td>
                      <td data-align="right" data-ctv9-num>
                        <b>{row.shownCost}</b>
                      </td>
                      <td data-align="right" data-ctv9-num>{`${pct.toFixed(1)}%`}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
          {rankTab !== "hour" && rankRows.length > 6 ? (
            <button
              type="button"
              data-ctv9="rank-more-btn"
              aria-expanded={rankExpanded}
              onClick={() => setRankExpanded((prev) => !prev)}
            >
              {rankExpanded
                ? copy("Collapse recommendation")
                : copy("Show all · {count} more", { count: rankRows.length - 6 })}
            </button>
          ) : null}
        </section>
      </div>
    </div>
  );
}

interface V9TokensDashboardProps {
  readonly merged: MergedUsage;
  readonly selectedEnvironments: readonly EnvironmentUsageStatus[];
  readonly environmentIds: ReadonlySet<EnvironmentId>;
  readonly hiddenProviders: ReadonlySet<UsageProviderKind>;
  readonly rankedProviders: readonly UsageProviderKind[];
  readonly periods: readonly string[];
  readonly periodTotals: readonly MergedUsage[];
  readonly hourly: boolean;
  readonly formatPeriod: (period: string) => string;
  readonly windowDays: number;
  readonly periodOptions: readonly V9PeriodOption[];
  readonly onSelectWindow: (days: number) => void;
  readonly selectedProvider: UsageProviderKind | null;
  readonly onSelectProvider: (provider: UsageProviderKind | null) => void;
  readonly selectedPeriod: string | null;
  readonly onSelectPeriod: (period: string | null) => void;
  readonly onSelectModel: (key: string) => void;
  readonly loading?: boolean;
  readonly heatmapReferenceTime?: string;
}

function summarizeThroughputRate(
  rows: readonly { readonly outputTokens: number; readonly modelMs: number }[],
): number | null {
  let outputTokens = 0;
  let modelMs = 0;
  for (const row of rows) {
    outputTokens += row.outputTokens;
    modelMs += row.modelMs;
  }
  return computeTokensPerSecond(outputTokens, modelMs);
}

/** V9 TAB 7: Dedicated Tokens Page. */
export function V9TokensDashboard({
  merged,
  selectedEnvironments,
  environmentIds,
  hiddenProviders,
  rankedProviders,
  periods,
  periodTotals,
  hourly,
  formatPeriod,
  windowDays,
  periodOptions,
  onSelectWindow,
  selectedProvider,
  onSelectProvider,
  selectedPeriod,
  onSelectPeriod,
  onSelectModel,
  loading = false,
  heatmapReferenceTime,
}: V9TokensDashboardProps) {
  const text = useUiText();
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [rankExpanded, setRankExpanded] = useState(false);

  const scopedEnvs = scopeUsageEnvironments(
    selectedEnvironments,
    hiddenProviders,
    selectedProvider,
  );
  const providerScoped = selectedProvider === null ? merged : mergeUsageEnvironments(scopedEnvs);
  const detailEnvs = scopeEnvironmentsByPeriod(scopedEnvs, selectedPeriod, hourly);
  const detailUsage = selectedPeriod === null ? providerScoped : mergeUsageEnvironments(detailEnvs);

  const cacheTok = detailUsage.cachedInputTokens;
  const freshTok = detailUsage.uncachedInputTokens + detailUsage.cacheCreationTokens;
  const outTok = detailUsage.outputTokens;
  const totalTok = detailUsage.totalTokens;
  const hitRate = cacheTok + freshTok > 0 ? cacheTok / (cacheTok + freshTok) : 0;
  const hitDashOffset = (207.3 * (1 - hitRate)).toFixed(1);

  const L = 44;
  const R = 1024;
  const T = 12;
  const B = 158;
  const CW = R - L;
  const CH = B - T;
  const chartRows = periods.map((period, idx) => {
    const row = periodTotals[idx];
    const cache = row?.cachedInputTokens ?? 0;
    const fresh = (row?.uncachedInputTokens ?? 0) + (row?.cacheCreationTokens ?? 0);
    const out = row?.outputTokens ?? 0;
    const total = row?.totalTokens ?? cache + fresh + out;
    return {
      period,
      label: hourly ? formatPeriod(period).replace(/:\d{2}$/, ":00") : formatPeriod(period),
      cache,
      fresh,
      out,
      total,
    };
  });

  const maxRaw = Math.max(...chartRows.map((row) => row.total), 0);
  const maxV = (maxRaw > 0 ? maxRaw : 1) * 1.12;
  const slotW = CW / Math.max(1, chartRows.length);
  const bw = Math.min(26, slotW * 0.62);
  const labelEvery = hourly
    ? 3
    : chartRows.length <= 10
      ? 1
      : Math.max(1, Math.ceil(chartRows.length / 8));

  const hoveredRow = hoveredIndex === null ? undefined : chartRows[hoveredIndex];
  const readoutText = hoveredRow
    ? text("{period} · Total {total} (Cache {cache} / Fresh {fresh} / Out {output})", {
        period: hoveredRow.label,
        total: formatTokens(hoveredRow.total),
        cache: formatTokens(hoveredRow.cache),
        fresh: formatTokens(hoveredRow.fresh),
        output: formatTokens(hoveredRow.out),
      })
    : hourly
      ? text("Hover stacked bars for hourly token breakdown")
      : text("Hover stacked bars for daily token breakdown");

  const scopePillText = `${selectedProvider === null ? copy("All providers") : usageSeriesLabel(selectedProvider)}${
    selectedPeriod !== null
      ? ` · ${hourly ? formatPeriod(selectedPeriod).replace(/:\d{2}$/, ":00") : formatPeriod(selectedPeriod)}`
      : ""
  }`;

  const ribbonTotal = Math.max(1, cacheTok + freshTok + outTok);
  const pC = (cacheTok / ribbonTotal) * 100;
  const pI = (freshTok / ribbonTotal) * 100;
  const pO = Math.max(0, 100 - pC - pI);

  const provUsage =
    selectedPeriod === null
      ? merged
      : mergeUsageEnvironments(
          scopeEnvironmentsByPeriod(selectedEnvironments, selectedPeriod, hourly),
        );
  const provRows = providerTotals(provUsage, rankedProviders, "tokens");
  const fullProvTokens = provRows.reduce((sum, row) => sum + row.totalTokens, 0) || 1;

  const visibleThroughput = merged.throughput.byProvider.filter(
    (entry) => !hiddenProviders.has(entry.provider),
  );
  const overallThroughputRate = summarizeThroughputRate(
    selectedProvider === null
      ? visibleThroughput
      : visibleThroughput.filter((entry) => usageSeries(entry.provider) === selectedProvider),
  );
  const noThroughputHint = text("Only counts conversations run in T3");

  const sortedModels = sortModelsByTokens(detailUsage.models);
  const modelTokenSum = sortedModels.reduce((sum, m) => sum + m.totalTokens, 0) || 1;
  const visibleModels = rankExpanded ? sortedModels : sortedModels.slice(0, 6);

  return (
    <div data-ctv9-root data-v9-tokens-page aria-busy={loading}>
      <div data-ctv9="toolbar">
        <div data-ctv9="toolbar-controls">
          <V9SegControl
            ariaLabel={text("Usage period")}
            value={String(windowDays)}
            options={periodOptions.map((opt) => ({
              value: String(opt.days),
              label: opt.label,
              ...(opt.title ? { title: opt.title } : {}),
            }))}
            onChange={(next) => onSelectWindow(Number(next))}
          />
        </div>
      </div>

      <section data-ctv9="hero-chart-card" data-usage-card>
        <div data-ctv9="hero-top-row">
          <div>
            <div data-ctv9="hero-kicker">
              <span>{text("Total tokens processed")}</span>
              <span data-ctv9="badge" data-tone="muted">
                {scopePillText}
              </span>
            </div>
            <div data-ctv9="hero-big-num" data-ctv9-num>
              <UsageCount value={totalTok} format={formatTokens} />
            </div>
            <div data-ctv9="hero-subline">
              <span data-ctv9="badge" data-tone="ok" data-ctv9-num>
                {text("Input cache hit {percent}", { percent: `${(hitRate * 100).toFixed(1)}%` })}
              </span>
              <span data-ctv9-num data-v9-tokens-subline>
                {overallThroughputRate !== null ? (
                  <>
                    {text("Average throughput {rate} tok/s", {
                      rate: Math.round(overallThroughputRate),
                    })}
                    {" · "}
                  </>
                ) : null}
                {text("Stacked: cache read / fresh input / output")}
              </span>
            </div>
          </div>
          <div data-ctv9="hero-readout-actions">
            <div data-ctv9="hero-readout-pill" data-ctv9-num data-usage-readout role="status">
              {readoutText}
            </div>
            {selectedProvider !== null || selectedPeriod !== null ? (
              <button
                type="button"
                data-ctv9="chip-btn"
                onClick={() => {
                  onSelectProvider(null);
                  onSelectPeriod(null);
                }}
              >
                {text("Reset filters")}
              </button>
            ) : null}
          </div>
        </div>

        <svg
          data-ctv9="hero-chart-svg"
          viewBox="0 0 1040 184"
          role="img"
          aria-label={hourly ? copy("Hourly tokens") : copy("Daily tokens.")}
          onMouseLeave={() => setHoveredIndex(null)}
        >
          {[0, 1, 2, 3].map((i) => {
            const y = B - (i / 3) * CH;
            const v = (i / 3) * maxV;
            return (
              <g key={i}>
                <line x1={L} y1={y} x2={R} y2={y} stroke="var(--hair)" />
                <text
                  x={L - 8}
                  y={y + 3.5}
                  textAnchor="end"
                  fontSize="10.5"
                  fill="var(--fg-3)"
                  data-ctv9-num
                >
                  {v <= 0 ? "0" : formatTokens(v)}
                </text>
              </g>
            );
          })}

          <g data-v9-token-bars>
            {chartRows.map((row, i) => {
              const cx = L + (i + 0.5) * slotW;
              const x = cx - bw / 2;
              const sel = selectedPeriod === row.period;
              const op = selectedPeriod !== null && !sel ? 0.32 : 1;
              const showTick = i % labelEvery === 0 || sel;
              const hC = row.cache > 0 ? Math.max(2, (row.cache / maxV) * CH) : 0;
              const hI = row.fresh > 0 ? Math.max(1.5, (row.fresh / maxV) * CH) : 0;
              const hO = row.out > 0 ? Math.max(1.5, (row.out / maxV) * CH) : 0;
              const gap1 = hC > 0 && hI > 0 ? 1.5 : 0;
              const gap2 = (hC > 0 || hI > 0) && hO > 0 ? 1.5 : 0;
              const yC = B - hC;
              const yI = yC - gap1 - hI;
              const yO = yI - gap2 - hO;
              return (
                <g
                  key={row.period}
                  data-ctv9="chart-col-g"
                  data-period={row.period}
                  opacity={op}
                  onMouseEnter={() => setHoveredIndex(i)}
                  onClick={() => onSelectPeriod(sel ? null : row.period)}
                >
                  <rect x={L + i * slotW} y={T} width={slotW} height={CH} fill="transparent" />
                  {hC > 0 ? (
                    <rect x={x} y={yC} width={bw} height={hC} rx={4} fill="var(--ac)" />
                  ) : null}
                  {hI > 0 ? (
                    <rect x={x} y={yI} width={bw} height={hI} rx={3} fill="var(--ac-2)" />
                  ) : null}
                  {hO > 0 ? (
                    <rect x={x} y={yO} width={bw} height={hO} rx={3} fill="var(--ac-3)" />
                  ) : null}
                  {showTick ? (
                    <text
                      x={cx}
                      y={B + 18}
                      textAnchor="middle"
                      fontSize="10.5"
                      fill={sel ? "var(--fg)" : "var(--fg-3)"}
                      fontWeight={sel ? 700 : 400}
                      data-ctv9-num
                    >
                      {row.label}
                    </text>
                  ) : null}
                </g>
              );
            })}
          </g>
        </svg>

        <div data-ctv9="tok-legend">
          <span data-ctv9="tok-legend-item">
            <i data-ctv9="tok-legend-swatch" data-layer="cache" />
            {copy("Cache read")}
          </span>
          <span data-ctv9="tok-legend-item">
            <i data-ctv9="tok-legend-swatch" data-layer="fresh" />
            {text("Fresh input")}
          </span>
          <span data-ctv9="tok-legend-item">
            <i data-ctv9="tok-legend-swatch" data-layer="output" />
            {text("Model output")}
          </span>
        </div>
      </section>

      <div data-ctv9="two-col-eq">
        <section data-ctv9="card" data-layout="col-between" data-usage-card>
          <div>
            <div data-ctv9="card-title">
              <span>{text("Input cache hit gauge & mix")}</span>
              <span data-ctv9="spacer" />
              <span data-ctv9="badge" data-tone="muted">
                {text("Normalized input")}
              </span>
            </div>
            <div data-ctv9="tok-gauge-row">
              <svg width={164} height={96} viewBox="0 0 164 96" aria-hidden>
                <path
                  d="M 16 82 A 66 66 0 0 1 148 82"
                  fill="none"
                  stroke="var(--r0)"
                  strokeWidth={12}
                  strokeLinecap="round"
                />
                <path
                  data-ctv9="tok-cache-arc"
                  d="M 16 82 A 66 66 0 0 1 148 82"
                  fill="none"
                  stroke="var(--ac)"
                  strokeWidth={12}
                  strokeLinecap="round"
                  strokeDasharray={207.3}
                  strokeDashoffset={hitDashOffset}
                />
                <text
                  x={82}
                  y={65}
                  textAnchor="middle"
                  fontSize="23"
                  fontWeight={750}
                  fill="var(--fg)"
                  data-ctv9-num
                >
                  {`${(hitRate * 100).toFixed(1)}%`}
                </text>
                <text x={82} y={82} textAnchor="middle" fontSize="10.5" fill="var(--fg-2)">
                  {text("Input cache hit rate")}
                </text>
              </svg>
              <div data-ctv9="tok-split-list">
                <div data-ctv9="cost-split-row">
                  <span data-ctv9="cost-split-label">{copy("Cache read")}</span>
                  <b data-ctv9-num>{formatTokens(cacheTok)}</b>
                </div>
                <div data-ctv9="cost-split-row">
                  <span data-ctv9="cost-split-label">{text("Fresh input")}</span>
                  <b data-ctv9-num>{formatTokens(freshTok)}</b>
                </div>
                <div data-ctv9="cost-split-row">
                  <span data-ctv9="cost-split-label">{text("Model output")}</span>
                  <b data-ctv9-num>{formatTokens(outTok)}</b>
                </div>
              </div>
            </div>
            <div data-ctv9="comp-ribbon" aria-hidden>
              {pC > 0 ? (
                <div
                  data-ctv9="comp-seg"
                  data-static="true"
                  style={{ width: `${pC.toFixed(1)}%`, background: "var(--ac)" }}
                />
              ) : null}
              {pI > 0 ? (
                <div
                  data-ctv9="comp-seg"
                  data-static="true"
                  style={{ width: `${pI.toFixed(1)}%`, background: "var(--ac-2)" }}
                />
              ) : null}
              {pO > 0 ? (
                <div
                  data-ctv9="comp-seg"
                  data-static="true"
                  style={{ width: `${pO.toFixed(1)}%`, background: "var(--ac-3)" }}
                />
              ) : null}
            </div>
            <div data-ctv9="tok-formula">
              {text("Input cache hit rate = ")}
              <code>{text("cache read ÷ (cache read + fresh input)")}</code>
              {text(", excluding output tokens to reflect context reuse.")}
            </div>
          </div>
        </section>

        <section data-ctv9="card" data-usage-card>
          <div data-ctv9="card-title">
            <span>{text("Provider throughput & I/O ratio")}</span>
            <span data-ctv9="card-sub">{text("Select a row to filter stacked chart")}</span>
          </div>
          <TooltipProvider delay={0}>
            <div data-ctv9="prov-list">
              {provRows.map((row) => {
                const sh = (row.totalTokens / fullProvTokens) * 100;
                const col = v9ProviderColor(row.provider);
                const sel = selectedProvider === row.provider;
                const dim = selectedProvider !== null && !sel;
                const freshProvTok = row.inputTokens + row.cacheCreationTokens;
                const ioSum = Math.max(1, row.cachedInputTokens + freshProvTok + row.outputTokens);
                const cP = (row.cachedInputTokens / ioSum) * 100;
                const oP = (row.outputTokens / ioSum) * 100;
                const iP = Math.max(0, 100 - cP - oP);
                const provRate = summarizeThroughputRate(
                  visibleThroughput.filter((entry) => usageSeries(entry.provider) === row.provider),
                );
                return (
                  <button
                    key={row.provider}
                    type="button"
                    data-ctv9="prov-row"
                    data-sel={sel ? "true" : undefined}
                    data-dim={dim ? "true" : undefined}
                    aria-pressed={sel}
                    onClick={() => onSelectProvider(sel ? null : row.provider)}
                  >
                    <V9BrandLogo provider={row.provider} />
                    <div>
                      <div data-ctv9="prov-name">{usageSeriesLabel(row.provider)}</div>
                      <div data-ctv9="prov-meta" data-ctv9-num>
                        {text("{share} of total · Output {outputShare}", {
                          share: `${sh.toFixed(1)}%`,
                          outputShare: `${oP.toFixed(1)}%`,
                        })}
                        {" · "}
                        {provRate !== null ? (
                          <span data-v9-prov-throughput>
                            {text("{rate} tok/s", { rate: Math.round(provRate) })}
                          </span>
                        ) : (
                          <Tooltip>
                            <TooltipTrigger
                              render={
                                <span
                                  data-v9-prov-throughput="empty"
                                  aria-label={noThroughputHint}
                                />
                              }
                            >
                              {/* oxlint-disable-next-line t3code/no-em-dash-copy -- V9 empty-state placeholder for providers without T3 throughput data */}
                              {"\u2014"}
                            </TooltipTrigger>
                            <TooltipPopup data-usage-portal side="top">
                              {noThroughputHint}
                            </TooltipPopup>
                          </Tooltip>
                        )}
                      </div>
                      <div data-ctv9="prov-bar-bg">
                        <div
                          data-ctv9="prov-bar-fill"
                          style={{ width: `${Math.min(100, sh).toFixed(1)}%`, background: col }}
                        />
                      </div>
                    </div>
                    <div>
                      <div data-ctv9="prov-io-label">{text("Cache / In / Out")}</div>
                      <div data-ctv9="io-ratio-bar" aria-hidden>
                        {cP > 0 ? (
                          <span style={{ width: `${cP.toFixed(0)}%`, background: col }} />
                        ) : null}
                        {iP > 0 ? (
                          <span
                            style={{
                              width: `${Math.max(4, iP).toFixed(0)}%`,
                              background: "var(--ac-2)",
                            }}
                          />
                        ) : null}
                        {oP > 0 ? (
                          <span
                            style={{
                              width: `${Math.max(4, oP).toFixed(0)}%`,
                              background: "var(--fg-2)",
                            }}
                          />
                        ) : null}
                      </div>
                    </div>
                    <div data-ctv9="prov-right">
                      <div data-ctv9="prov-right-main" data-ctv9-num>
                        {formatTokens(row.totalTokens)}
                      </div>
                      <div data-ctv9="prov-right-sub" data-ctv9-num>
                        {formatUsdCompact(row.costUsd)}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </TooltipProvider>
        </section>
      </div>

      <div data-ctv9="two-col-eq">
        <V9ActivityHeatmapCard
          environmentIds={environmentIds}
          hiddenProviders={hiddenProviders}
          metric="tokens"
          selectedProvider={selectedProvider}
          {...(heatmapReferenceTime !== undefined ? { referenceTime: heatmapReferenceTime } : {})}
        />

        <section data-ctv9="card" data-usage-card>
          <div data-ctv9="card-title">
            <span>{text("Token details by model")}</span>
            <span data-ctv9="card-sub">
              {hourly
                ? text("24 hours · Exact same-source aggregation")
                : text("{count} days · Exact same-source aggregation", { count: windowDays })}
            </span>
          </div>
          <table data-ctv9="rank-table">
            <thead>
              <tr>
                <th data-col="rank">#</th>
                <th>{copy("Model")}</th>
                <th data-align="right">{text("Total tokens")}</th>
                <th data-align="right">{text("Hit rate")}</th>
                <th data-align="right" data-col="share-tok">
                  {copy("Share")}
                </th>
              </tr>
            </thead>
            <tbody>
              {visibleModels.length === 0 ? (
                <tr>
                  <td colSpan={5} data-ctv9="rank-empty">
                    {copy("No usage in this period")}
                  </td>
                </tr>
              ) : (
                visibleModels.map((model, idx) => {
                  const key = `${model.provider}:${model.model}`;
                  const hit = cacheHitRate(model);
                  const pct = (model.totalTokens / modelTokenSum) * 100;
                  return (
                    <tr
                      key={key}
                      tabIndex={0}
                      aria-label={copy("View details for {model}", { model: model.model })}
                      onClick={() => onSelectModel(key)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          onSelectModel(key);
                        }
                      }}
                    >
                      <td data-ctv9="rank-idx" data-ctv9-num>
                        {String(idx + 1).padStart(2, "0")}
                      </td>
                      <td>
                        <span data-ctv9="rank-name-cell">
                          <V9BrandLogo provider={model.provider} />
                          <b>{model.model}</b>
                        </span>
                      </td>
                      <td data-align="right" data-ctv9-num>
                        <b>{formatTokens(model.totalTokens)}</b>
                      </td>
                      <td data-align="right" data-ctv9-num>
                        {hit === null ? (
                          <span data-ctv9="badge" data-tone="muted">
                            -
                          </span>
                        ) : (
                          <span
                            data-ctv9="badge"
                            data-tone="ok"
                          >{`${(hit * 100).toFixed(1)}%`}</span>
                        )}
                      </td>
                      <td data-align="right" data-ctv9-num>{`${pct.toFixed(1)}%`}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
          {sortedModels.length > 6 ? (
            <button
              type="button"
              data-ctv9="rank-more-btn"
              aria-expanded={rankExpanded}
              onClick={() => setRankExpanded((prev) => !prev)}
            >
              {rankExpanded
                ? copy("Collapse recommendation")
                : copy("Show all · {count} more", { count: sortedModels.length - 6 })}
            </button>
          ) : null}
        </section>
      </div>
    </div>
  );
}
