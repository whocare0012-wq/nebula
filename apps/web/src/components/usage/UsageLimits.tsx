import { readUiLocale } from "~/i18n";
import { quotaWindowLabel } from "./usageQuotaPresentation";
import {
  resetAdvanceLabel,
  resetFailureReason,
  resetCreditChoices,
  resetAffectedWindows,
  resetEffectLabel,
  resetExpiry,
  RESET_EARLY_REMAINING_PERCENT,
} from "./usageResetCreditPresentation";
import { toastManager } from "../ui/toast";
import { useUiText } from "~/i18n/useUiText";
import { uiText } from "~/i18n";
import {
  AuthProvidersManageScope,
  type EnvironmentId,
  type ProviderConsumeResetCreditOutcome,
  ProviderConsumeResetCreditInput,
  ServerProvider,
  ServerProviderResetCredits,
  ServerProviderUsageWindow,
  UsageProviderKind,
} from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { normalizeProviderAccentColor } from "@t3tools/client-runtime/state/provider-instance-display";
import {
  type LimitPace,
  paceOf,
  paceRemainingPercent,
  remainingPercent,
  type ResetCreditChoice,
} from "@t3tools/shared/usageLimits";
import { formatResetsIn } from "@t3tools/shared/usageLimitsCopy";
import { GaugeIcon, TrendingDownIcon, TrendingUpIcon } from "lucide-react";
import { Fragment, useLayoutEffect, useState, type ReactNode } from "react";

import { usePrimarySettings } from "../../hooks/useSettings";
import { observeResize } from "../../lib/observeResize";
import { environmentPresentations } from "../../state/presentation";
import { useEnvironmentScope, readEnvironmentScope } from "../../state/session";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { formatUpcomingTimestamp } from "../../timestampFormat";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { UsageLimitsPooled } from "./UsageLimitsPooled";
import { PROVIDER_PRESENTATION } from "./usageProviders";
const PACE: Record<
  LimitPace,
  {
    readonly label: string;
    readonly icon: typeof GaugeIcon;
  }
> = {
  ahead: {
    get label() {
      return uiText("Ahead of pace: spending faster than the window elapses");
    },
    icon: TrendingUpIcon,
  },
  on: {
    get label() {
      return uiText("On pace with the window");
    },
    icon: GaugeIcon,
  },
  under: {
    get label() {
      return uiText("Under pace: headroom left for the rest of the window");
    },
    icon: TrendingDownIcon,
  },
};

export function barColor(driver: ServerProvider["driver"]): string {
  const presentation = Object.values(PROVIDER_PRESENTATION).find(
    (entry) => entry.driverKind === driver,
  );
  return presentation?.color ?? "var(--foreground)";
}

function PaceIcon({ pace }: { readonly pace: LimitPace }) {
  const Icon = PACE[pace].icon;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            role={"img"}
            aria-label={PACE[pace].label}
            className={"inline-flex text-muted-foreground"}
          />
        }
      >
        <Icon className={"size-3.5"} aria-hidden />
      </TooltipTrigger>
      <TooltipPopup data-usage-portal side={"top"}>
        {PACE[pace].label}
      </TooltipPopup>
    </Tooltip>
  );
}

// The tick sits in a transparent gap cut from the bar, clamped so it stays inside at 0% and 100%.
// The gap is a clip-path slot rather than a mask: a mask composites its layer and re-antialiases
// the bar's rounded ends, and the polygon reaches 1px past the box so only the slot edges clip.
function paceMarkStyles(timeLeft: number | null) {
  if (timeLeft === null) return null;
  const at = `clamp(3px, ${timeLeft}%, calc(100% - 3px))`;
  const [left, right] = [`calc(${at} - 3px)`, `calc(${at} + 3px)`];
  const [near, far] = ["-1px", "calc(100% + 1px)"];
  return {
    tick: { left: at },
    gap: {
      clipPath: `polygon(${near} ${near}, ${left} ${near}, ${left} ${far}, ${right} ${far}, ${right} ${near}, ${far} ${near}, ${far} ${far}, ${near} ${far})`,
    },
    // For a track painted on an element that also draws focus rings, which a clip would cut.
    gappedTrack: {
      backgroundColor: "transparent",
      backgroundImage: `linear-gradient(to right, var(--color-muted) ${left}, transparent ${left}, transparent ${right}, var(--color-muted) ${right})`,
    },
  };
}

