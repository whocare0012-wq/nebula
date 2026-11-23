import {
  DEFAULT_MODEL,
  DEFAULT_MODEL_BY_PROVIDER,
  ProviderDriverKind,
  type EnvironmentId,
  type ModelSelection,
} from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import { collectLimitAccounts, limitPoolId, type LimitPool } from "@t3tools/shared/usageLimits";
import { CornerUpLeftIcon, RotateCwIcon } from "lucide-react";
import { useRef, useState } from "react";
import { type ComposerThreadTarget, useComposerDraftStore } from "~/composerDraftStore";
import { useUiText } from "~/i18n/useUiText";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import { getAppModalReturnThreadTarget } from "../sidebar/mainAppLocation";
import { summarizeHealth, type PoolHealth } from "./limitsHealthModel";

type LimitPresentations = Parameters<typeof collectLimitAccounts>[0];

export interface CompassOrbitNode {
  readonly pool: PoolHealth;
  readonly cx: number;
  readonly cy: number;
  readonly color: string;
}

export interface CompassOrbitArc {
  readonly poolId: string;
  readonly radius: number;
  readonly dashArray: string;
  readonly rotate: number;
  readonly color: string;
}

export interface CompassGeometry {
  readonly arcs: readonly CompassOrbitArc[];
  readonly nodes: readonly CompassOrbitNode[];
}

export interface CompassNextMessageResult {
  readonly applied: boolean;
  readonly target: ComposerThreadTarget | null;
  readonly selection: ModelSelection | null;
}

function isAlertPool(entry: PoolHealth): boolean {
  return (
    entry.runsOutToday || entry.state === "early" || (entry.lowest !== null && entry.lowest <= 20)
  );
}

function orbitColor(entry: PoolHealth): string {
  if (isAlertPool(entry)) return "var(--bad)";
  if (entry.lowest !== null) return "var(--ok)";
  return "var(--fg-3)";
}

function pointOnCircle(radius: number, deg: number): { readonly cx: number; readonly cy: number } {
  const rad = (deg * Math.PI) / 180;
  return {
    cx: Number((65 + radius * Math.cos(rad)).toFixed(1)),
    cy: Number((65 + radius * Math.sin(rad)).toFixed(1)),
  };
}

/**
 * Maps live pool health readings onto the 130×130 V9 stardust compass rings.
 * For 3 pools this reproduces V9's exact three-orbit layout (outer dashed r=54,
 * middle arc r=39, inner arc r=24) while scaling cleanly to any number of pools.
 */
function buildCompassGeometry(pools: readonly PoolHealth[]): CompassGeometry {
  const ranked = pools.toSorted((a, b) => (b.lowest ?? -1) - (a.lowest ?? -1));
  const arcs: CompassOrbitArc[] = [];
  const nodes: CompassOrbitNode[] = [];

  if (ranked.length === 0) return { arcs, nodes };

  const addArcAndNode = (
    entry: PoolHealth,
    radius: number,
    rotate: number,
    nodeAngleDeg: number,
    minDash: number,
  ) => {
    const color = orbitColor(entry);
    const circumference = Math.round(2 * Math.PI * radius);
    const pct = entry.lowest ?? 0;
    const dash =
      entry.lowest === null ? minDash : Math.max(minDash, Math.round((pct / 100) * circumference));
    arcs.push({
      poolId: entry.id,
      radius,
      dashArray: `${dash} ${circumference}`,
      rotate,
      color,
    });
    const pt = pointOnCircle(radius, nodeAngleDeg);
    nodes.push({ pool: entry, cx: pt.cx, cy: pt.cy, color });
  };

  if (ranked.length === 1) {
    addArcAndNode(ranked[0]!, 39, -70, -24, 14);
    return { arcs, nodes };
  }

  if (ranked.length === 2) {
    addArcAndNode(ranked[0]!, 39, -70, -24, 14);
    addArcAndNode(ranked[1]!, 24, 20, 12, 14);
    return { arcs, nodes };
  }

  // 3+ pools: highest sits on the outer dashed ring, second on middle r=39, lowest on inner r=24.
  const highest = ranked[0]!;
  const middle = ranked[1]!;
  const lowest = ranked[ranked.length - 1]!;
  addArcAndNode(middle, 39, -70, -24, 14);
  addArcAndNode(lowest, 24, 20, 12, 14);

  const outerPt = pointOnCircle(54, -121.5);
  nodes.push({ pool: highest, cx: outerPt.cx, cy: outerPt.cy, color: orbitColor(highest) });

  const extraOuterAngles = [150, 210, 60, -55, 110, 255];
  const extras = ranked.slice(2, -1);
  extras.forEach((entry, index) => {
    const angle = extraOuterAngles[index] ?? 90 + ((index + 1) / (extras.length + 1)) * 180;
    const pt = pointOnCircle(54, angle);
    nodes.push({ pool: entry, cx: pt.cx, cy: pt.cy, color: orbitColor(entry) });
  });

  return { arcs, nodes };
}

