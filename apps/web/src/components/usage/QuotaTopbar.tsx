import { UsageSegments } from "./UsageSegments";
import { Toggle } from "../ui/toggle-group";
import { useLocale } from "gt-react";
import { useAtomValue } from "@effect/atom-react";
import { AuthProvidersManageScope } from "@t3tools/contracts";
import { refreshUsageLimits } from "@t3tools/client-runtime/state/usage";
import {
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowUpIcon,
  ChevronDownIcon,
  GaugeIcon,
  RefreshCwIcon,
  SlidersHorizontalIcon,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { resolveThreadProviderStack } from "@t3tools/client-runtime/state/models";
import { useQuietThreadShell } from "../../state/entities";
import { resolveThreadRouteRef } from "../../threadRoutes";
import { readUiLocale, uiText as copy } from "~/i18n";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { environmentPresentations } from "../../state/presentation";
import { serverEnvironment } from "../../state/server";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { readEnvironmentScope } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from "../ui/popover";
import { Switch } from "../ui/switch";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  DEFAULT_QUOTA_PREFERENCES,
  QUOTA_PREFERENCES_KEY,
  QuotaPreferencesSchema,
  createQuotaAccountsSelector,
  quotaPins,
  quotaShownIds,
  quotaModelFor,
  quotaState,
  quotaWindow,
  type QuotaAccount,
  type QuotaCurrent,
  type QuotaPreferences,
} from "./quotaTopbarModel";
import styles from "./quotaTopbar.module.css";
import { quotaPlanLabel, quotaWindowLabel } from "./usageQuotaPresentation";