/**
 * Pace mark styles for the bar given the returned ref. Below 6px there is no room for the gap
 * and tick, so the bar draws neither, as the mobile bars do.
 */
export function usePaceMark(timeLeft: number | null) {
  const [bar, setBar] = useState<HTMLElement | null>(null);
  const [roomy, setRoomy] = useState(false);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- measures the bar DOM width before paint and remeasures through a ResizeObserver
  useLayoutEffect(() => {
    if (!bar) return;
    const measure = () => setRoomy(bar.getBoundingClientRect().width >= 6);
    measure();
    return observeResize(bar, measure);
  }, [bar]);
  return [setBar, roomy ? paceMarkStyles(timeLeft) : null] as const;
}

function WindowBar({
  color,
  window,
  now,
}: {
  readonly color: string;
  readonly window: ServerProviderUsageWindow;
  readonly now: number;
}) {
  const uiText = useUiText();
  const timestampFormat = usePrimarySettings((settings) => settings.timestampFormat);
  const remaining = remainingPercent(window);
  const timeLeft = paceRemainingPercent(window, now);
  const [barRef, paceMark] = usePaceMark(timeLeft);
  const resetsIn = formatResetsIn(window, now);
  const resetsAt = window.resetsAt
    ? formatUpcomingTimestamp(window.resetsAt, timestampFormat, now)
    : null;
  const summary = `${window.label}: ${remaining}% left${timeLeft === null ? "" : `, ${timeLeft}% of the window left`}${resetsIn ? `, ${resetsIn}` : ""}`;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <div
            ref={barRef}
            role={"img"}
            aria-label={summary}
            tabIndex={0}
            className={
              "relative h-6 cursor-default rounded-full outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            }
          />
        }
      >
        {/* Clip both layers so the gap exposes even a translucent composer surface. */}
        <div className={"absolute inset-0"} style={paceMark?.gap}>
          <div className={"absolute inset-x-0 inset-y-1.5 rounded-full bg-muted"} />
          {remaining > 0 ? (
            <div
              className={"absolute inset-y-1.5 left-0 rounded-full"}
              style={{ width: `${remaining}%`, backgroundColor: color }}
            />
          ) : null}
        </div>
        {paceMark ? (
          <span
            aria-hidden
            className={"absolute inset-y-1 w-0.5 -translate-x-1/2 rounded-full bg-foreground"}
            style={paceMark.tick}
          />
        ) : null}
      </TooltipTrigger>
      <TooltipPopup data-usage-portal side={"top"}>
        <div className={"flex flex-col gap-0.5"}>
          <span className={"text-foreground"}>
            {remaining}
            {uiText("% left")}
            {timeLeft !== null ? uiText(" · {0}% of the window left", { "0": timeLeft }) : ""}
          </span>
          {timeLeft !== null ? (
            <span className={"text-muted-foreground"}>
              {uiText("The line is where even spending would be.")}
            </span>
          ) : null}
          {resetsAt ? (
            <span className={"text-muted-foreground"}>
              {uiText("Resets")}
              {resetsAt}
              {resetsIn ? ` · ${resetsIn}` : ""}
            </span>
          ) : null}
        </div>
      </TooltipPopup>
    </Tooltip>
  );
}