/** Returns the 1–2 most ample real pools with live readings for the compass back face. */
function compassBackupCandidates(pools: readonly PoolHealth[]): readonly PoolHealth[] {
  return pools
    .filter((entry) => entry.lowest !== null)
    .toSorted((a, b) => (b.lowest ?? 0) - (a.lowest ?? 0))
    .slice(0, 2);
}

function resolveProviderSelectionForEnvironment(
  pool: LimitPool,
  environmentId: EnvironmentId,
  presentations: LimitPresentations,
): ModelSelection | null {
  const providers = presentations.get(environmentId)?.serverConfig?.providers ?? [];
  const poolInstanceIds = new Set(
    pool.accounts.flatMap((account) =>
      (account.instances ?? [])
        .filter((inst) => inst.environmentId === environmentId)
        .map((inst) => inst.instanceId),
    ),
  );
  const provider =
    providers.find(
      (candidate) =>
        poolInstanceIds.has(candidate.instanceId) &&
        candidate.enabled &&
        candidate.status === "ready",
    ) ??
    (poolInstanceIds.size === 0
      ? providers.find(
          (candidate) =>
            candidate.driver === pool.driver && candidate.enabled && candidate.status === "ready",
        )
      : undefined);
  if (!provider) return null;

  const draftState = useComposerDraftStore.getState();
  const stickySlug = draftState.stickyModelSelectionByProvider[provider.instanceId]?.model ?? null;
  const resolvedModel =
    (stickySlug && provider.models.some((model) => model.slug === stickySlug)
      ? stickySlug
      : null) ??
    provider.models.find((model) => model.isDefault && !model.isCustom)?.slug ??
    provider.models.find((model) => !model.isCustom)?.slug ??
    provider.models[0]?.slug ??
    DEFAULT_MODEL_BY_PROVIDER[provider.driver] ??
    DEFAULT_MODEL;
  const rememberedOptions =
    draftState.stickyOptionsByModelByProvider[provider.instanceId]?.[resolvedModel];
  return createModelSelection(
    provider.instanceId,
    resolvedModel,
    rememberedOptions && rememberedOptions.length > 0 ? [...rememberedOptions] : undefined,
  );
}

/**
 * Sets the composer draft's model selection on the current or most recent thread
 * without modifying sticky/default model preferences.
 */
