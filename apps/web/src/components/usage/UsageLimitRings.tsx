import "./limitsV9.css";
import { CornerUpLeftIcon, RotateCwIcon } from "lucide-react";
import { type ReactNode, useRef, useState } from "react";
import {
  displayLimitWindows,
  paceRemainingPercent,
  type LimitPool,
} from "@t3tools/shared/usageLimits";
import type { ServerProviderUsageWindow } from "@t3tools/contracts";
import { readUiLocale, uiText as copy } from "~/i18n";
import { useUiText } from "~/i18n/useUiText";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { gapText } from "./UsageLimitsHealth";
import { type QuotaTone, windowTone, worstTone } from "./limitsHealthModel";
import { UsageCount } from "./UsageMotion";
import { UsageDetailsSheet } from "./UsageDetailsSheet";
import {
  quotaForecast,
  quotaForecastState,
  quotaReadingLabel,
  quotaReadingStale,
  quotaWindowLabel,
  t3LimitWindows,
} from "./usageQuotaPresentation";

const formatNumber = (n: number) => String(Math.round(n));
const formatPercent = (n: number) => `${Math.round(n)}%`;
export const quotaStateText = {
  early: "Runs out early",
  tight: "Running low",
  ample: "Plenty left",
};

function formatShortReset(resetsAt: string | null | undefined, now: number): string | null {
  const at = Date.parse(resetsAt ?? "");
  if (!Number.isFinite(at)) return null;
  const stamp = new Date(at);
  const today = new Date(now);
  const day =
    stamp.toLocaleDateString(readUiLocale()) === today.toLocaleDateString(readUiLocale())
      ? copy("Today")
      : stamp.toLocaleDateString(readUiLocale(), { weekday: "short" });
  const time = stamp.toLocaleTimeString(readUiLocale(), {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  return `${day} ${time}`;
}

const TONE_COLOR: Record<QuotaTone, string> = {
  ok: "var(--v9-green)",
  warn: "var(--v9-amber)",
  bad: "var(--v9-red)",
};

function buildBurndownSpark(
  window: ServerProviderUsageWindow | undefined,
  now: number,
  stale: boolean,
  color: string,
) {
  if (!window || stale) return null;
  const forecast = quotaForecast(window, now);
  const remaining = forecast.remaining;
  const w = 220;
  const h = 44;
  let pts: number[];
  if (forecast.elapsed !== null && forecast.elapsed > 0.05) {
    const startVal = 100;
    const endVal = forecast.projected !== null ? Math.max(0, 100 - forecast.projected) : remaining;
    // 8 points across the window: linear from 100% -> current at elapsed -> projected end.
    pts = Array.from({ length: 8 }, (_, index) => {
      const t = index / 7;
      if (t <= forecast.elapsed!) {
        const ratio = t / Math.max(0.01, forecast.elapsed!);
        return startVal - (startVal - remaining) * ratio;
      }
      const ratio = (t - forecast.elapsed!) / Math.max(0.01, 1 - forecast.elapsed!);
      return Math.max(0, remaining - (remaining - endVal) * ratio);
    });
  } else {
    pts = [remaining, remaining];
  }
  const coords = pts.map(
    (v, i) => [(i / Math.max(1, pts.length - 1)) * w, h - (v / 100) * (h - 6) - 3] as const,
  );
  const d = coords
    .map(([cx, cy], i) => `${i === 0 ? "M" : "L"} ${cx.toFixed(1)} ${cy.toFixed(1)}`)
    .join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <path d={`${d} L ${w} ${h} L 0 ${h} Z`} fill={color} opacity="0.12" />
      <path d={d} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function UsageLimitRings({
  pool,
  now,
  label,
  fullLabel = label,
  poolId,
  flashHighlighted = false,
  runsOutToday = false,
  gapMs = null,
  onHoverStart,
  onHoverEnd,
  previewAffectedWindowIds,
  children,
}: {
  readonly pool: LimitPool;
  readonly now: number;
  readonly label: string;
  /** The name with its driver, shown on hover when the label is cut short. */
  readonly fullLabel?: string | undefined;
  readonly poolId?: string | undefined;
  readonly flashHighlighted?: boolean | undefined;
  readonly runsOutToday?: boolean | undefined;
  readonly gapMs?: number | null | undefined;
  readonly onHoverStart?: (() => void) | undefined;
  readonly onHoverEnd?: (() => void) | undefined;
  readonly previewAffectedWindowIds?: ReadonlySet<string> | undefined;
  readonly children: ReactNode;
}) {
  const text = useUiText();
  const outerRef = useRef<HTMLDivElement>(null);
  const tiltRef = useRef<HTMLDivElement>(null);
  const windows = displayLimitWindows(pool);
  const usable = t3LimitWindows(pool);
  const shared =
    pool.driver === "antigravity"
      ? windows
          .filter((w) => !w.id.startsWith("gemini-"))
          .toSorted((a, b) => a.remainingPercent - b.remainingPercent)[0]
      : undefined;
  const visibleRows =
    pool.driver === "antigravity"
      ? [
          ...["weekly", "session"].flatMap((kind) => {
            const row = usable
              .filter((w) => w.kind === kind)
              .toSorted((a, b) => a.remainingPercent - b.remainingPercent)[0];
            return row ? [row] : [];
          }),
          ...(shared ? [{ ...shared, label: text("Claude/GPT-OSS shared") }] : []),
        ]
      : windows;
  const all = usable.flatMap((w) => w.members.map((m) => m.window));
  const staleAccount = pool.accounts.find((a) => quotaReadingStale(a.limits, now));
  const staleLabel = staleAccount ? quotaReadingLabel(staleAccount.limits) : null;
  const state = staleLabel ? "stale" : all.length === 0 ? "unknown" : quotaForecastState(all, now);
  const [open, setOpen] = useState(false);
  const [flipped, setFlipped] = useState(false);
  const remaining = usable.length ? Math.min(...usable.map((w) => w.remainingPercent)) : null;
  // Prefer the weekly window for the back-face burn curve; fall back to the first window.
  const primaryWindow = all.find((w) => w.kind === "weekly") ?? all[0];

  // V13: one verdict per card — does every fresh window last until its reset?
  const tone = staleLabel
    ? null
    : worstTone(usable.flatMap((w) => w.members.map((m) => windowTone(m.window, now))));
  const toneColor = tone === null ? "var(--fg-3)" : TONE_COLOR[tone];
  const tightest = usable.toSorted((a, b) => a.remainingPercent - b.remainingPercent)[0];
  const tightestWindow = tightest?.members[0]?.window;
  const primaryForecast = primaryWindow && !staleLabel ? quotaForecast(primaryWindow, now) : null;
  const primaryResetAt = primaryWindow?.resetsAt ? Date.parse(primaryWindow.resetsAt) : Number.NaN;
  const primaryRunsOut =
    primaryForecast?.runOutAt != null &&
    Number.isFinite(primaryResetAt) &&
    primaryForecast.runOutAt < primaryResetAt;
  const primaryResetShort = formatShortReset(primaryWindow?.resetsAt, now);

  // Real average burn rate over elapsed window duration.
  let burnRateText = "--";
  if (
    primaryWindow &&
    primaryForecast?.elapsed != null &&
    primaryForecast.elapsed > 0.12 &&
    primaryWindow.windowDurationMins
  ) {
    const elapsedDays = (primaryForecast.elapsed * primaryWindow.windowDurationMins) / 1440;
    if (elapsedDays >= 0.2) {
      const perDay = primaryWindow.usedPercent / elapsedDays;
      const formatted = perDay < 10 ? perDay.toFixed(1) : String(Math.round(perDay));
      burnRateText = text("-{rate}% / day", { rate: formatted });
    } else {
      const elapsedHours = (primaryForecast.elapsed * primaryWindow.windowDurationMins) / 60;
      const perHour = primaryWindow.usedPercent / Math.max(0.1, elapsedHours);
      burnRateText = text("-{rate}% / hr", { rate: Math.round(perHour) });
    }
  }

  let backEtaText = text("Forecast unavailable");
  if (primaryRunsOut && primaryForecast?.runOutAt != null) {
    const hoursLeft = Math.max(0.1, (primaryForecast.runOutAt - now) / 3_600_000);
    backEtaText =
      hoursLeft < 48
        ? text("Est. full in {hours}h", { hours: hoursLeft.toFixed(1) })
        : text("Est. full in {days}d", { days: (hoursLeft / 24).toFixed(1) });
  } else if (primaryForecast?.elapsed != null && !staleLabel) {
    backEtaText = text("Lasts until reset");
  }

  // V14: a compact card shows at most two windows that T3 actually uses; the rest (e.g.
  // Antigravity's Claude/GPT-OSS pool) stay in the details sheet, counted in the footer.
  const cardRows = visibleRows
    .filter((w) => !(pool.driver === "antigravity" && !w.id.startsWith("gemini-")))
    .slice(0, 2);
  const hiddenRows = visibleRows.length - cardRows.length;
  const verdict = (() => {
    if (staleLabel) return staleLabel;
    if (remaining === null) return text("Gemini quota not reported");
    if (remaining <= 0) {
      const back = formatShortReset(tightestWindow?.resetsAt, now);
      return back ? text("Used up · back {time}", { time: back }) : text("Used up");
    }
    if (runsOutToday) {
      return gapMs !== null
        ? text("Runs out today · {gap}", { gap: gapText(text, gapMs) })
        : text("Runs out today");
    }
    if (gapMs !== null) {
      return text("Burning faster than time · {gap}", { gap: gapText(text, gapMs) });
    }
    return tone === "warn" ? text("Burning faster than time") : text("Lasts until reset");
  })();
  const tightestLabel = tightest
    ? quotaWindowLabel(tightest.label, readUiLocale() === "zh-CN")
    : null;

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const outer = outerRef.current;
    const tilt = tiltRef.current;
    if (!outer || !tilt) return;
    const rect = outer.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    outer.style.setProperty("--mx", `${(x * 100).toFixed(1)}%`);
    outer.style.setProperty("--my", `${(y * 100).toFixed(1)}%`);
    if (
      event.pointerType === "mouse" &&
      !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ) {
      tilt.style.setProperty("--rx", `${((0.5 - y) * 7).toFixed(2)}deg`);
      tilt.style.setProperty("--ry", `${((x - 0.5) * 8).toFixed(2)}deg`);
    }
  };
  const handlePointerLeave = () => {
    const tilt = tiltRef.current;
    if (tilt) {
      tilt.style.setProperty("--rx", "0deg");
      tilt.style.setProperty("--ry", "0deg");
    }
    onHoverEnd?.();
  };

  return (
    <div
      ref={outerRef}
      data-lv9-root=""
      data-lv9="vessel-outer"
      data-vid={poolId}
      data-flipped={flipped || undefined}
      data-flash={flashHighlighted || undefined}
      data-state={state}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      onPointerEnter={() => onHoverStart?.()}
    >
      <div ref={tiltRef} data-lv9="vessel-tilt">
        <div data-lv9="vessel-flip">
          <div data-lv9="vessel-face" aria-hidden={flipped || undefined}>
            <div data-lv9="vessel-sheen" aria-hidden="true" />
            <div data-lv9="vessel-content">
              <button
                type="button"
                data-lv9="vessel-trigger"
                tabIndex={flipped ? -1 : 0}
                aria-label={copy("View all {provider} quota windows", { provider: label })}
                onClick={() => setOpen(true)}
              />
              <div data-lv9="v-head" data-usage-limit-header>
                <span data-lv9="logo-slot">
                  <ProviderInstanceIcon
                    driverKind={pool.driver}
                    displayName={label}
                    className="size-3.5"
                    iconClassName="size-3.5"
                  />
                </span>
                <div data-lv9="v-title-col">
                  <div data-lv9="v-title">
                    <Tooltip>
                      <TooltipTrigger render={<span className="usage-limit-brand-name" />}>
                        {label}
                      </TooltipTrigger>
                      <TooltipPopup data-usage-portal side="top">
                        {fullLabel}
                      </TooltipPopup>
                    </Tooltip>
                  </div>
                </div>
              </div>
              <button
                type="button"
                data-lv9="v13-figure"
                data-tone={tone ?? undefined}
                data-state={state}
                tabIndex={flipped ? -1 : 0}
                aria-label={copy("{provider} quota forecast", { provider: label })}
                onClick={(event) => {
                  event.stopPropagation();
                  setOpen(true);
                }}
              >
                <b data-lv9="num" data-usage-figure>
                  {remaining === null ? (
                    "?"
                  ) : (
                    <UsageCount value={remaining} format={formatPercent} />
                  )}
                </b>
                {tightestLabel ? (
                  <span>{copy("{window} remaining", { window: tightestLabel })}</span>
                ) : null}
              </button>
              <div data-lv9="v13-verdict" data-tone={tone ?? undefined} data-usage-verdict>
                {verdict}
              </div>
              <div data-lv9="v13-rows" data-usage-limit-windows>
                {cardRows.map((w) => {
                  const pct = Math.round(w.remainingPercent);
                  const isUnused = pool.driver === "antigravity" && !w.id.startsWith("gemini-");
                  const memberWindow = w.members[0]?.window;
                  const winForecast =
                    memberWindow && !staleLabel && !isUnused
                      ? quotaForecast(memberWindow, now)
                      : null;
                  const winResetAt = memberWindow?.resetsAt
                    ? Date.parse(memberWindow.resetsAt)
                    : Number.NaN;
                  const winRunsOut =
                    winForecast?.runOutAt != null &&
                    Number.isFinite(winResetAt) &&
                    winForecast.runOutAt < winResetAt;
                  const winGapMs =
                    winRunsOut && winForecast?.runOutAt != null
                      ? winResetAt - Math.max(now, winForecast.runOutAt)
                      : null;
                  const winTone =
                    isUnused || staleLabel || !memberWindow ? null : windowTone(memberWindow, now);
                  const isPreviewRefill = Boolean(previewAffectedWindowIds?.has(w.id)) && pct < 100;
                  const paceLeft =
                    memberWindow && !isUnused && !staleLabel
                      ? paceRemainingPercent(memberWindow, now)
                      : null;
                  return (
                    <div
                      key={`${w.kind}:${w.id}`}
                      data-lv9="v13-row"
                      data-t3-unused={isUnused || undefined}
                      data-tone={winTone ?? undefined}
                    >
                      <div data-lv9="cap-row-head">
                        <span data-lv9="cap-row-name">
                          {quotaWindowLabel(w.label, readUiLocale() === "zh-CN")}
                          {isUnused ? (
                            <span data-lv9="cap-row-reset">
                              {" · "}
                              {text("T3 does not use this")}
                            </span>
                          ) : winGapMs !== null ? (
                            <span data-lv9="cap-row-reset">
                              {" · "}
                              {gapText(text, winGapMs)}
                            </span>
                          ) : null}
                        </span>
                        <span data-lv9="cap-row-val num">
                          {pct}%
                          {isPreviewRefill ? <span data-lv9="cap-row-next"> → 100%</span> : null}
                        </span>
                      </div>
                      <div data-lv9="v13-meter" aria-hidden="true">
                        <span
                          data-lv9="v13-fill"
                          style={{
                            width: `${Math.max(0, Math.min(100, pct))}%`,
                            background: winTone === null ? "var(--fg-3)" : TONE_COLOR[winTone],
                          }}
                        />
                        {isPreviewRefill ? (
                          <span
                            data-lv9="v13-preview"
                            style={{ left: `${pct}%`, width: `${100 - pct}%` }}
                          />
                        ) : null}
                        {paceLeft !== null ? (
                          <span
                            data-lv9="v13-tick"
                            data-usage-pace
                            style={{ left: `${Math.max(1, Math.min(99, paceLeft))}%` }}
                          />
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div data-lv9="cap-foot" className="usage-limit-action-slot">
                <span data-limit-countdown>
                  {primaryResetShort ? text("Resets {time}", { time: primaryResetShort }) : null}
                </span>
                {hiddenRows > 0 ? (
                  <span data-lv9="more-windows">
                    {text(hiddenRows === 1 ? "{count} more window" : "{count} more windows", {
                      count: hiddenRows,
                    })}
                  </span>
                ) : null}
                <div data-lv9="cap-foot-actions">
                  {children}
                  {primaryWindow ? (
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <button
                            type="button"
                            data-lv9="flip-icon-btn icon-only"
                            tabIndex={flipped ? -1 : 0}
                            aria-label={text("Burn rate")}
                            onClick={(event) => {
                              event.stopPropagation();
                              setFlipped(true);
                            }}
                          />
                        }
                      >
                        <RotateCwIcon aria-hidden="true" />
                      </TooltipTrigger>
                      <TooltipPopup data-usage-portal side="top">
                        {text("Burn rate")}
                      </TooltipPopup>
                    </Tooltip>
                  ) : null}
                </div>
              </div>
            </div>
          </div>

          <div data-lv9="vessel-face back" aria-hidden={!flipped || undefined}>
            <div data-lv9="vessel-sheen" aria-hidden="true" />
            <div data-lv9="vessel-content">
              <div data-lv9="v-head" style={{ marginBottom: 8 }}>
                <span data-lv9="logo-slot">
                  <ProviderInstanceIcon
                    driverKind={pool.driver}
                    displayName={label}
                    className="size-3.5"
                    iconClassName="size-3.5"
                  />
                </span>
                <div data-lv9="v-title-col">
                  <div data-lv9="v-title">
                    {label} · {text("Burn curve")}
                  </div>
                  <div data-lv9="v-sub">{backEtaText}</div>
                </div>
                <button
                  type="button"
                  data-lv9="flip-icon-btn"
                  tabIndex={flipped ? 0 : -1}
                  onClick={(event) => {
                    event.stopPropagation();
                    setFlipped(false);
                  }}
                >
                  <CornerUpLeftIcon aria-hidden="true" />
                  <span>{text("Back")}</span>
                </button>
              </div>
              <div data-lv9="back-stats">
                <div>
                  <div data-lv9="back-stat-lbl">{text("Daily burn")}</div>
                  <b data-lv9="num">{burnRateText}</b>
                </div>
                <div>
                  <div data-lv9="back-stat-lbl">{text("Next reset")}</div>
                  <b data-lv9="num">{primaryResetShort ?? "--"}</b>
                </div>
              </div>
              <div data-lv9="back-spark">
                {buildBurndownSpark(primaryWindow, now, Boolean(staleLabel), toneColor)}
              </div>
              <div data-lv9="cap-foot" style={{ marginTop: 8 }}>
                <span data-lv9="back-hint">{text("Hover swimlane to inspect gaps")}</span>
                <button
                  type="button"
                  data-lv9="chip-btn active"
                  tabIndex={flipped ? 0 : -1}
                  onClick={(event) => {
                    event.stopPropagation();
                    setOpen(true);
                  }}
                >
                  {text("Full details")}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <UsageDetailsSheet
        open={open}
        onOpenChange={setOpen}
        title={copy("{provider} · Quota details", { provider: label })}
        description={
          staleLabel ??
          (all.length === 0
            ? text("Gemini quota not reported")
            : copy(
                "The solid line shows the average rate. The dotted line projects that rate forward from the current reading.",
              ))
        }
      >
        {staleLabel ? <p role="status">{staleLabel}</p> : null}
        {windows.flatMap((group) =>
          group.members.map((member) => (
            <section
              className="usage-analysis-panel"
              key={`${member.account.key}:${member.window.kind}:${member.window.id}`}
            >
              {pool.driver === "antigravity" && !group.id.startsWith("gemini-") ? (
                <div data-t3-unused className="text-muted-foreground">
                  <h3>{text("Claude/GPT-OSS shared")}</h3>
                  <p>
                    {text("T3 does not use this")} · {Math.round(group.remainingPercent)}%
                  </p>
                </div>
              ) : (
                <UsageBurndown window={member.window} now={now} stale={Boolean(staleLabel)} />
              )}
            </section>
          )),
        )}
      </UsageDetailsSheet>
    </div>
  );
}

function UsageBurndown({
  window,
  now,
  stale = false,
}: {
  readonly window: ServerProviderUsageWindow;
  readonly now: number;
  readonly stale?: boolean;
}) {
  const forecast = quotaForecast(window, now);
  const elapsed = stale ? null : forecast.elapsed;
  const runOutAt = stale ? null : forecast.runOutAt;
  const resetAt = Date.parse(window.resetsAt ?? "");
  const used = 100 - forecast.remaining;
  const x = (value: number) => 36 + value * 464;
  const y = (value: number) => 190 - value * 1.6;
  const runsOut = runOutAt !== null && runOutAt < resetAt;
  const endTime = runsOut && forecast.projected !== null ? 100 / forecast.projected : 1;
  const projectedUsed = forecast.projected === null ? null : Math.min(100, forecast.projected);
  return (
    <div className="usage-burndown">
      <h3>{quotaWindowLabel(window.label, true)}</h3>
      <div className="usage-mega">
        <UsageCount value={forecast.remaining} format={formatNumber} />
        <small>{copy("% left")}</small>
      </div>
      {elapsed !== null ? (
        <svg
          viewBox="0 0 520 230"
          role="img"
          aria-label={copy(
            "Quota forecast. The vertical axis shows percent used and the solid line shows the average rate.",
          )}
        >
          {[0, 50, 100].map((value) => (
            <g key={value}>
              <line
                x1="36"
                y1={y(value)}
                x2="500"
                y2={y(value)}
                stroke="var(--border)"
                strokeDasharray="2 4"
              />
              <text x="30" y={y(value) + 4} textAnchor="end">
                {value}%
              </text>
            </g>
          ))}
          <line
            x1={x(0)}
            y1={y(0)}
            x2={x(1)}
            y2={y(100)}
            stroke="var(--muted-foreground)"
            strokeDasharray="5 5"
          />
          <line
            data-usage-lines
            x1={x(0)}
            y1={y(0)}
            x2={x(elapsed)}
            y2={y(used)}
            stroke="var(--primary)"
            strokeWidth="2.5"
          />
          {projectedUsed !== null ? (
            <line
              x1={x(elapsed)}
              y1={y(used)}
              x2={x(endTime)}
              y2={y(projectedUsed)}
              stroke="var(--primary)"
              strokeWidth="2"
              strokeDasharray="2 5"
            />
          ) : null}
          <circle cx={x(elapsed)} cy={y(used)} r="4" fill="var(--primary)" />
          {runsOut ? (
            <g data-usage-runout>
              <circle
                cx={x(endTime)}
                cy={y(100)}
                r="4.5"
                stroke="var(--primary)"
                strokeWidth="2"
                fill="var(--card)"
              />
              <text x={Math.max(80, Math.min(430, x(endTime)))} y="16" textAnchor="middle">
                {copy("Runs out")}
              </text>
            </g>
          ) : null}
          <text x="36" y="222">
            {copy("Start.")}
          </text>
          <text x={Math.max(80, Math.min(440, x(elapsed)))} y="208" textAnchor="middle">
            {copy("Now")}
          </text>
          <text x="500" y="222" textAnchor="end">
            {copy("Reset")}
          </text>
        </svg>
      ) : (
        <p>
          {stale
            ? copy("Reading is stale. Forecast unavailable.")
            : copy("The provider didn’t report valid window times. Rate unavailable.")}
        </p>
      )}
      <p>
        {elapsed !== null && elapsed <= 0.12
          ? copy("Window just started. Forecast unavailable.")
          : copy(
              "No historical readings. The solid line connects the start and current value. The dotted line projects the average rate.",
            )}
      </p>
      {runsOut ? (
        <p data-run-out-at={runOutAt}>
          {copy("At this pace, quota runs out {time}.", {
            time: new Date(runOutAt).toLocaleString(readUiLocale()),
          })}
        </p>
      ) : elapsed !== null && forecast.projected !== null ? (
        <p>
          {copy("At this pace, about {percent}% will be used by reset.", {
            percent: Math.round(forecast.projected),
          })}
        </p>
      ) : null}
      {window.resetsAt ? (
        <p>
          {copy("Resets: {time}", {
            time: new Date(window.resetsAt).toLocaleString(readUiLocale()),
          })}
        </p>
      ) : null}
    </div>
  );
}