export function LimitWindows({
  driver,
  accentColor,
  windows,
  now,
  compact = false,
}: {
  readonly driver: ServerProvider["driver"];
  readonly accentColor?: string | undefined;
  readonly windows: ReadonlyArray<ServerProviderUsageWindow>;
  readonly now: number;
  readonly compact?: boolean;
}) {
  const uiText = useUiText();
  const color = normalizeProviderAccentColor(accentColor) ?? barColor(driver);
  return (
    <div
      className={
        compact
          ? "grid grid-cols-[minmax(0,9rem)_minmax(3rem,1fr)_auto] gap-x-3 gap-y-0.5"
          : "grid grid-cols-[11rem_minmax(0,1fr)_7rem] gap-x-4 gap-y-1"
      }
    >
      {windows.map((window) => {
        const pace = paceOf(window, now);
        const resetsIn = formatResetsIn(window, now);
        return (
          <Fragment key={window.id}>
            <span className={"flex min-w-0 items-center gap-2 text-xs"}>
              <span className={"truncate text-muted-foreground"}>{window.label}</span>
              <span className={"ms-auto shrink-0 font-medium text-foreground tabular-nums"}>
                {remainingPercent(window)}
                {uiText("% left")}
              </span>
            </span>
            <WindowBar color={color} window={window} now={now} />
            <span
              className={
                "flex items-center gap-2 text-xs whitespace-nowrap text-muted-foreground tabular-nums"
              }
            >
              {pace ? <PaceIcon pace={pace} /> : null}
              <span className={"ms-auto shrink-0"}>{resetsIn ?? ""}</span>
            </span>
          </Fragment>
        );
      })}
    </div>
  );
}

const OUTCOME_TEXT: Record<ProviderConsumeResetCreditOutcome, string> = {
  reset: "Reset applied. Your windows have cleared.",
  nothingToReset: "Nothing to reset right now.",
  noCredit: "No reset credit left.",
  alreadyRedeemed: "That credit was already redeemed.",
};

export function useResetCredit(environmentId: EnvironmentId, totalCredits?: number) {
  const text = useUiText();
  const refresh = useAtomCommand(serverEnvironment.refreshProviders, { reportFailure: false });
  const canManageProviders = useEnvironmentScope(environmentId, AuthProvidersManageScope);
  const consume = useAtomCommand(serverEnvironment.consumeResetCredit, { reportFailure: false });
  // Kept after close so the dialog's text survives its exit animation.
  const [choice, setChoice] = useState<ResetCreditChoice | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const executeRedeem = async (target: ResetCreditChoice | null) => {
    setConfirming(false);
    if (!target || !readEnvironmentScope(environmentId, AuthProvidersManageScope)) return;
    setBusy(true);
    setStatus(null);
    await (async () => {
      const result = await consume({ environmentId, input: target.input });
      if (result._tag === "Success") {
        if (result.value.outcome === "reset") {
          const refreshed = await refresh({ environmentId, input: {} });
          if (refreshed._tag === "Failure") {
            const message = text(
              "Reset applied, but quota refresh failed. Refresh the quota to check its current status.",
            );
            setStatus(message);
            toastManager.add({ type: "warning", title: message });
            return;
          }
          const message = text("Reset applied · {count} credits left", {
            count: Math.max(0, (totalCredits ?? target.availableCount) - 1),
          });
          setStatus(message);
          toastManager.add({ type: "success", title: message });
        } else setStatus(text(OUTCOME_TEXT[result.value.outcome]));
        if (result.value.warning)
          toastManager.add({
            type: "warning",
            title: text("Reset status notice"),
            description: text("The provider returned a warning: {reason}", {
              reason: text(result.value.warning),
            }),
          });
        return;
      }
      const reason =
        "error" in result.cause && result.cause.error instanceof Error
          ? result.cause.error.message
          : text("Unknown provider error");
      setStatus(
        text("Could not use the reset credit: {reason}", { reason: resetFailureReason(reason) }),
      );
    })().finally(() => setBusy(false));
  };

  const redeem = async () => executeRedeem(choice);

  const redeemChoice = async (next: ResetCreditChoice) => {
    setChoice(next);
    await executeRedeem(next);
  };

  const confirm = (next: ResetCreditChoice) => {
    if (!readEnvironmentScope(environmentId, AuthProvidersManageScope)) return;
    setChoice(next);
    setConfirming(true);
  };

  return {
    canManageProviders,
    choice,
    confirming,
    setConfirming,
    confirm,
    busy,
    status,
    redeem,
    redeemChoice,
  };
}