function applyBackupForNextMessage(
  pool: LimitPool,
  presentations: LimitPresentations,
): CompassNextMessageResult {
  const draftState = useComposerDraftStore.getState();

  const tryTarget = (
    target: ComposerThreadTarget,
    environmentId: EnvironmentId,
  ): CompassNextMessageResult | null => {
    const selection = resolveProviderSelectionForEnvironment(pool, environmentId, presentations);
    if (!selection) return null;
    draftState.setModelSelection(target, selection, { explicit: true, replaceOptions: true });
    return { applied: true, target, selection };
  };

  // 1. Prefer the exact thread or draft over which the Usage modal opened.
  const returnTarget = getAppModalReturnThreadTarget();
  if (returnTarget?.kind === "server") {
    const applied = tryTarget(returnTarget.threadRef, returnTarget.threadRef.environmentId);
    if (applied) return applied;
  } else if (returnTarget?.kind === "draft") {
    const draft = draftState.getDraftSession(returnTarget.draftId);
    if (draft) {
      const applied = tryTarget(returnTarget.draftId, draft.environmentId);
      if (applied) return applied;
    }
  }

  // Never guess another thread: switching an unrelated conversation's model silently is worse than
  // falling back to highlighting the pool card.
  return { applied: false, target: null, selection: null };
}

function renderTemplatedSentence(template: string, boldTokens: Readonly<Record<string, string>>) {
  const keys = Object.keys(boldTokens);
  if (keys.length === 0) return template;
  const pattern = new RegExp(`(${keys.map((k) => `\\{${k}\\}`).join("|")})`, "g");
  const seen = new Map<string, number>();
  return template.split(pattern).map((segment) => {
    const match = segment.match(/^\{([A-Za-z0-9_]+)\}$/);
    const tokenKey = match?.[1];
    if (tokenKey && Object.hasOwn(boldTokens, tokenKey)) {
      const count = (seen.get(tokenKey) ?? 0) + 1;
      seen.set(tokenKey, count);
      return <b key={`${tokenKey}:${count}`}>{boldTokens[tokenKey]}</b>;
    }
    return segment;
  });
}

