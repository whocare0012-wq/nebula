import type { ThreadStructure } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId, OrchestrationV2RunStatus, ThreadId } from "@t3tools/contracts";
import { memo, useLayoutEffect, useRef, useState } from "react";

import { useUiText } from "../../i18n/useUiText";
import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from "../ui/popover";
import "./composerV9.css";
import { formatStatDuration, formatTokenCount, selectSessionStats } from "./sessionStats";
import { useVisibleTurnClock } from "./TurnThroughputStatus";
import { selectTurnThroughput, throughputReading } from "./turnThroughput";

const runLabels: Partial<Record<OrchestrationV2RunStatus, string>> = {
  preparing: "Preparing",
  starting: "Connecting to the model",
  queued: "Queued",
  waiting: "Waiting",
};

function positionStatsDockPill(pill: HTMLElement | null, btn: HTMLElement | null) {
  if (!pill) return;
  if (!btn) {
    pill.style.opacity = "0";
    return;
  }
  pill.style.opacity = "1";
  pill.style.width = `${btn.offsetWidth}px`;
  pill.style.transform = `translateX(${btn.offsetLeft}px)`;
}

export const SessionStatsBar = memo(function SessionStatsBar({
  projection,
  disconnected,
}: {
  projection: ThreadStructure;
  environmentId: EnvironmentId;
  threadId: ThreadId;
  itemCount: number;
  disconnected: boolean;
}) {
  const uiText = useUiText();
  const stats = selectSessionStats(projection);
  const [open, setOpen] = useState<"session" | "tokens" | null>(null);
  const clusterRef = useRef<HTMLDivElement>(null);
  const dockPillRef = useRef<HTMLDivElement>(null);
  const current = stats.current;
  const now = useVisibleTurnClock(current !== null && !disconnected);

  const moveDockPill = (btn: HTMLElement | null) => {
    positionStatsDockPill(dockPillRef.current, btn);
  };

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- syncs the V9 hover/active dock pill when a popover opens or closes
  useLayoutEffect(() => {
    if (!open) {
      positionStatsDockPill(dockPillRef.current, null);
      return;
    }
    const target = clusterRef.current?.querySelector<HTMLElement>(`[data-v9-stats-trig="${open}"]`);
    positionStatsDockPill(dockPillRef.current, target ?? null);
  }, [open]);

  if (stats.runCount === 0 && !stats.usageReported) return null;

  const notRecorded = uiText("Not recorded");
  const notReported = uiText("Not reported");
  const rateNumber = stats.outputRate === null ? null : Math.round(stats.outputRate);
  const rate = rateNumber === null ? null : uiText("{rate} tok/s", { rate: rateNumber });
  // Live turn rate: reported output so far over the turn's elapsed time; moves with each usage report.
  const liveSnapshot = current === null || disconnected ? null : selectTurnThroughput(projection);
  const liveRateValue =
    liveSnapshot === null || !liveSnapshot.running
      ? null
      : throughputReading(liveSnapshot, now).rate;
  const liveRateNumber = liveRateValue === null ? null : Math.round(liveRateValue);
  const liveRate =
    liveRateNumber === null ? null : uiText("{rate} tok/s", { rate: liveRateNumber });
  const rounds = uiText(stats.turns === 1 ? "{count} round" : "{count} rounds", {
    count: stats.turns,
  });
  const steps = (count: number) =>
    uiText(count === 1 ? "{count} step" : "{count} steps", { count });
  const total = (stats.inputTokens ?? 0) + (stats.outputTokens ?? 0);
  const totalText =
    stats.inputTokens === null && stats.outputTokens === null
      ? notReported
      : formatTokenCount(total);
  const cacheHitPercent = stats.cacheHitRate === null ? null : Math.round(stats.cacheHitRate * 100);
  const cacheHit =
    cacheHitPercent === null ? null : uiText("Cache hit {percent}%", { percent: cacheHitPercent });
  const cacheCompact =
    cacheHitPercent === null ? null : uiText("Cache {percent}%", { percent: cacheHitPercent });
  const busyMs = stats.modelMs + stats.toolMs;
  const modelShare = stats.timedTurns && busyMs > 0 ? stats.modelMs / busyMs : null;
  const modelPct = modelShare === null ? null : Math.round(modelShare * 100);
  const toolPct = modelPct === null ? null : 100 - modelPct;
  const cachedReadText =
    stats.cachedInputTokens === null ? notReported : formatTokenCount(stats.cachedInputTokens);

  const title = uiText("Session overview");
  const currentRound =
    current === null ? null : uiText("Round {count}", { count: stats.turns + 1 });
  const activeStatusLabel =
    current === null
      ? null
      : uiText(disconnected ? "Disconnected" : (runLabels[current.status] ?? "In progress"));
  const wideLeftSummary =
    current === null
      ? [`${rounds} ${steps(stats.steps)}`, rate].filter(Boolean).join(" · ")
      : [
          currentRound,
          activeStatusLabel,
          steps(current.steps),
          uiText("Elapsed {duration}", {
            duration: formatStatDuration(now - current.startMs, uiText, true),
          }),
          liveRate,
        ]
          .filter(Boolean)
          .join(" · ");
  const narrowLeftSummary =
    current === null
      ? [rounds, rateNumber === null ? null : `${rateNumber}/s`].filter(Boolean).join(" · ")
      : [currentRound, activeStatusLabel, liveRateNumber === null ? null : `${liveRateNumber}/s`]
          .filter(Boolean)
          .join(" · ");

  const wideRightSummary = [
    stats.inputTokens === null && stats.outputTokens === null
      ? notReported
      : uiText("{count} tok", { count: formatTokenCount(total) }),
    cacheCompact ?? cacheHit,
  ]
    .filter(Boolean)
    .join(" · ");
  const narrowRightSummary = [totalText, cacheHitPercent === null ? null : `${cacheHitPercent}%`]
    .filter(Boolean)
    .join(" · ");

  return (
    <div data-session-stats aria-label={uiText("Session statistics")}>
      <div
        ref={clusterRef}
        data-v9-stats-cluster
        onMouseLeave={() => {
          if (!open) moveDockPill(null);
        }}
      >
        <div ref={dockPillRef} aria-hidden="true" data-v9-stats-dock-pill />

        <Popover
          open={open === "session"}
          onOpenChange={(next) => setOpen(next ? "session" : null)}
        >
          <PopoverTrigger
            render={
              <button
                type="button"
                data-v9-stats-trig="session"
                onMouseEnter={(event) => moveDockPill(event.currentTarget)}
              />
            }
          >
            <span
              aria-hidden="true"
              data-v9-stats-dot
              data-running={current !== null ? "true" : undefined}
            />
            <span data-v9-stats-wide>{wideLeftSummary}</span>
            <span data-v9-stats-narrow>{narrowLeftSummary}</span>
          </PopoverTrigger>
          <PopoverPopup
            data-session-stats-popup
            side="top"
            align="center"
            sideOffset={10}
            padding="none"
          >
            <div data-session-stats-details>
              {/* Layer 1: Title + concise status badge */}
              <div data-v9-stats-head>
                <PopoverTitle>{title}</PopoverTitle>
                <span data-v9-badge={current === null ? "ok" : "ac"}>
                  {current === null ? uiText("3-layer summary") : activeStatusLabel}
                </span>
              </div>

              {/* Layer 2: Dual KPI grid */}
              <div data-v9-stats-grid data-bordered="true">
                <div>
                  <div data-v9-stats-kpi-label>{uiText("Rounds & steps")}</div>
                  <div data-v9-stats-kpi-value>
                    {current === null ? stats.turns : stats.turns + 1}
                    <small>
                      {" "}
                      {uiText("rounds")} ·{" "}
                      {steps(current === null ? stats.steps : stats.steps + current.steps)}
                    </small>
                  </div>
                </div>
                <div>
                  <div data-v9-stats-kpi-label>{uiText("Average rate")}</div>
                  <div data-v9-stats-kpi-value>
                    {rateNumber !== null ? (
                      <>
                        {rateNumber}
                        <small> {uiText("/s")}</small>
                      </>
                    ) : (
                      <small>{notReported}</small>
                    )}
                  </div>
                </div>
              </div>

              {/* Layer 3: Model thinking vs tool execution split */}
              <div data-v9-stats-foot>
                {modelPct !== null && toolPct !== null ? (
                  <>
                    <span>{uiText("Model thinking {percent}%", { percent: modelPct })}</span>
                    <span>{uiText("Tool execution {percent}%", { percent: toolPct })}</span>
                  </>
                ) : (
                  <>
                    <span>{uiText("Model time")}</span>
                    <span>{notRecorded}</span>
                  </>
                )}
              </div>
            </div>
          </PopoverPopup>
        </Popover>

        {stats.usageReported ? (
          <>
            <span aria-hidden="true" data-v9-stats-sep />
            <Popover
              open={open === "tokens"}
              onOpenChange={(next) => setOpen(next ? "tokens" : null)}
            >
              <PopoverTrigger
                render={
                  <button
                    type="button"
                    data-v9-stats-trig="tokens"
                    onMouseEnter={(event) => moveDockPill(event.currentTarget)}
                  />
                }
              >
                <span data-v9-stats-wide>{wideRightSummary}</span>
                <span data-v9-stats-narrow>{narrowRightSummary}</span>
              </PopoverTrigger>
              <PopoverPopup
                data-session-stats-popup
                side="top"
                align="center"
                sideOffset={10}
                padding="none"
              >
                <div data-session-token-details>
                  <div data-v9-stats-head>
                    <PopoverTitle>{uiText("Tokens & cache")}</PopoverTitle>
                    {cacheHitPercent !== null ? (
                      <span data-v9-badge="ac">
                        {uiText("Hit {percent}%", { percent: cacheHitPercent })}
                      </span>
                    ) : null}
                  </div>
                  <div data-v9-stats-grid>
                    <div>
                      <div data-v9-stats-kpi-label>{uiText("Total")}</div>
                      <div data-v9-stats-kpi-value>{totalText}</div>
                    </div>
                    <div>
                      <div data-v9-stats-kpi-label>{uiText("Cache read")}</div>
                      <div data-v9-stats-kpi-value>{cachedReadText}</div>
                    </div>
                  </div>
                </div>
              </PopoverPopup>
            </Popover>
          </>
        ) : current !== null || stats.turns > 0 ? (
          <>
            <span aria-hidden="true" data-v9-stats-sep />
            <span className="px-2 text-xs text-muted-foreground" data-session-usage-unreported>
              {/* A finished turn with no usage means this agent does not report it (some ACP agents). */}
              {stats.turns > 0
                ? uiText("Tokens and cost not reported")
                : uiText("Reported after this turn")}
            </span>
          </>
        ) : null}
      </div>
    </div>
  );
});