/** Require confirmation because redemption spends credits. Mount outside popovers, which stack above
 * dialogs and unmount on close. */
export function ResetCreditDialog({
  open,
  onOpenChange,
  choice,
  choices = [],
  onChoice,
  credits,
  windows = [],
  provider = "",
  now,
  onConfirm,
  disabled = false,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly choice: ResetCreditChoice | null;
  readonly choices?: readonly ResetCreditChoice[];
  readonly onChoice?: (choice: ResetCreditChoice) => void;
  readonly credits?: ServerProviderResetCredits | undefined;
  readonly windows?: readonly ServerProviderUsageWindow[];
  readonly provider?: string;
  readonly now: number;
  readonly onConfirm: () => void;
  readonly disabled?: boolean;
}) {
  const text = useUiText();
  const affected = resetAffectedWindows(choice, credits, windows);
  const early =
    affected.length > 0 &&
    affected.every((w) => remainingPercent(w) >= RESET_EARLY_REMAINING_PERCENT);
  const multiple = choices.length > 1;
  const available = credits?.availableCount ?? choice?.availableCount ?? 0;
  const timestampFormat = usePrimarySettings((s) => s.timestampFormat);
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogPopup data-usage-portal variant="usage-reset">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {early
              ? text("It's a little early to use this")
              : multiple
                ? text("Choose a reset credit")
                : text("Use one reset credit to refill {provider}?", { provider })}
          </AlertDialogTitle>
          <AlertDialogDescription>{choice?.confirmDescription}</AlertDialogDescription>
        </AlertDialogHeader>
        {multiple ? (
          <fieldset className="usage-reset-options">
            <legend className="sr-only">{text("Choose a reset credit")}</legend>
            {choices.map((c) => {
              const option = credits?.options?.find((o) => o.creditId === c.key);
              return (
                <label key={c.key}>
                  <input
                    type="radio"
                    name="reset-credit"
                    value={c.key}
                    checked={c.key === choice?.key}
                    disabled={disabled || c.availableCount <= 0}
                    onChange={() => onChoice?.(c)}
                  />
                  <span>
                    <b>{resetEffectLabel(option?.label ?? c.actionLabel)}</b>
                    <small>{c.summary}</small>
                  </span>
                </label>
              );
            })}
          </fieldset>
        ) : null}
        <div className="usage-reset-effects">
          {affected.map((w) => (
            <div className="usage-reset-window" key={w.id}>
              <div>
                <span>{quotaWindowLabel(w.label, readUiLocale() === "zh-CN")}</span>
                <b>{remainingPercent(w)}% → 100%</b>
              </div>
              {w.resetsAt ? (
                <div>
                  <span>{text("Natural reset")}</span>
                  <span>
                    {formatUpcomingTimestamp(w.resetsAt, timestampFormat, now)} ·{" "}
                    {resetAdvanceLabel(w.resetsAt, now)}
                  </span>
                </div>
              ) : null}
            </div>
          ))}
          {!affected.length ? (
            <p>
              {text(
                "The provider has not reported the exact affected windows. Check the selected reset's effect before using it.",
              )}
            </p>
          ) : null}
          <div>
            <span>{text("Reset credits")}</span>
            <span>
              {text("{before} → {after} credits · earliest expiry {date}", {
                before: available,
                after: Math.max(0, available - 1),
                date: resetExpiry(
                  [credits?.nextExpiresAt, ...(credits?.options?.map((o) => o.expiresAt) ?? [])]
                    .filter((at): at is string => Boolean(at))
                    .toSorted()[0],
                ),
              })}
            </span>
          </div>
        </div>
        {early ? (
          <p className="usage-reset-warning">
            {text(
              "You still have at least {percent}% left. Waiting will make this credit go further.",
              { percent: RESET_EARLY_REMAINING_PERCENT },
            )}
          </p>
        ) : null}
        <p className="usage-reset-note">
          {text(
            "One credit is deducted by the provider and cannot be restored. The provider decides which credit to spend.",
          )}
        </p>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant={early ? "default" : "outline"} />}>
            {early ? text("Keep this credit for later") : text("Cancel")}
          </AlertDialogClose>
          <Button
            variant={early ? "outline" : "default"}
            disabled={disabled || !choice || choice.availableCount <= 0}
            onClick={onConfirm}
          >
            {early ? text("Use anyway") : multiple ? text("Use selected") : text("Use one credit")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}