function windowName(window: NonNullable<ReturnType<typeof quotaWindow>>, compact = false) {
  if (window.id === "3p-weekly") return copy("Claude/GPT shared · wk");
  if (window.kind === "weekly" && /^(weekly|week)$/i.test(window.label))
    return copy(compact ? "wk" : "Weekly");
  if (window.kind === "monthly" && /^(monthly|month)$/i.test(window.label))
    return copy(compact ? "mo" : "Monthly");
  if (
    window.kind === "session" &&
    window.windowDurationMins &&
    /^(session|5h|5 hours?|five hour)$/i.test(window.label)
  )
    return copy("{count}h", { count: window.windowDurationMins / 60 });
  return quotaWindowLabel(window.label, readUiLocale() === "zh-CN");
}
function NameTip({ account }: { readonly account: QuotaAccount }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<strong />}>{account.title}</TooltipTrigger>
      <TooltipPopup side="top">{fullName(account)}</TooltipPopup>
    </Tooltip>
  );
}
/** The name shown for a login, with its driver after it when they differ. */
function fullName(account: QuotaAccount) {
  return account.title === account.label ? account.label : `${account.title} · ${account.label}`;
}
function stateLabel(state: ReturnType<typeof quotaState>["state"]) {
  return state === "unknown"
    ? copy("Quota unavailable")
    : state === "reset"
      ? copy("Refresh due")
      : state === "stale"
        ? copy("Cached")
        : "";
}
/** When a window resets, as a plain time ("今天 02:20 重置"); countdowns live on the limits page. */
function resetLabel(window: ReturnType<typeof quotaWindow>, now: number, bare = false) {
  const reset = Date.parse(window?.resetsAt ?? "");
  if (!Number.isFinite(reset) || reset <= now) return "";
  const at = new Date(reset);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const days = Math.floor((at.getTime() - today.getTime()) / 86_400_000);
  const locale = readUiLocale();
  const time = at.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", hour12: false });
  const day =
    days === 0
      ? copy("Today")
      : days === 1
        ? copy("Tomorrow")
        : days < 7
          ? at.toLocaleDateString(locale, { weekday: "short" })
          : at.toLocaleDateString(locale, { month: "numeric", day: "numeric" });
  return bare ? `${day} ${time}` : copy("Resets {day} {time}", { day, time });
}
type QuotaWindowRow = NonNullable<ReturnType<typeof quotaWindow>>;
/** Splits "Gemini · 本周" into a group and a window so shared pools read as small groups. */
function windowParts(window: QuotaWindowRow) {
  if (window.id === "3p-weekly") return { group: copy("Claude/GPT shared"), name: copy("Weekly") };
  const name = windowName(window);
  const at = name.lastIndexOf(" · ");
  return at > 0 ? { group: name.slice(0, at), name: name.slice(at + 3) } : { group: "", name };
}
function groupedWindows(windows: readonly QuotaWindowRow[]) {
  const groups = new Map<string, Array<{ window: QuotaWindowRow; name: string }>>();
  for (const window of windows) {
    const { group, name } = windowParts(window);
    groups.set(group, [...(groups.get(group) ?? []), { window, name }]);
  }
  const order = (w: QuotaWindowRow) => (w.kind === "session" ? 0 : w.kind === "weekly" ? 1 : 2);
  return [...groups].map(([group, rows]) => ({
    group,
    rows: rows.toSorted((a, b) => order(a.window) - order(b.window)),
  }));
}
function latestStamp(accounts: readonly QuotaAccount[]) {
  const checked = Math.max(...accounts.map((a) => Date.parse(a.limits?.checkedAt ?? "") || 0), 0);
  return checked
    ? new Date(checked).toLocaleString(readUiLocale(), {
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";
}
function QuotaIcon({
  account,
  remaining,
  dim = false,
  compact = false,
}: {
  readonly account: QuotaAccount;
  readonly remaining: number | null;
  readonly dim?: boolean;
  readonly compact?: boolean;
}) {
  return (
    <span
      className={styles["quota-ring"]}
      data-dim={dim || undefined}
      data-compact={compact || undefined}
      data-driver={account.driver}
      data-remaining={remaining ?? undefined}
      data-apple-low={remaining !== null && remaining <= 30 ? "" : undefined}
      aria-hidden={compact || undefined}
      style={{ "--quota-progress": `${remaining ?? 0}%` } as CSSProperties}
    >
      {!compact ? (
        <ProviderInstanceIcon
          driverKind={account.driver}
          displayName={account.title}
          className="size-5"
          iconClassName="size-3.5"
        />
      ) : (
        <span />
      )}
    </span>
  );
}
/** The popup's open spring (apple.css, 360ms) plus a frame; deferred work starts after it settles. */
const QUOTA_OPEN_SETTLE_MS = 380;
function placeQuotaPopupOrigin(
  popup: HTMLElement | null,
  host: HTMLElement | null,
  origin: HTMLElement | null,
): boolean {
  const width = popup?.offsetWidth ?? 0;
  if (!popup || !host || !origin || !width) return false;
  // Measure the unscaled positioner wrapper so mid-transition scale() never shifts originX.
  const posRect = popup.parentElement?.getBoundingClientRect();
  const hostRect = host.getBoundingClientRect();
  const isPositioned =
    posRect !== undefined && posRect.width > 0 && (posRect.left > 0 || posRect.top > 0);
  const popLeft = isPositioned ? posRect.left : Math.max(0, hostRect.right - width);
  const originRect = origin.getBoundingClientRect();
  const x = Math.max(24, Math.min(width - 24, originRect.left + originRect.width / 2 - popLeft));
  popup.style.setProperty("transform-origin", `${Math.round(x)}px -16px`);
  return true;
}

export function QuotaTopbarView({
  accounts,
  now,
  preferences,
  onPreferences,
  onRefresh,
  refreshing = false,
  onUsage,
  onOpenChange,
  current = null,
}: {
  readonly accounts: readonly QuotaAccount[];
  readonly now: number;
  readonly preferences: QuotaPreferences;
  readonly onPreferences: (preferences: QuotaPreferences) => void;
  readonly onRefresh: (automatic: boolean) => void;
  readonly refreshing?: boolean;
  readonly onUsage: () => void;
  readonly onOpenChange?: (open: boolean) => void;
  /** The open thread's provider instance, whose login is shown first while following is on. */
  readonly current?: QuotaCurrent | null;
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"overview" | "all" | "settings">("overview");
  // Which top-bar chip opened the panel (for aria-expanded); rows no longer collapse.
  const [expanded, setExpanded] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");
  // V9: the panel grows out of (and shrinks back into) whichever chip or button opened it.
  const topbarRef = useRef<HTMLDivElement>(null);
  const originRef = useRef<HTMLElement | null>(null);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  // V11 smoothness: the automatic quota probe re-renders provider state app-wide, so it starts
  // only after the 360ms open spring instead of competing with it for frames.
  const refreshTimerRef = useRef<number | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- clears the deferred open-refresh timeout on unmount
  useEffect(
    () => () => {
      if (refreshTimerRef.current !== null) window.clearTimeout(refreshTimerRef.current);
    },
    [],
  );
  const applyTransformOrigin = (originEl?: HTMLElement | null): boolean =>
    placeQuotaPopupOrigin(
      popupRef.current,
      topbarRef.current ?? anchorRef.current,
      originEl ?? originRef.current ?? anchorRef.current ?? topbarRef.current,
    );
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- keeps the popup DOM node's transform-origin on the opening chip before the open transition paints
  useLayoutEffect(() => {
    if (!open) return;
    // The portal can mount (and get its width) a frame after `open` flips; retry briefly.
    let frame = 0;
    const retry = { left: 6 };
    const place = () => {
      const synced = placeQuotaPopupOrigin(
        popupRef.current,
        topbarRef.current ?? anchorRef.current,
        originRef.current ?? anchorRef.current ?? topbarRef.current,
      );
      if (!synced && retry.left > 0) {
        retry.left -= 1;
        frame = requestAnimationFrame(place);
      }
    };
    place();
    return () => cancelAnimationFrame(frame);
  }, [open]);
  const pins = quotaPins(preferences, accounts);
  const shown = quotaShownIds(preferences, accounts, current);
  const selected = shown.ids.flatMap((id) => accounts.find((a) => a.id === id) ?? []);
  const update = (patch: Partial<QuotaPreferences>) => onPreferences({ ...preferences, ...patch });
  const choose = (id: string, checked: boolean) => {
    if (checked && pins.length >= 4) {
      setFeedback(copy("Unpin an item before adding a fifth."));
      return;
    }
    setFeedback("");
    update({ pins: checked ? [...pins, id] : pins.filter((pin) => pin !== id), pinsEdited: true });
  };
  const move = (id: string, delta: number) => {
    const next = [...pins],
      index = next.indexOf(id),
      target = index + delta;
    if (index < 0 || target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target]!, next[index]!];
    update({ pins: next, pinsEdited: true });
  };
  const show = (id: string | null, from: HTMLElement | null) => {
    originRef.current = from;
    if (open && expanded === id) {
      applyTransformOrigin(from);
      setOpen(false);
      onOpenChange?.(false);
      return;
    }
    setView("overview");
    setExpanded(id);
    if (open) {
      applyTransformOrigin(from);
      return;
    }
    setOpen(true);
    onOpenChange?.(true);
    if (refreshTimerRef.current !== null) window.clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = window.setTimeout(() => {
      refreshTimerRef.current = null;
      onRefresh(true);
    }, QUOTA_OPEN_SETTLE_MS);
  };
  const title = copy("Quotas");
  const displayAccounts = view === "all" ? accounts : selected;
  const selectedWindows = selected.map((account) =>
    quotaWindow(account, preferences, quotaModelFor(account, current)),
  );
  const windowLabels = [
    ...new Set(selectedWindows.flatMap((window) => (window ? [windowName(window)] : []))),
  ];
  const sharedWindow = windowLabels.length === 1 ? windowLabels[0] : null;
  const remainingLabel = sharedWindow
    ? copy("{window} remaining", { window: sharedWindow })
    : copy("Remaining quota");
  return (
    <div
      ref={topbarRef}
      className={styles["quota-topbar"]}
      data-quota-topbar=""
      data-names={preferences.showNames}
      data-has-chips={selected.length > 0 || undefined}
    >
      <button
        type="button"
        className={styles["quota-summary"]}
        onClick={(event) => show(null, event.currentTarget)}
      >
        {remainingLabel}
      </button>
      <div className={styles["quota-chips"]}>
        {selected.map((account) => {
          const window = quotaWindow(account, preferences, quotaModelFor(account, current)),
            status = quotaState(account, window, now);
          const checkedAt = Date.parse(account.limits?.checkedAt ?? "");
          const readTime =
            status.state === "stale" && Number.isFinite(checkedAt)
              ? ` ${new Date(checkedAt).toLocaleTimeString(readUiLocale(), { hour: "2-digit", minute: "2-digit" })}`
              : "";
          // "unknown" means nothing readable at all; showing the failed check's time as an
          // expired reading misleads, so it reads as unavailable instead.
          const staleText =
            status.state === "unknown"
              ? copy("Temporarily unreadable")
              : status.state !== "current"
                ? copy("Readings expired · {time}", {
                    time: Number.isFinite(checkedAt)
                      ? new Date(checkedAt).toLocaleTimeString(readUiLocale(), {
                          hour: "2-digit",
                          minute: "2-digit",
                          hourCycle: "h23",
                        })
                      : copy("Unknown time"),
                  })
                : null;
          const label = copy("{provider} · {plan} · {window} · {state}{time} · {remaining}%", {
            provider: fullName(account),
            plan: quotaPlanLabel(account.alias),
            window: window ? windowName(window) : "",
            state: stateLabel(status.state),
            time: readTime,
            remaining: status.remaining === null ? "–" : status.remaining,
          });
          return (
            <Tooltip key={account.id}>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    className={styles["quota-chip"]}
                    data-quota-id={account.id}
                    data-current={account.id === shown.followedId || undefined}
                    data-low={
                      (status.state === "current" && (status.remaining ?? 100) <= 20) || undefined
                    }
                    data-stale={status.state !== "current" || undefined}
                    aria-label={label}
                    aria-expanded={open && expanded === account.id}
                    onPointerDown={(event) => {
                      if (open) event.stopPropagation();
                    }}
                    onClick={(event) => show(account.id, event.currentTarget)}
                  />
                }
              >
                <QuotaIcon
                  account={account}
                  remaining={status.remaining}
                  dim={status.state !== "current"}
                  compact
                />
                {preferences.showNames ? (
                  <span className={styles["quota-chip-name"]} data-quota-name="">
                    {account.title}
                  </span>
                ) : null}
                <span className={styles["quota-chip-value"]}>
                  {status.remaining === null ? "–" : `${status.remaining}%`}
                </span>
                {!sharedWindow && window ? (
                  <span className={styles["quota-chip-window"]}>{windowName(window, true)}</span>
                ) : null}
                {staleText ? (
                  <small className={styles["quota-stale-note"]}>{staleText}</small>
                ) : null}
                {status.state === "unknown" || status.state === "reset" ? (
                  <span className={styles["quota-chip-status"]}>{stateLabel(status.state)}</span>
                ) : null}
              </TooltipTrigger>
              <TooltipPopup side="bottom">{label}</TooltipPopup>
            </Tooltip>
          );
        })}
      </div>
      <Popover
        open={open}
        onOpenChange={(next, eventDetails) => {
          if (
            !next &&
            eventDetails.reason === "outside-press" &&
            eventDetails.event?.target instanceof Node &&
            topbarRef.current?.contains(eventDetails.event.target)
          ) {
            eventDetails.cancel();
            return;
          }
          if (!next) {
            applyTransformOrigin();
          }
          setOpen(next);
          onOpenChange?.(next);
          if (next) {
            setView("overview");
            setFeedback("");
            onRefresh(true);
          }
        }}
      >
        <PopoverTrigger
          render={
            <Button
              ref={anchorRef}
              variant="ghost-muted"
              size="icon"
              aria-label={copy("View quotas")}
              onClick={(event) => {
                originRef.current = event.currentTarget;
              }}
            />
          }
        >
          {pins.length ? <ChevronDownIcon /> : <GaugeIcon />}
        </PopoverTrigger>
        <PopoverPopup
          ref={popupRef}
          anchor={topbarRef}
          initialFocus={popupRef}
          sideOffset={8}
          data-usage-portal
          data-liquid-quota-popup=""
          align="end"
          width="lg"
          padding="default"
          keepMounted
          touchBackdrop
        >
          <div className={styles["quota-panel"]}>
            <div className={styles["quota-panel-heading"]}>
              {view !== "overview" ? (
                <Button
                  variant="ghost-muted"
                  size="icon-sm"
                  aria-label={copy("Back to quotas")}
                  onClick={() => {
                    setView("overview");
                    setFeedback("");
                  }}
                >
                  <ArrowLeftIcon />
                </Button>
              ) : null}
              <div className={styles["quota-heading-copy"]}>
                <PopoverTitle>
                  {view === "settings"
                    ? copy("Pinned quotas")
                    : view === "all"
                      ? copy("All quotas")
                      : title}
                </PopoverTitle>
                <p>
                  {view === "settings"
                    ? copy("Choose accounts, windows and order")
                    : copy("Remaining · resets")}
                </p>
              </div>
              {view === "settings" ? (
                <span className={styles["quota-counter"]}>{pins.length} / 4</span>
              ) : (
                <div className={styles["quota-heading-actions"]}>
                  <Button
                    variant="ghost-muted"
                    size="icon-sm"
                    disabled={refreshing}
                    aria-label={copy("Refresh quotas")}
                    onClick={() => onRefresh(false)}
                  >
                    <RefreshCwIcon />
                  </Button>
                  <button
                    type="button"
                    className={styles["quota-done-btn"]}
                    onClick={() => {
                      applyTransformOrigin();
                      setOpen(false);
                      onOpenChange?.(false);
                    }}
                  >
                    {copy("Finish setup")}
                  </button>
                </div>
              )}
            </div>
            {view === "settings" ? (
              <>
                <div className={styles["quota-list"]}>
                  {[...selected, ...accounts.filter((a) => !pins.includes(a.id))].map((account) => {
                    const checked = pins.includes(account.id),
                      index = pins.indexOf(account.id),
                      window = quotaWindow(account, preferences, quotaModelFor(account, current));
                    return (
                      <div className={styles["quota-pick"]} key={account.id}>
                        <Checkbox
                          id={`quota-pin-${account.id}`}
                          checked={checked}
                          onCheckedChange={(value) => choose(account.id, value)}
                        />
                        <div className={styles["quota-pick-content"]}>
                          <label htmlFor={`quota-pin-${account.id}`}>
                            <span className="sr-only">{copy("Pin ")}</span>
                            <QuotaIcon account={account} remaining={null} />
                            <span>
                              <NameTip account={account} />
                              <small>
                                {copy("Account ")}
                                {quotaPlanLabel(account.alias)}
                              </small>
                            </span>
                          </label>
                          {checked && account.limits?.windows.length ? (
                            <UsageSegments
                              aria-label={
                                copy("Quota window ") + account.title + " · " + account.alias
                              }
                              value={window ? [`${window.kind}:${window.id}`] : []}
                              onValueChange={(values) => {
                                if (values[0])
                                  update({
                                    windows: { ...preferences.windows, [account.id]: values[0] },
                                  });
                              }}
                            >
                              {account.limits.windows.map((w) => (
                                <Toggle
                                  key={`${w.kind}:${w.id}`}
                                  value={`${w.kind}:${w.id}`}
                                  aria-pressed={window === w}
                                >
                                  {windowName(w)} · {Math.round(100 - w.usedPercent)}%
                                </Toggle>
                              ))}
                            </UsageSegments>
                          ) : null}
                        </div>
                        {checked ? (
                          <div className={styles["quota-order"]}>
                            <Button
                              variant="ghost-muted"
                              size="icon-xs"
                              disabled={index === 0}
                              aria-label={copy("Move up ") + account.title + " · " + account.alias}
                              onClick={() => move(account.id, -1)}
                            >
                              <ArrowUpIcon />
                            </Button>
                            <Button
                              variant="ghost-muted"
                              size="icon-xs"
                              disabled={index === pins.length - 1}
                              aria-label={
                                copy("Move down ") + account.title + " · " + account.alias
                              }
                              onClick={() => move(account.id, 1)}
                            >
                              <ArrowDownIcon />
                            </Button>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                  {pins
                    .filter((id) => !accounts.some((a) => a.id === id))
                    .map((id) => (
                      <div className={styles["quota-missing"]} key={id}>
                        <span>{copy("Pinned account unavailable")}</span>
                        <Button variant="ghost-muted" size="xs" onClick={() => choose(id, false)}>
                          {copy("Unpin.")}
                        </Button>
                      </div>
                    ))}
                  {!accounts.length ? (
                    <p className={styles["quota-empty"]}>
                      {copy("Connect an environment to choose accounts.")}
                    </p>
                  ) : null}
                </div>
                <div className={styles["quota-name-setting"]}>
                  <label htmlFor="quota-show-names">{copy("Show provider names")}</label>
                  <Switch
                    id="quota-show-names"
                    size="sm"
                    checked={preferences.showNames}
                    onCheckedChange={(value) => update({ showNames: value })}
                  />
                </div>
                <div className={styles["quota-name-setting"]}>
                  <label htmlFor="quota-follow-session">
                    {copy("Follow the open thread's account")}
                  </label>
                  <Switch
                    id="quota-follow-session"
                    size="sm"
                    checked={preferences.followSession !== false}
                    onCheckedChange={(value) => update({ followSession: value })}
                  />
                </div>
                <div className={styles["quota-panel-footer"]}>
                  <span>{copy("Saved on this device")}</span>
                  <Button size="sm" onClick={() => setView("overview")}>
                    {copy("Finish setup")}
                  </Button>
                </div>
              </>
            ) : (
              <>
                <div className={styles["quota-list"]}>
                  {displayAccounts.map((account) => {
                    const window = quotaWindow(
                        account,
                        preferences,
                        quotaModelFor(account, current),
                      ),
                      status = quotaState(account, window, now);
                    const windows =
                      account.limits?.unavailable?.reason === "unsupported"
                        ? []
                        : account.limits?.windows.length
                          ? account.limits.windows
                          : window
                            ? [window]
                            : [];
                    const showRows = status.state !== "unknown" && windows.length > 0;
                    const note = !account.connected
                      ? copy("Offline · showing cached data")
                      : account.failed
                        ? copy("Probe failed; showing cached data")
                        : "";
                    return (
                      <div
                        className={styles["quota-account"]}
                        data-focused={expanded === account.id || undefined}
                        key={account.id}
                        role="group"
                        aria-label={copy("{provider} · {plan} quota", {
                          provider: fullName(account),
                          plan: quotaPlanLabel(account.alias),
                        })}
                      >
                        <div className={styles["quota-account-row"]}>
                          <QuotaIcon
                            account={account}
                            remaining={status.remaining}
                            dim={status.state !== "current"}
                          />
                          <span className={styles["quota-identity"]}>
                            <NameTip account={account} />
                            <small>
                              <span className={styles["quota-account-prefix"]}>
                                {copy("Account ")}
                              </span>
                              {quotaPlanLabel(account.alias)}
                            </small>
                          </span>
                          <span
                            className={styles["quota-numbers"]}
                            data-low={
                              (status.state === "current" && (status.remaining ?? 100) <= 20) ||
                              undefined
                            }
                          >
                            <strong>
                              {status.remaining === null
                                ? stateLabel(status.state)
                                : `${status.remaining}%`}
                            </strong>
                            {status.state === "stale" || status.state === "reset" || !showRows ? (
                              <small>
                                {status.state === "stale"
                                  ? copy("Cached.")
                                  : status.state === "reset"
                                    ? stateLabel(status.state)
                                    : account.limits?.unavailable?.reason === "unsupported"
                                      ? copy("No quota interface for this channel")
                                      : copy("No verified quota available")}
                              </small>
                            ) : null}
                          </span>
                        </div>
                        {showRows ? (
                          <div className={styles["quota-detail"]}>
                            {groupedWindows(windows).map(({ group, rows }) => (
                              <div className={styles["quota-group"]} key={group || "main"}>
                                {group ? (
                                  <p className={styles["quota-group-name"]}>{group}</p>
                                ) : null}
                                {rows.map(({ window: w, name }) => {
                                  const left = Math.max(
                                    0,
                                    Math.min(100, Math.round(100 - w.usedPercent)),
                                  );
                                  const reset = resetLabel(w, now, true);
                                  return (
                                    <div
                                      className={styles["quota-window"]}
                                      key={`${w.kind}:${w.id}`}
                                      data-quota-window
                                    >
                                      <span>{name}</span>
                                      <span className={styles["quota-track"]}>
                                        <i
                                          data-low={left <= 20 || undefined}
                                          style={{ width: `${left}%` }}
                                        />
                                      </span>
                                      <b>{left}%</b>
                                      <small className={styles["quota-window-reset"]}>
                                        {reset || copy("Not started")}
                                      </small>
                                    </div>
                                  );
                                })}
                              </div>
                            ))}
                            {note ? <p>{note}</p> : null}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                  {!displayAccounts.length ? (
                    <p className={styles["quota-empty"]}>
                      {accounts.length
                        ? copy("Choose pinned accounts in settings.")
                        : copy("No quota sources yet. Connect or refresh to check.")}
                    </p>
                  ) : null}
                </div>
                {latestStamp(displayAccounts) ? (
                  <p className={styles["quota-stamp"]}>
                    {copy("Updated ")}
                    {latestStamp(displayAccounts)}
                  </p>
                ) : null}
                <div className={styles["quota-panel-footer"]}>
                  <Button variant="ghost-muted" size="xs" onClick={() => setView("settings")}>
                    <SlidersHorizontalIcon />
                    {copy("Customize")}
                  </Button>
                  <Button
                    variant="ghost-muted"
                    size="xs"
                    onClick={() => setView(view === "all" ? "overview" : "all")}
                  >
                    {view === "all"
                      ? copy("Pinned.")
                      : copy("All {count} sources", { count: accounts.length })}
                  </Button>

                  <Button
                    variant="ghost-muted"
                    size="xs"
                    onClick={() => {
                      setOpen(false);
                      onUsage();
                    }}
                  >
                    {copy("Full usage and costs")}
                  </Button>
                </div>
              </>
            )}
            {feedback ? (
              <p className={styles["quota-feedback"]} role="status">
                {feedback}
              </p>
            ) : null}
          </div>
        </PopoverPopup>
      </Popover>
    </div>
  );
}
export function QuotaTopbar() {
  useLocale();
  const [selectAccounts] = useState(createQuotaAccountsSelector);
  const accounts = useAtomValue(
    environmentPresentations.presentationsWithProvidersAtom,
    selectAccounts,
  );
  const [preferences, setPreferences] = useLocalStorage(
    QUOTA_PREFERENCES_KEY,
    DEFAULT_QUOTA_PREFERENCES,
    QuotaPreferencesSchema,
  );
  const [now, setNow] = useState(() => Date.now());
  const [panelOpen, setPanelOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [failed, setFailed] = useState(false);
  const refreshProviders = useAtomCommand(serverEnvironment.refreshProviders, {
    reportFailure: false,
  });
  const navigate = useNavigate();
  const params = useParams({ strict: false });
  const routeThread = resolveThreadRouteRef(params);
  const threadShell = useQuietThreadShell(routeThread);
  const current = (() => {
    if (!routeThread || !threadShell) return null;
    const instanceId = resolveThreadProviderStack(threadShell).at(-1)!;
    // The selection names the model only for the instance it was made on.
    const model =
      threadShell.modelSelection.instanceId === instanceId
        ? threadShell.modelSelection.model
        : undefined;
    return { environmentId: routeThread.environmentId, instanceId, model };
  })();
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Maintain the visibility listener and minute timer that advance quota age labels.
  useEffect(() => {
    if (!panelOpen) return;
    // Only the age labels advance; the top bar never schedules provider probes.
    const advance = () => {
      if (!document.hidden) setNow(Date.now());
    };
    const timer = window.setInterval(advance, 60_000);
    document.addEventListener("visibilitychange", advance);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", advance);
    };
  }, [panelOpen]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Schedule only the next reading-expiry boundary while the native quota popup is closed.
  useEffect(() => {
    if (panelOpen) return;
    const time = Math.max(now, Date.now());
    const expiries = accounts
      .map((account) => Date.parse(account.limits?.checkedAt ?? "") + 600_001)
      .filter((at) => Number.isFinite(at) && at > time);
    if (!expiries.length) return;
    const timer = window.setTimeout(() => setNow(Date.now()), Math.min(...expiries) - time);
    return () => window.clearTimeout(timer);
  }, [accounts, panelOpen, now]);
  const refresh = async (automatic: boolean) => {
    if (refreshing) return;
    setRefreshing(true);
    setFailed(false);
    await (async () => {
      try {
        const results = await Promise.all(
          [...appAtomRegistry.get(environmentPresentations.presentationsWithProvidersAtom)].map(
            ([environmentId, p]) => {
              if (
                p.connection.phase !== "connected" ||
                !readEnvironmentScope(environmentId, AuthProvidersManageScope)
              )
                return;
              return refreshUsageLimits(
                environmentId,
                () => refreshProviders({ environmentId, input: {} }),
                automatic,
              );
            },
          ),
        );
        if (results.some((result) => result?._tag === "Failure")) setFailed(true);
      } catch {
        setFailed(true);
      }
    })().finally(() => {
      setNow(Date.now());
      setRefreshing(false);
    });
  };
  return (
    <div className={styles["quota-topbar-host"]}>
      <QuotaTopbarView
        onOpenChange={(value) => {
          setPanelOpen(value);
          if (value) setNow(Date.now());
        }}
        accounts={accounts}
        current={current}
        now={now}
        preferences={preferences}
        onPreferences={setPreferences}
        onRefresh={(automatic) => void refresh(automatic)}
        refreshing={refreshing}
        onUsage={() => void navigate({ to: "/usage" })}
      />
      {failed ? (
        <span className="sr-only" role="status">
          {copy("Quota refresh failed; keeping previous data.")}
        </span>
      ) : null}
    </div>
  );
}