export function UsageLimitsCompass({
  pools,
  health,
  presentations,
  onFocusPool,
}: {
  readonly pools: readonly LimitPool[];
  readonly health: readonly PoolHealth[];
  readonly presentations: LimitPresentations;
  readonly onFocusPool: (poolId: string) => void;
}) {
  const text = useUiText();
  const [flipped, setFlipped] = useState(false);
  const [queuedPoolId, setQueuedPoolId] = useState<string | null>(null);
  const outerRef = useRef<HTMLElement>(null);
  const tiltRef = useRef<HTMLDivElement>(null);

  if (health.length === 0) return null;

  const summary = summarizeHealth(health);
  const alertCount = health.filter(isAlertPool).length;
  const ampleCount = health.filter((entry) => !isAlertPool(entry) && entry.lowest !== null).length;
  const geometry = buildCompassGeometry(health);
  const backups = compassBackupCandidates(health);
  const poolById = new Map(pools.map((pool) => [limitPoolId(pool), pool]));

  const alertPools = health
    .filter(isAlertPool)
    .toSorted(
      (a, b) =>
        Number(b.runsOutToday) - Number(a.runsOutToday) || (a.lowest ?? 100) - (b.lowest ?? 100),
    );
  const tightest = alertPools[0] ?? null;
  const bestBackup =
    backups.find((entry) => entry.id !== tightest?.id && !isAlertPool(entry)) ?? null;
  const anyCredits = health.some((entry) => (entry.credits ?? 0) > 0);

  const headline =
    alertCount === 0
      ? text("All orbits ready")
      : ampleCount > 0
        ? text("Global capacity ample")
        : text("All orbits running tight");

  const descriptionNode = (() => {
    if (alertCount > 0 && tightest) {
      const hasCard = (tightest.credits ?? 0) > 0 && tightest.redeemable;
      const planName = tightest.plans[0];
      const cardText = planName
        ? text("{plan} reset card", { plan: planName })
        : text("reset card");
      const backupText = bestBackup
        ? `${bestBackup.label} ${Math.round(bestBackup.lowest ?? 0)}%`
        : null;
      if (hasCard && backupText) {
        return renderTemplatedSentence(
          text("{provider} is running low: use {card}, or switch to {backup} as backup.", {
            provider: tightest.label,
          }),
          { card: cardText, backup: backupText },
        );
      }
      if (hasCard) {
        return renderTemplatedSentence(
          text("{provider} is running low: use {card} to refill.", {
            provider: tightest.label,
          }),
          { card: cardText },
        );
      }
      if (backupText) {
        return renderTemplatedSentence(
          text("{provider} is running low: switch to {backup} as backup.", {
            provider: tightest.label,
          }),
          { backup: backupText },
        );
      }
      return text("{provider} is running low; no ample backup orbit right now.", {
        provider: tightest.label,
      });
    }
    if (anyCredits) {
      return text(
        "All orbits are at safe levels; remaining reset cards can wait for next week's peak.",
      );
    }
    return text("All orbits are at safe levels and ready to route.");
  })();

  const handlePointerMove = (event: React.PointerEvent<HTMLElement>) => {
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
  };

  const handleUseBackup = (entry: PoolHealth) => {
    const pool = poolById.get(entry.id);
    if (pool) {
      const result = applyBackupForNextMessage(pool, presentations);
      if (result.applied) {
        setQueuedPoolId(entry.id);
        return;
      }
    }
    onFocusPool(entry.id);
  };

  const queuedPool = queuedPoolId ? health.find((entry) => entry.id === queuedPoolId) : null;

  return (
    <section
      ref={outerRef}
      data-usage-compass=""
      data-lv9="vessel-outer"
      data-vid="compass"
      data-flipped={flipped || undefined}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
    >
      <div ref={tiltRef} data-lv9="vessel-tilt">
        <div data-lv9="vessel-flip">
          <div data-lv9="vessel-face compass-glass" aria-hidden={flipped || undefined}>
            <div data-lv9="vessel-sheen" aria-hidden="true" />
            <div data-lv9="vessel-content">
              <div data-lv9="v-head compass-head-front">
                <span data-lv9="badge violet">{text("Stardust compass")}</span>
                <span data-lv9="sp" />
                <button
                  type="button"
                  data-lv9="flip-icon-btn"
                  data-flip-id="compass"
                  tabIndex={flipped ? -1 : 0}
                  onClick={(event) => {
                    event.stopPropagation();
                    setFlipped(true);
                  }}
                >
                  <RotateCwIcon aria-hidden="true" />
                  <span>{text("Switch backup")}</span>
                </button>
              </div>
              <div data-lv9="compass-stage">
                <svg
                  data-lv9="compass-svg"
                  viewBox="0 0 130 130"
                  role="img"
                  aria-label={text(
                    summary.total === 1
                      ? "Monitoring {count} compute orbit"
                      : "Monitoring {count} compute orbits",
                    { count: summary.total },
                  )}
                >
                  <circle
                    cx="65"
                    cy="65"
                    r="54"
                    fill="none"
                    stroke="var(--line)"
                    strokeWidth="1"
                    strokeDasharray="2 3"
                  />
                  {geometry.arcs.map((arc) => (
                    <circle
                      key={`arc-${arc.poolId}`}
                      cx="65"
                      cy="65"
                      r={arc.radius}
                      fill="none"
                      stroke={arc.color}
                      strokeWidth="2"
                      strokeDasharray={arc.dashArray}
                      transform={`rotate(${arc.rotate} 65 65)`}
                    />
                  ))}
                  <circle cx="65" cy="65" r="7" fill="var(--violet)" />
                  {geometry.nodes.map((node) => (
                    <circle
                      key={`node-${node.pool.id}`}
                      data-compass-node={node.pool.id}
                      cx={node.cx}
                      cy={node.cy}
                      r="4.5"
                      fill={node.color}
                    >
                      <title>
                        {node.pool.label}
                        {node.pool.lowest !== null ? ` ${Math.round(node.pool.lowest)}%` : ""}
                      </title>
                    </circle>
                  ))}
                </svg>
                <div data-lv9="compass-copy">
                  <div data-lv9="compass-title">{headline}</div>
                  <div data-lv9="compass-desc">{descriptionNode}</div>
                  <div data-lv9="compass-badges">
                    {ampleCount > 0 ? (
                      <span data-lv9="badge ok">
                        {text(ampleCount === 1 ? "{count} ample orbit" : "{count} ample orbits", {
                          count: ampleCount,
                        })}
                      </span>
                    ) : null}
                    {alertCount > 0 ? (
                      <span data-lv9="badge bad">
                        {text(alertCount === 1 ? "{count} alert orbit" : "{count} alert orbits", {
                          count: alertCount,
                        })}
                      </span>
                    ) : null}
                    {ampleCount === 0 && alertCount === 0 ? (
                      <span data-lv9="badge muted">
                        {text(
                          summary.total === 1
                            ? "{count} orbit monitored"
                            : "{count} orbits monitored",
                          { count: summary.total },
                        )}
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>
              <div data-lv9="cap-foot">
                <span>
                  {text(
                    summary.total === 1
                      ? "Monitoring {count} compute orbit"
                      : "Monitoring {count} compute orbits",
                    { count: summary.total },
                  )}
                </span>
                <span data-lv9="compass-foot-status">{text("Stardust routing ready")}</span>
              </div>
            </div>
          </div>

          <div data-lv9="vessel-face back compass-glass" aria-hidden={!flipped || undefined}>
            <div data-lv9="vessel-sheen" aria-hidden="true" />
            <div data-lv9="vessel-content">
              <div data-lv9="v-head compass-head-back">
                <span data-lv9="badge violet">{text("Compatible backups")}</span>
                <span data-lv9="sp" />
                <button
                  type="button"
                  data-lv9="flip-icon-btn"
                  data-flip-id="compass"
                  tabIndex={flipped ? 0 : -1}
                  onClick={(event) => {
                    event.stopPropagation();
                    setFlipped(false);
                  }}
                >
                  <CornerUpLeftIcon aria-hidden="true" />
                  <span>{text("Back to compass")}</span>
                </button>
              </div>
              <div data-lv9="compass-sub-list">
                {backups.length > 0 ? (
                  backups.map((entry, index) => {
                    const tone = isAlertPool(entry)
                      ? entry.state === "tight"
                        ? "warn"
                        : "bad"
                      : "ok";
                    const isQueued = queuedPoolId === entry.id;
                    return (
                      <div key={entry.id} data-lv9="sub-row" data-compass-backup={entry.id}>
                        <span data-lv9="sub-row-info">
                          <span data-lv9="logo-slot">
                            <ProviderInstanceIcon
                              driverKind={ProviderDriverKind.make(entry.driver)}
                              displayName={entry.label}
                              className="size-3.5"
                              iconClassName="size-3.5"
                            />
                          </span>
                          <b data-lv9="sub-row-name">{entry.label}</b>
                          <span data-lv9={`badge ${tone} num`}>
                            {Math.round(entry.lowest ?? 0)}%
                          </span>
                        </span>
                        <button
                          type="button"
                          data-lv9={index === 0 || isQueued ? "chip-btn active" : "chip-btn"}
                          data-compass-use={entry.id}
                          tabIndex={flipped ? 0 : -1}
                          onClick={(event) => {
                            event.stopPropagation();
                            handleUseBackup(entry);
                          }}
                        >
                          {isQueued ? text("Queued for next") : text("Use for next message")}
                        </button>
                      </div>
                    );
                  })
                ) : (
                  <div data-lv9="compass-desc">{text("No backup orbits with live quota yet.")}</div>
                )}
              </div>
              <div data-lv9="cap-foot">
                <span>
                  {queuedPool
                    ? text("Next message will use {provider}; default model unchanged", {
                        provider: queuedPool.label,
                      })
                    : text("Only affects next message, default model unchanged")}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