export function ResetCredits({
  environmentId,
  input,
  credits,
  now,
}: {
  readonly environmentId: EnvironmentId;
  readonly input: ProviderConsumeResetCreditInput;
  readonly credits: ServerProviderResetCredits;
  readonly now: number;
}) {
  const { canManageProviders, choice, confirming, setConfirming, confirm, busy, status, redeem } =
    useResetCredit(environmentId, credits.availableCount);
  const choices = resetCreditChoices(credits, input, now);
  if (credits.availableCount === 0 && status === null) return null;
  return (
    <div className="flex flex-col gap-1 text-xs text-muted-foreground">
      {choices.map((choice) => (
        <div key={choice.key} className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="tabular-nums">{choice.summary}</span>
          {choice.availableCount > 0 ? (
            <Button
              size="xs"
              variant="outline"
              disabled={busy || !canManageProviders}
              onClick={() => confirm(choice)}
            >
              {busy ? uiText("Using…") : choice.actionLabel}
            </Button>
          ) : null}
        </div>
      ))}
      {status ? <span className="text-foreground">{status}</span> : null}
      <ResetCreditDialog
        open={confirming}
        onOpenChange={setConfirming}
        choice={choice}
        choices={choices}
        onChoice={confirm}
        credits={credits}
        now={now}
        onConfirm={() => void redeem()}
        disabled={!canManageProviders}
      />
    </div>
  );
}

/** Advance now only on explicit refresh to avoid page repaints from ticking. */
export function UsageLimitsSection({
  selectedEnvironmentIds,
  hiddenProviders,
  now,
  refreshControl,
}: {
  readonly refreshControl?: ReactNode;
  readonly selectedEnvironmentIds: ReadonlySet<EnvironmentId> | null;
  readonly hiddenProviders: ReadonlySet<UsageProviderKind>;
  readonly now: number;
}) {
  const presentations = useAtomValue(environmentPresentations.presentationsWithProvidersAtom);
  const hiddenDrivers = new Set<ServerProvider["driver"]>(
    [...hiddenProviders].map((provider) => PROVIDER_PRESENTATION[provider].driverKind),
  );
  const isVisible = (driver: ServerProvider["driver"]) => !hiddenDrivers.has(driver);
  const selected = new Map(
    [...presentations].flatMap(([id, presentation]) => {
      if (selectedEnvironmentIds !== null && !selectedEnvironmentIds.has(id)) return [];
      const config = presentation.serverConfig;
      if (hiddenDrivers.size === 0 || config === null) return [[id, presentation] as const];
      return [
        [
          id,
          {
            ...presentation,
            serverConfig: {
              ...config,
              providers: config.providers.filter((provider) => isVisible(provider.driver)),
              usageLimitSources: config.usageLimitSources?.flatMap((source) => {
                const accounts = source.accounts.filter((account) => isVisible(account.driver));
                return accounts.length === 0 && source.accounts.length > 0
                  ? []
                  : [{ ...source, accounts }];
              }),
            },
          },
        ] as const,
      ];
    }),
  );
  return <UsageLimitsPooled presentations={selected} now={now} refreshControl={refreshControl} />;
}
