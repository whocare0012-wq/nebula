import { uiText as copy } from "~/i18n";
import { UsageSkeleton } from "./UsageLoadingLayout";
import { scopeUsageEnvironments, mergeUsageEnvironments, tokenPeriodTotals } from "./usageAnalysis";
import { MALFORMED_USAGE_WARNING_TEMPLATE } from "@t3tools/shared/usageFormat";
import { UsageRefreshButton } from "./UsageRefreshButton";
import { useTheme } from "../../hooks/useTheme";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import * as Schema from "effect/Schema";
import { previousUsageWindow } from "./usagePreviousWindow";
import { useUsageDateFormat } from "./useUsageDateFormat";
import { useUiText } from "~/i18n/useUiText";
import { UsageMotion } from "./UsageMotion";
import { usageReplayKey } from "./usageReplay";
import { usageTableHeaders } from "./usageMetricPresentation";
import { UsageTypeRows } from "./UsageTypeRows";
import { cacheInputRate, displayCostRows, reportedCostRows } from "./usagePresentation";

import { ChatGptUsageButton } from "../settings/ChatGptUsageButton";
import { usesChatGptSharing } from "@t3tools/shared/usageLimits";
import { RefreshIcon } from "~/components/ui/refresh-icon";
import { useAtomValue } from "@effect/atom-react";
import type { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { Atom } from "effect/reactivity";
import {
  USAGE_CONTRACT_VERSION,
  type EnvironmentId,
  type UsageProviderKind,
  type UsageSummaryInput,
} from "@t3tools/contracts";
import { CircleAlertIcon, ChevronDownIcon, InfoIcon, SlidersHorizontalIcon } from "lucide-react";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { settlePromise } from "@t3tools/client-runtime/state/runtime";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Cause from "effect/Cause";
import { refreshUsageLimits } from "@t3tools/client-runtime/state/usage";
import {
  updatingProvidersLabel,
  usageEnvironmentProgress,
  usageLoadingState,
} from "@t3tools/client-runtime/state/usage-progress";
import {
  isCompatibleUsageContractVersion,
  isModelCostUnknown,
  type DailyTotals,
  type HourlyTotals,
  type MergedUsage,
} from "@t3tools/shared/usageMerge";
import { cn } from "../../lib/utils";
import { usePrimarySettings } from "../../hooks/useSettings";
import { resolveHour12 } from "../../timestampFormat";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { environmentPresentations } from "../../state/presentation";
import { primaryServerKeybindingsAtom, serverEnvironment } from "../../state/server";
import { isCommandPaletteOpen } from "../../commandPaletteBus";
import { isModelPickerOpen } from "../../modelPickerVisibility";
import { shortcutLabelForCommand } from "../../keybindings";
import { useUsage, type EnvironmentUsageStatus } from "../../state/usage";
import { useAtomCommand } from "../../state/use-atom-command";
import {
  enumerateDays,
  enumerateHourStarts,
  formatCount,
  formatPercent,
  formatTokens,
  makeWindow,
  usageSourceMessages,
} from "@t3tools/shared/usageFormat";
import { formatUsd, UsageCurrencyControl, useUsageCurrencyKey } from "./usageMoney";
import { formatUsageContractMismatch } from "@t3tools/shared/usageFormatCopy";
import { Button, InlineButton } from "../ui/button";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import {
  Menu,
  MenuCheckboxItem,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";
import { ScrollArea } from "../ui/scroll-area";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";

import { Toggle } from "../ui/toggle-group";
import { UsageSegments as ToggleGroup } from "./UsageSegments";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import {
  WorkspaceBreadcrumb,
  WorkspaceBreadcrumbItem,
  WorkspaceBreadcrumbSeparator,
  WorkspaceBreadcrumbText,
} from "../WorkspaceBreadcrumb";
import { WorkspacePageContainer } from "../WorkspacePageContainer";
import { AppRouteModal, AppRouteModalClose } from "../AppRouteModal";
import { useServerConfigs } from "../../state/entities";
import { DiskSpaceSection } from "./DiskSpaceSection";
import { UsageLimitsSection } from "./UsageLimits";
import { UsagePriceOverrides } from "./UsagePriceOverrides";
import { UsageProviderChart } from "./UsageProviderChart";
import { V9CostDashboard, V9TokensDashboard, type V9PeriodOption } from "./UsageAppleOverview";
import { SpeedPremium, UsageModelDialog } from "./UsageModelDialog";
import { UsageShareBar } from "./UsageShareBar";
import {
  costTypeSegments,
  modelShare,
  sortModelsByTokens,
  speedCostSegments,
  tokenTypeSegments,
} from "./usageBreakdown";
import {
  METRIC_OPTIONS,
  WINDOW_OPTIONS,
  resolveUsageShortcut,
  type UsageMetric,
} from "./usageShortcuts";
import {
  PROVIDER_ORDER,
  PROVIDER_PRESENTATION,
  providersWithUsage,
  rankProvidersByMetric,
  usageSeries,
  usageSeriesLabel,
} from "./usageProviders";
import {
  readUsagePagePreferences,
  saveUsagePagePreferences,
  type UsagePagePreferences,
} from "./usagePagePreferences";

/** V9 cost chart style, remembered per device. */
const COST_CHART_STYLE = Schema.Literals(["bar", "area"]);
function isUsageMetric(value: string | null | undefined): value is UsageMetric {
  return METRIC_OPTIONS.some((option) => option.value === value);
}
function isUsageWindowDays(value: number): value is UsagePagePreferences["windowDays"] {
  return WINDOW_OPTIONS.some((option) => option.days === value);
}
const providerLabel = (provider: UsageProviderKind) => PROVIDER_PRESENTATION[provider].label;
function usageLoading(
  showingKept: boolean,
  selectedEnvironments: Parameters<typeof usageLoadingState>[0],
  refreshingUsage: boolean,
  hiddenProviders: ReadonlySet<UsageProviderKind>,
) {
  if (showingKept) {
    return { partial: true, everyProvider: true, providers: new Set<UsageProviderKind>() };
  }
  const state = usageLoadingState(selectedEnvironments, refreshingUsage);
  const providers = new Set([...state.providers].filter((p) => !hiddenProviders.has(p)));
  return {
    partial: state.everyProvider || providers.size > 0,
    everyProvider: state.everyProvider,
    providers,
  };
}
/** Keep dialog selection outside UsagePage so opening/closing rerenders only its host. */
const selectedUsageModelKeyAtom = Atom.make<string | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("usage:selected-model-key"),
);
function selectUsageModel(key: string | null): void {
  appAtomRegistry.set(selectedUsageModelKeyAtom, key);
}
function UsageModelDialogHost({
  models,
  onSetPrice,
  ...dialogProps
}: Omit<Parameters<typeof UsageModelDialog>[0], "model" | "onSetPrice" | "onClose"> & {
  readonly models: MergedUsage["models"];
  readonly onSetPrice: (model: string) => void;
}) {
  const selectedKey = useAtomValue(selectedUsageModelKeyAtom);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- clears the shared selected-model atom on unmount
  useEffect(() => () => selectUsageModel(null), []);
  const model =
    selectedKey === null
      ? undefined
      : models.find((candidate) => `${candidate.provider}:${candidate.model}` === selectedKey);
  if (model === undefined) return null;
  return (
    <UsageModelDialog
      {...dialogProps}
      model={model}
      onSetPrice={() => {
        selectUsageModel(null);
        onSetPrice(model.model);
      }}
      onClose={() => selectUsageModel(null)}
    />
  );
}
export function UsagePage() {
  const { theme } = useTheme();
  const uiText = useUiText();
  const { formatDateTimeShort, formatDayShort } = useUsageDateFormat();
  const [preferences, setPreferences] = useState(readUsagePagePreferences);
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const hour12 = usePrimarySettings((settings) => resolveHour12(settings.timestampFormat));
  // Storage cleanup exists on macOS and Windows servers; elsewhere this tab is just disk usage.
  const cleanupAvailable = [...useServerConfigs().values()].some(
    (config) =>
      config?.environment.platform.os === "darwin" || config?.environment.platform.os === "windows",
  );
  const optionLabel = (
    option: (typeof METRIC_OPTIONS)[number] | (typeof WINDOW_OPTIONS)[number],
  ): string =>
    "value" in option && option.value === "disk" && !cleanupAvailable
      ? uiText("Disk")
      : option.label;
  const shortcutTitle = (
    option: (typeof METRIC_OPTIONS)[number] | (typeof WINDOW_OPTIONS)[number],
  ) => {
    const shortcut = shortcutLabelForCommand(keybindings, option.command, {
      context: { usagePageOpen: true },
    });
    return shortcut ? `${optionLabel(option)} (${shortcut})` : optionLabel(option);
  };
  const [windowSelection, setWindowSelection] = useState(() => ({
    days: preferences.windowDays,
    window: makeWindow(
      preferences.windowDays,
      undefined,
      preferences.windowDays === 1 ? "hour" : "day",
    ),
  }));
  const metric = preferences.metric;
  const showingLimits = metric === "limits";
  const showingDisk = metric === "disk";
  // Cost helpers read the currency outside React, so a change remounts the page to reformat it.
  const currencyKey = useUsageCurrencyKey();
  const [motionTick, setMotionTick] = useState(0);
  const [diskRefreshTick, setDiskRefreshTick] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const diskPending = useRef(new Set<EnvironmentId>());
  const diskSettled = (id: EnvironmentId) => {
    diskPending.current.delete(id);
    if (!diskPending.current.size) {
      refreshingRef.current = false;
      setIsRefreshing(false);
    }
  };
  const [limitsNow, setLimitsNow] = useState(() => Date.now());
  const refreshingRef = useRef(false);
  const modalActionsRef = useRef<DialogPrimitive.Root.Actions | null>(null);
  const [priceDialog, setPriceDialog] = useState<{ readonly model?: string } | null>(null);
  const [selectedEnvironmentIds, setSelectedEnvironmentIds] =
    useState<ReadonlySet<EnvironmentId> | null>(null);
  const hiddenProviders = new Set(preferences.hiddenProviders);
  const { days: windowDays, window } = windowSelection;
  const isPast24Hours = windowDays === 1;
  const {
    merged: answeredUsage,
    environments,
    selectedEnvironments,
    shown,
    isPartial,
    refresh,
  } = useUsage(window, selectedEnvironmentIds, hiddenProviders);
  const merged = shown?.merged ?? answeredUsage;
  const shownWindow = shown?.window ?? window;
  const shownHourly = shownWindow.resolution === "hour";
  const refreshingUsage = isRefreshing && !showingLimits;
  const showingKept = shown !== null && shown.window !== window;
  const presentations = useAtomValue(environmentPresentations.presentationsAtom);
  const presentationsWithProviders = useAtomValue(
    environmentPresentations.presentationsWithProvidersAtom,
  );
  const refreshProviders = useAtomCommand(serverEnvironment.refreshProviders, {
    reportFailure: false,
  });
  const canReadDiagnostics = selectedEnvironments.some(
    (environment) => environment.canReadDiagnostics,
  );
  const updatePreferences = (patch: Partial<UsagePagePreferences>) => {
    const nextPreferences = { ...preferences, ...patch };
    setPreferences(nextPreferences);
    saveUsagePagePreferences(nextPreferences);
  };
  const selectWindow = (days: number) => {
    if (!isUsageWindowDays(days)) return;
    setMotionTick((t) => t + 1);
    updatePreferences({ windowDays: days });
    setWindowSelection({
      days,
      window: makeWindow(days, undefined, days === 1 ? "hour" : "day"),
    });
  };
  const selectMetric = (nextMetric: UsageMetric) => {
    setMotionTick((t) => t + 1);
    if (nextMetric === "limits") setLimitsNow(Date.now());
    updatePreferences({ metric: nextMetric });
  };
  const refreshLimits = (automatic = false) =>
    // Settled so the timestamp still advances when a refresh throws.
    settlePromise(() =>
      Promise.all(
        Array.from(presentations, ([environmentId, presentation]) => {
          if (selectedEnvironmentIds !== null && !selectedEnvironmentIds.has(environmentId)) return;
          if (presentation.connection.phase === "connected" && presentation.serverConfig !== null) {
            return refreshUsageLimits(
              environmentId,
              () => refreshProviders({ environmentId, input: {} }),
              automatic,
            );
          }
        }),
      ),
    ).then((result) => {
      setLimitsNow(Date.now());
      if (!AsyncResult.isSuccess(result)) throw Cause.squash(result.cause);
    });
  const onUsageKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (
      event.defaultPrevented ||
      event.repeat ||
      event.isComposing ||
      isCommandPaletteOpen() ||
      isModelPickerOpen()
    )
      return;
    const command = resolveUsageShortcut(event, keybindings);
    if (command === "usage.open") {
      event.preventDefault();
      event.stopPropagation();
      modalActionsRef.current?.close();
      return;
    }
    const metricOption = METRIC_OPTIONS.find((option) => option.command === command);
    const periodOption = WINDOW_OPTIONS.find((option) => option.command === command);
    if (!metricOption && !periodOption) return;
    event.preventDefault();
    event.stopPropagation();
    if (metricOption) selectMetric(metricOption.value);
    if (periodOption && !showingLimits) selectWindow(periodOption.days);
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- window capture keydown listener for usage metric, period, and close shortcuts
  useEffect(() => {
    globalThis.window.addEventListener("keydown", onUsageKeyDown, true);
    return () => globalThis.window.removeEventListener("keydown", onUsageKeyDown, true);
  }, []);
  const refreshWindow = () => {
    if (refreshingRef.current) return;
    if (showingDisk) {
      refreshingRef.current = true;
      setIsRefreshing(true);
      diskPending.current = new Set(selectedEnvironments.map((e) => e.environmentId));
      setDiskRefreshTick((tick) => tick + 1);
      return;
    }
    setMotionTick((t) => t + 1);
    if (showingLimits) {
      refreshingRef.current = true;
      setIsRefreshing(true);
      void refreshLimits().finally(() => {
        refreshingRef.current = false;
        setIsRefreshing(false);
      });
      return;
    }
    const nextWindow = makeWindow(windowDays, undefined, isPast24Hours ? "hour" : "day");
    if (
      nextWindow.sinceDay !== window.sinceDay ||
      nextWindow.untilDay !== window.untilDay ||
      nextWindow.sinceTime !== window.sinceTime ||
      nextWindow.untilTime !== window.untilTime
    ) {
      setWindowSelection({ days: windowDays, window: nextWindow });
    }
    refreshingRef.current = true;
    setIsRefreshing(true);
    void refresh(nextWindow).finally(() => {
      refreshingRef.current = false;
      setIsRefreshing(false);
    });
  };
  const connectedLimitsEnvironments = [...presentations]
    .filter(
      ([environmentId, presentation]) =>
        presentation.connection.phase === "connected" &&
        presentation.serverConfig !== null &&
        (selectedEnvironmentIds === null || selectedEnvironmentIds.has(environmentId)),
    )
    .map(([environmentId]) => environmentId)
    .sort()
    .join(",");
  const autoRefreshLimits = useEffectEvent(() => {
    void refreshLimits(true);
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- refreshes provider limits from the server when the connected environment set changes
  useEffect(() => {
    if (showingLimits && connectedLimitsEnvironments) autoRefreshLimits();
  }, [showingLimits, connectedLimitsEnvironments]);
  const days = enumerateDays(shownWindow.sinceDay, shownWindow.untilDay);
  const hours =
    shownWindow.sinceTime === undefined || shownWindow.untilTime === undefined
      ? []
      : enumerateHourStarts(shownWindow.sinceTime, shownWindow.untilTime);
  const showChatGptSharing =
    !hiddenProviders.has("codex") &&
    [...presentationsWithProviders].some(
      ([id, presentation]) =>
        (selectedEnvironmentIds === null || selectedEnvironmentIds.has(id)) &&
        (presentation.serverConfig?.providers ?? []).some(usesChatGptSharing),
    );
  const windowLabel =
    shownHourly && shownWindow.sinceTime !== undefined && shownWindow.untilTime !== undefined
      ? `${formatDateTimeShort(shownWindow.sinceTime, shownWindow.timeZone, hour12)} ${uiText("to")} ${formatDateTimeShort(shownWindow.untilTime, shownWindow.timeZone, hour12)}`
      : `${formatDayShort(shownWindow.sinceDay)} ${uiText("to")} ${formatDayShort(shownWindow.untilDay)}`;
  const topbarContent = (
    <div className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 py-2 @4xl/usage-header:flex">
      <WorkspaceBreadcrumb
        ariaLabel={copy("Usage breadcrumb")}
        className="usage-breadcrumb min-w-0"
      >
        <WorkspaceBreadcrumbItem>
          <h1>{uiText("Usage")}</h1>
        </WorkspaceBreadcrumbItem>
        <WorkspaceBreadcrumbSeparator />
        <WorkspaceBreadcrumbItem className="min-w-10 shrink">
          <UsageEnvironmentFilter
            environments={environments}
            selectedEnvironments={selectedEnvironments}
            selectedEnvironmentIds={selectedEnvironmentIds}
            onSelectionChange={setSelectedEnvironmentIds}
            showUsageStatus={!showingLimits && !showingDisk}
            refreshing={refreshingUsage}
            isPartial={isPartial}
            duplicateSources={merged.duplicateSources}
            contractMismatches={merged.contractMismatches}
            onOpenModelPrices={() => setPriceDialog({})}
          />
        </WorkspaceBreadcrumbItem>
        <WorkspaceBreadcrumbSeparator />
        <WorkspaceBreadcrumbItem current className="min-w-10">
          <UsageProviderFilter
            hiddenProviders={hiddenProviders}
            onChange={(next) => updatePreferences({ hiddenProviders: next })}
          />
        </WorkspaceBreadcrumbItem>
      </WorkspaceBreadcrumb>
      {!showingLimits && !showingDisk ? (
        <span className="hidden min-w-0 truncate text-xs text-muted-foreground @7xl/usage-header:block">
          {windowLabel}
        </span>
      ) : null}
      <div className="ms-auto hidden shrink-0 items-center justify-end gap-2 @4xl/usage-header:flex">
        {/* Limits are always current, so they have no period. The period sits before the metric
            tabs so dropping it never moves them. */}
        {showingLimits || showingDisk || theme === "apple" ? null : (
          <ToggleGroup
            aria-label={uiText("Usage period")}
            variant="segmented"
            value={[String(windowDays)]}
            onValueChange={(next) => {
              const value = next[0];
              if (value) selectWindow(Number(value));
            }}
          >
            {WINDOW_OPTIONS.map((option) => (
              <Toggle
                key={option.days}
                value={String(option.days)}
                aria-description={shortcutTitle(option)}
              >
                {option.label}
              </Toggle>
            ))}
          </ToggleGroup>
        )}
        {showingLimits || showingDisk ? null : <UsageCurrencyControl />}
        <ToggleGroup
          aria-label={uiText("Usage metric")}
          variant="segmented"
          value={[metric]}
          onValueChange={(next) => {
            const value = next[0];
            if (isUsageMetric(value)) selectMetric(value);
          }}
        >
          {METRIC_OPTIONS.map((option) => (
            <Toggle
              key={option.value}
              value={option.value}
              aria-description={shortcutTitle(option)}
            >
              {optionLabel(option)}
            </Toggle>
          ))}
        </ToggleGroup>
        {theme === "apple" ? (
          <UsageRefreshButton
            iconOnly
            busy={isRefreshing}
            disabled={isRefreshing || (!showingLimits && !canReadDiagnostics)}
            onClick={refreshWindow}
            label={showingLimits ? uiText("Refresh limits") : uiText("Refresh usage")}
          />
        ) : (
          <Button
            onClick={refreshWindow}
            aria-label={showingLimits ? uiText("Refresh limits") : uiText("Refresh usage")}
            aria-busy={isRefreshing}
            disabled={isRefreshing || (!showingLimits && !canReadDiagnostics)}
            size="icon-sm"
            variant="ghost"
          >
            <span key={motionTick} data-usage-refresh>
              <RefreshIcon size="sm" refreshing={false} />
            </span>
          </Button>
        )}
      </div>
      <div className="ms-auto flex shrink-0 items-center justify-end gap-1 @4xl/usage-header:hidden">
        {showingLimits || showingDisk ? null : (
          <Select value={String(windowDays)} onValueChange={(value) => selectWindow(Number(value))}>
            <SelectTrigger
              aria-label={uiText("Usage period")}
              size="compact"
              variant="ghost"
              className="w-auto min-w-0"
            >
              <SelectValue>
                {WINDOW_OPTIONS.find((option) => option.days === windowDays)?.label}
              </SelectValue>
            </SelectTrigger>
            <SelectPopup data-usage-portal align="end" alignItemWithTrigger={false}>
              {WINDOW_OPTIONS.map((option) => (
                <SelectItem
                  key={option.days}
                  value={String(option.days)}
                  aria-description={shortcutTitle(option)}
                >
                  {option.label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        )}
        {showingLimits || showingDisk ? null : <UsageCurrencyControl />}
        <Select
          value={metric}
          onValueChange={(value) => {
            if (isUsageMetric(value)) selectMetric(value);
          }}
        >
          <SelectTrigger
            aria-label={uiText("Usage metric")}
            size="compact"
            variant="ghost"
            className="w-auto min-w-0"
          >
            <SelectValue>
              {optionLabel(METRIC_OPTIONS.find((option) => option.value === metric)!)}
            </SelectValue>
          </SelectTrigger>
          <SelectPopup data-usage-portal align="end" alignItemWithTrigger={false}>
            {METRIC_OPTIONS.map((option) => (
              <SelectItem
                key={option.value}
                value={option.value}
                aria-description={shortcutTitle(option)}
              >
                {optionLabel(option)}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
        {theme === "apple" ? (
          <UsageRefreshButton
            busy={isRefreshing}
            disabled={isRefreshing || (!showingLimits && !canReadDiagnostics)}
            onClick={refreshWindow}
            label={showingLimits ? uiText("Refresh limits") : uiText("Refresh usage")}
          />
        ) : (
          <Button
            onClick={refreshWindow}
            aria-label={showingLimits ? uiText("Refresh limits") : uiText("Refresh usage")}
            aria-busy={isRefreshing}
            disabled={isRefreshing || (!showingLimits && !canReadDiagnostics)}
            size="icon-sm"
            variant="ghost"
          >
            <span key={motionTick} data-usage-refresh>
              <RefreshIcon size="sm" refreshing={false} />
            </span>
          </Button>
        )}
      </div>
    </div>
  );
  return (
    <AppRouteModal label={uiText("Usage")} actionsRef={modalActionsRef}>
      <div
        data-usage-page
        className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground"
      >
        <header className="@container/usage-header flex min-h-12 shrink-0 items-center gap-1 border-b ps-5 pe-2">
          {topbarContent}
          {isRefreshing || showingKept || (shown !== null && isPartial) ? (
            <span className="usage-updating" role="status">
              {uiText("Updating")}
            </span>
          ) : null}
          <AppRouteModalClose />
        </header>
        <ScrollArea className="min-h-0 flex-1" observeContent>
          <WorkspacePageContainer
            key={currencyKey}
            width="wide"
            data-slot="workspace-page-container"
          >
            <UsageMotion
              replay={usageReplayKey(metric, 0)}
              dataKey={`${shownWindow.sinceDay}:${shownWindow.untilDay}:${shownWindow.sinceTime ?? ""}`}
            >
              {selectedEnvironments.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {environments.length === 0
                    ? uiText("Connect an environment to see {0}.", {
                        "0": showingLimits ? "limits" : "usage",
                      })
                    : uiText("Select an environment to see {0}.", {
                        "0": showingLimits ? "limits" : "usage",
                      })}
                </p>
              ) : showingLimits ? (
                <UsageLimitsSection
                  selectedEnvironmentIds={selectedEnvironmentIds}
                  hiddenProviders={hiddenProviders}
                  now={limitsNow}
                />
              ) : showingDisk ? (
                <DiskSpaceSection
                  environments={selectedEnvironments}
                  refreshTick={diskRefreshTick}
                  onSettled={diskSettled}
                />
              ) : shown === null ? (
                <UsageSkeleton />
              ) : !canReadDiagnostics ? (
                <div className="space-y-2 py-12 text-center text-sm text-muted-foreground">
                  {selectedEnvironments.map((environment) => (
                    <p key={environment.environmentId}>
                      {selectedEnvironments.length > 1 ? `${environment.label}: ` : null}
                      {environment.error}
                    </p>
                  ))}
                </div>
              ) : (
                <UsageOverview
                  key={metric}
                  onSetPrice={(model) => setPriceDialog({ model })}
                  merged={merged}
                  shownWindow={shownWindow}
                  hour12={hour12}
                  days={days}
                  hours={hours}
                  showingKept={showingKept}
                  metric={metric === "tokens" ? "tokens" : "cost"}
                  selectedEnvironments={selectedEnvironments}
                  hiddenProviders={hiddenProviders}
                  refreshingUsage={refreshingUsage}
                  showChatGptSharing={showChatGptSharing}
                  onSelectModel={selectUsageModel}
                  windowDays={windowDays}
                  onSelectWindow={selectWindow}
                  periodOptions={WINDOW_OPTIONS.map((option) => ({
                    days: option.days,
                    label: option.days === 1 ? copy("24 hours") : option.label,
                    title: shortcutTitle(option),
                  }))}
                />
              )}
            </UsageMotion>
          </WorkspacePageContainer>
        </ScrollArea>
      </div>
      {showingLimits || showingDisk || theme === "apple" ? null : (
        <UsageModelDialogHost
          models={merged.models}
          environments={selectedEnvironments}
          metric={metric === "tokens" ? "tokens" : "cost"}
          chartWindow={{
            days,
            hours,
            resolution: shownHourly ? "hour" : "day",
            timeZone: shownWindow.timeZone,
            referenceTime: shownWindow.untilTime,
            hour12,
          }}
          onSetPrice={(model) => setPriceDialog({ model })}
        />
      )}
      {priceDialog ? (
        <UsagePriceOverrides
          usage={environments}
          initialSelectedEnvironmentIds={selectedEnvironmentIds}
          initialModel={priceDialog.model}
          onOpenChange={(open) => {
            if (!open) setPriceDialog(null);
          }}
        />
      ) : null}
    </AppRouteModal>
  );
}
function UsageOverview({
  merged,
  shownWindow,
  hour12,
  days,
  hours,
  showingKept,
  metric,
  selectedEnvironments,
  hiddenProviders,
  refreshingUsage,
  showChatGptSharing,
  onSelectModel,
  windowDays,
  onSelectWindow,
  periodOptions,
  onSetPrice,
}: {
  readonly onSetPrice: (model: string) => void;
  readonly windowDays: number;
  readonly onSelectWindow: (days: number) => void;
  readonly periodOptions: readonly V9PeriodOption[];
  readonly merged: MergedUsage;
  readonly shownWindow: UsageSummaryInput;
  readonly hour12: boolean;
  readonly days: readonly string[];
  readonly hours: readonly string[];
  readonly showingKept: boolean;
  readonly metric: "tokens" | "cost";
  readonly selectedEnvironments: readonly EnvironmentUsageStatus[];
  readonly hiddenProviders: ReadonlySet<UsageProviderKind>;
  readonly refreshingUsage: boolean;
  readonly showChatGptSharing: boolean;
  readonly onSelectModel: (key: string) => void;
}) {
  const uiText = useUiText();
  const { theme } = useTheme();
  const apple = theme === "apple";
  const { formatDayShort, formatHourShort } = useUsageDateFormat();
  const [selectedProvider, setSelectedProvider] = useState<UsageProviderKind | null>(null);
  const [selectedHour, setSelectedHour] = useState<string | null>(null);
  // A picked day or hour belongs to the period it was picked in; drop it when another period is shown.
  const periodKey = `${shownWindow.sinceDay}:${shownWindow.untilDay}:${shownWindow.sinceTime ?? ""}`;
  const [selectionPeriod, setSelectionPeriod] = useState(periodKey);
  if (selectionPeriod !== periodKey) {
    setSelectionPeriod(periodKey);
    setSelectedHour(null);
  }
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  // V9 cost page: bar (default) or area chart, remembered per device.
  const [costChartStyle, setCostChartStyle] = useLocalStorage(
    "t3.usage.costChartStyle",
    "bar",
    COST_CHART_STYLE,
  );
  const [breakdown, setBreakdown] = useState<"model" | "project" | "time">("model");
  const shownHourly = shownWindow.resolution === "hour";
  const loading = usageLoading(showingKept, selectedEnvironments, refreshingUsage, hiddenProviders);
  // Copy the primitive; JSX reads of loading.partial would merge all derivations into one compiler cache
  // scope.
  const loadingPartial = loading.partial === true;
  const loadingProviders = new Set(
    PROVIDER_ORDER.filter((provider) => loading.everyProvider || loading.providers.has(provider)),
  );
  const providersWithData = new Set(providersWithUsage(merged.providers));
  // Only loading.providers excludes hidden providers without data. Filter a fresh array so the compiler can
  // cache independently.
  const activeProviders = [
    ...new Set(
      PROVIDER_ORDER.filter(
        (provider) => providersWithData.has(provider) || loading.providers.has(provider),
      ).map(usageSeries),
    ),
  ];
  const chartLoadingProviders = new Set(
    activeProviders.filter((provider) => loadingProviders.has(provider)),
  );
  const sourceMessages = usageSourceMessages(
    selectedEnvironments.flatMap(
      (environment) =>
        environment.summary?.sources.filter(
          (source) => !hiddenProviders.has(source.fingerprint.provider),
        ) ?? [],
    ),
  );
  const breakdownPeriods: readonly (DailyTotals | HourlyTotals)[] = (
    shownHourly ? merged.hourly : merged.daily
  ).toReversed();
  const breakdownModels =
    breakdown === "model" && metric === "tokens"
      ? sortModelsByTokens(merged.models)
      : merged.models;
  const breakdownPeak = breakdownModels.reduce(
    (peak, model) => Math.max(peak, metric === "tokens" ? model.totalTokens : model.costUsd),
    0,
  );
  const rankedProviders = rankProvidersByMetric(activeProviders, merged.providers, metric);
  const reported = reportedCostRows(selectedEnvironments, hiddenProviders);
  const breakdownProjects =
    metric === "tokens"
      ? merged.projects.toSorted(
          (left, right) => right.totalTokens - left.totalTokens || right.costUsd - left.costUsd,
        )
      : merged.projects;
  const projectPeak = breakdownProjects.reduce(
    (peak, project) => Math.max(peak, metric === "tokens" ? project.totalTokens : project.costUsd),
    0,
  );

  const ids = new Set(selectedEnvironments.map((e) => e.environmentId));
  const prior = useUsage(previousUsageWindow(shownWindow), ids, hiddenProviders);
  const complete =
    !loadingPartial &&
    !prior.isPartial &&
    !prior.isPending &&
    prior.selectedEnvironments.length === ids.size &&
    prior.selectedEnvironments.every((e) => e.summary !== null && !e.error && !e.isPending);
  const previous = complete ? prior.merged : undefined;

  const providerColors = Object.fromEntries(
    rankedProviders.map((provider, index) => [
      `--usage-${provider}`,
      `color-mix(in srgb, var(--primary) ${[100, 72, 46, 24][Math.min(index, 3)]}%, var(--card))`,
    ]),
  );
  if (apple) {
    const scopedEnvironments = scopeUsageEnvironments(
      selectedEnvironments,
      hiddenProviders,
      selectedProvider,
    );
    const filtered =
      selectedProvider === null ? merged : mergeUsageEnvironments(scopedEnvironments);
    const detailEnvironments =
      selectedHour === null
        ? scopedEnvironments
        : shownHourly
          ? scopeUsageEnvironments(scopedEnvironments, new Set(), null, selectedHour)
          : scopedEnvironments.map((environment) => {
              if (!environment.summary) return environment;
              const { projectTotals: _ignored, ...summary } = environment.summary;
              return {
                ...environment,
                summary: {
                  ...summary,
                  buckets: summary.buckets.filter((bucket) => bucket.day === selectedHour),
                },
              };
            });
    const detailUsage =
      selectedHour === null ? filtered : mergeUsageEnvironments(detailEnvironments);
    const selected = detailUsage.models.find(
      (model) => `${model.provider}:${model.model}` === selectedModel,
    );
    const periods = shownHourly ? hours : days;
    const tokenTotals =
      metric === "tokens" ? tokenPeriodTotals(scopedEnvironments, periods, shownHourly) : [];
    const formatPeriod = (period: string) =>
      shownHourly ? formatHourShort(period, shownWindow.timeZone, hour12) : formatDayShort(period);
    return (
      <div
        data-usage-overview
        data-apple-dashboard
        data-updating={loadingPartial || undefined}
        style={providerColors}
        aria-busy={loadingPartial}
      >
        {metric === "cost" ? (
          <V9CostDashboard
            merged={merged}
            previous={previous}
            selectedEnvironments={selectedEnvironments}
            priorEnvironments={prior.selectedEnvironments}
            environmentIds={ids}
            hiddenProviders={hiddenProviders}
            rankedProviders={rankedProviders}
            shownWindow={shownWindow}
            periods={periods}
            hourly={shownHourly}
            formatPeriod={formatPeriod}
            windowDays={windowDays}
            periodOptions={periodOptions}
            onSelectWindow={onSelectWindow}
            chartStyle={costChartStyle}
            onChangeChartStyle={setCostChartStyle}
            selectedProvider={selectedProvider}
            onSelectProvider={(provider) => {
              setSelectedProvider(provider);
              setSelectedHour(null);
            }}
            selectedPeriod={selectedHour}
            onSelectPeriod={setSelectedHour}
            onSelectModel={setSelectedModel}
            chatGptAction={showChatGptSharing ? <ChatGptUsageButton size="xs" /> : undefined}
            loading={loadingPartial}
          />
        ) : (
          <V9TokensDashboard
            merged={merged}
            selectedEnvironments={selectedEnvironments}
            environmentIds={ids}
            hiddenProviders={hiddenProviders}
            rankedProviders={rankedProviders}
            periods={periods}
            periodTotals={tokenTotals}
            hourly={shownHourly}
            formatPeriod={formatPeriod}
            windowDays={windowDays}
            periodOptions={periodOptions}
            onSelectWindow={onSelectWindow}
            selectedProvider={selectedProvider}
            onSelectProvider={(provider) => {
              setSelectedProvider(provider);
              setSelectedHour(null);
            }}
            selectedPeriod={selectedHour}
            onSelectPeriod={setSelectedHour}
            onSelectModel={setSelectedModel}
            loading={loadingPartial}
          />
        )}
        {selected ? (
          <UsageModelDialog
            model={selected}
            environments={detailEnvironments}
            metric={metric}
            chartWindow={{
              days,
              hours: selectedHour ? [selectedHour] : hours,
              resolution: shownHourly ? "hour" : "day",
              timeZone: shownWindow.timeZone,
              referenceTime: shownWindow.untilTime,
              hour12,
              periodLabel: selectedHour
                ? formatPeriod(selectedHour)
                : shownHourly
                  ? copy("Last 24 hours")
                  : copy("Last {count} days", { count: days.length }),
            }}
            onClose={() => setSelectedModel(null)}
            onSetPrice={() => {
              setSelectedModel(null);
              onSetPrice(selected.model);
            }}
          />
        ) : null}
        {sourceMessages
          .filter(
            (message) =>
              !/cursor/i.test(message) ||
              merged.providers.some(
                (p) => p.provider === "cursor" && (p.records > 0 || p.sessions > 0),
              ),
          )
          .map((message) => (
            <p key={message} className="usage-info-banner">
              {usageDiagnosticText(message, uiText)}
            </p>
          ))}
      </div>
    );
  }
  return (
    <div
      data-usage-overview
      aria-busy={loadingPartial}
      className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,330px)_minmax(0,1fr)]"
    >
      {sourceMessages.map((message) => (
        <p key={message} className="text-sm text-muted-foreground lg:col-span-2">
          {usageDiagnosticText(message, uiText)}
        </p>
      ))}
      <section
        data-usage-main-row
        className="grid gap-3 lg:col-span-2 lg:grid-cols-[minmax(0,300px)_minmax(0,1fr)]"
      >
        <div data-usage-card data-usage-provider-card className="flex min-w-0 flex-col gap-4">
          <div data-usage-legacy-heading className="flex flex-col gap-1">
            <p
              className={cn(
                "text-4xl font-semibold text-foreground tabular-nums",
                figureClass(loadingPartial),
              )}
            >
              {metric === "cost" ? formatUsd(merged.costUsd) : formatTokens(merged.totalTokens)}
            </p>
            <p className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <span>
                <span className={figureClass(loadingPartial)}>
                  {uiText("{count} sessions", { count: formatCount(merged.sessions) })}
                </span>
              </span>
              {metric === "cost" && merged.costQuality.unpricedShare > 0 && (
                <Popover>
                  <PopoverTrigger
                    openOnHover
                    render={<InlineButton tone="muted" />}
                    aria-label="Unpriced usage details"
                  >
                    <InfoIcon className="size-3" aria-hidden />
                  </PopoverTrigger>
                  <PopoverPopup data-usage-portal side="top" tooltipStyle>
                    {uiText("Estimate excludes {share} of unpriced records.", {
                      share: formatPercent(merged.costQuality.unpricedShare),
                    })}
                  </PopoverPopup>
                </Popover>
              )}
            </p>
            {metric === "cost" ? (
              <>
                <span className="mt-1 w-fit rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
                  {uiText("Estimated at API list prices")}
                </span>
                <p className="text-2xs leading-relaxed text-muted-foreground">
                  {uiText(
                    "Not an actual bill · Subscription users should refer to provider invoices",
                  )}
                </p>
              </>
            ) : null}
          </div>

          {showChatGptSharing ? (
            <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>{uiText("ChatGPT shared usage")}</span>
              <ChatGptUsageButton size="xs" />
            </div>
          ) : null}

          {apple ? <h2 className="usage-card-title">{copy("By provider")}</h2> : null}
          <div
            data-spread={rankedProviders.length >= 4 || undefined}
            className={apple ? "usage-provider-list" : "contents"}
          >
            {rankedProviders.map((provider) => {
              const totals = merged.providers
                .filter((entry) => usageSeries(entry.provider) === provider)
                .reduce(
                  (sum, entry) => ({
                    costUsd: sum.costUsd + entry.costUsd,
                    totalTokens: sum.totalTokens + entry.totalTokens,
                    sessions: sum.sessions + entry.sessions,
                    costShare: sum.costShare + entry.costShare,
                    tokenShare: sum.tokenShare + entry.tokenShare,
                  }),
                  { costUsd: 0, totalTokens: 0, sessions: 0, costShare: 0, tokenShare: 0 },
                );
              const share =
                metric === "cost" ? (totals?.costShare ?? 0) : (totals?.tokenShare ?? 0);
              const providerSessions = totals?.sessions ?? 0;
              const sessionLabel = uiText("{count} sessions", {
                count: formatCount(providerSessions),
              });
              const providerLoading = loadingProviders.has(provider);
              const awaitingData = providerLoading && !providersWithData.has(provider);
              return (
                <div key={provider} data-provider-row className="flex flex-col gap-1">
                  <dl className="flex items-baseline justify-between gap-4">
                    <dt className="flex min-w-0 items-center gap-2 text-sm text-foreground">
                      <span
                        aria-hidden
                        className="size-2 shrink-0 rounded-full"
                        style={{
                          backgroundColor: PROVIDER_PRESENTATION[provider].color,
                        }}
                      />
                      <span className="flex min-w-0 items-baseline gap-1.5">
                        <span className="truncate">{usageSeriesLabel(provider)}</span>
                        <span
                          className={cn(
                            "shrink-0 whitespace-nowrap text-2xs text-muted-foreground tabular-nums",
                            figureClass(providerLoading),
                            awaitingData && "invisible",
                          )}
                        >
                          {sessionLabel}
                        </span>
                      </span>
                    </dt>
                    <dd
                      className={cn(
                        "shrink-0 text-sm font-medium text-foreground tabular-nums",
                        figureClass(providerLoading),
                      )}
                    >
                      {awaitingData
                        ? "-"
                        : metric === "cost"
                          ? formatUsd(totals?.costUsd ?? 0)
                          : formatTokens(totals?.totalTokens ?? 0)}
                    </dd>
                  </dl>
                  <p
                    className={cn(
                      "text-xs text-muted-foreground",
                      figureClass(providerLoading),
                      awaitingData && "invisible",
                    )}
                  >
                    {metric === "cost"
                      ? uiText("{share} of cost · {tokens} tokens", {
                          share: formatPercent(share),
                          tokens: formatTokens(totals?.totalTokens ?? 0),
                        })
                      : uiText("{share} of tokens · {cost}", {
                          share: formatPercent(share),
                          cost: formatUsd(totals?.costUsd ?? 0),
                        })}
                  </p>
                  {apple ? (
                    <div className="usage-provider-track">
                      <span
                        style={{
                          width: `${Math.max(0, Math.min(1, share)) * 100}%`,
                          background: PROVIDER_PRESENTATION[provider].color,
                        }}
                      />
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>

        <div data-usage-card data-usage-chart-card className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-medium text-foreground">
              {uiText(
                shownHourly
                  ? metric === "tokens"
                    ? "Hourly processed tokens"
                    : "Hourly cost"
                  : metric === "tokens"
                    ? "Daily processed tokens"
                    : "Daily cost",
              )}
            </h2>
            <div
              className="flex flex-wrap gap-3 text-2xs text-muted-foreground"
              aria-label={uiText("Providers")}
            >
              {(apple
                ? rankedProviders
                : (["codex", "claude", "grok", "antigravity"] as const)
              ).map((provider) => (
                <span key={provider} className="inline-flex items-center gap-1.5">
                  <span
                    className="size-1.5 rounded-full"
                    style={{ background: PROVIDER_PRESENTATION[provider].color }}
                  />
                  {PROVIDER_PRESENTATION[provider].label}
                </span>
              ))}
            </div>
          </div>
          <UsageProviderChart
            previous={apple ? previous : undefined}
            previousWindow={previousUsageWindow(shownWindow)}
            providers={activeProviders}
            loadingProviders={chartLoadingProviders}
            days={days}
            daily={merged.daily}
            hours={hours}
            hourly={merged.hourly}
            metric={metric}
            referenceTime={shownWindow.untilTime}
            resolution={shownHourly ? "hour" : "day"}
            timeZone={shownWindow.timeZone}
            hour12={hour12}
          />
        </div>
      </section>

      <section
        data-usage-card
        data-usage-legacy-totals
        className="flex min-w-0 flex-col gap-2 lg:col-span-2"
      >
        <h2 className="text-sm font-medium text-foreground">{uiText("Totals")}</h2>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 py-1 md:grid-cols-6">
          <Metric
            loading={loadingPartial}
            label={uiText("Processed tokens")}
            value={formatTokens(merged.totalTokens)}
          />
          <Metric
            loading={loadingPartial}
            label={uiText("Cached input")}
            value={formatTokens(merged.cachedInputTokens)}
          />
          <Metric
            loading={loadingPartial}
            label={uiText("Cache write")}
            value={formatTokens(merged.cacheCreationTokens)}
          />
          <Metric
            loading={loadingPartial}
            label={uiText("Uncached input")}
            value={formatTokens(merged.uncachedInputTokens)}
          />
          <Metric
            loading={loadingPartial}
            label={uiText("Output")}
            value={formatTokens(merged.outputTokens)}
          />
          <Metric
            loading={loadingPartial}
            label={uiText("Cache saved you")}
            note={uiText("Extra list-price cost without caching")}
            value={formatUsd(merged.costQuality.cacheSavingsUsd)}
          />
        </dl>
      </section>

      {merged.totalTokens > 0 ? (
        <section
          data-usage-card
          className={cn("flex flex-col gap-5 self-start", figureClass(loadingPartial))}
        >
          {apple ? (
            <>
              <UsageShareBar
                label={metric === "cost" ? copy("Cost breakdown") : copy("Token breakdown")}
                segments={(metric === "cost"
                  ? costTypeSegments(merged.categoryCost)
                  : tokenTypeSegments(merged)
                ).map((row, i) => ({
                  ...row,
                  color: `color-mix(in srgb, var(--primary) ${[100, 72, 46, 24][Math.min(i, 3)]}%, var(--card))`,
                }))}
                format={metric === "cost" ? formatUsd : formatTokens}
              />
              <div className="usage-cache-saving">
                <span>{copy("Saved by caching")}</span>
                <strong>{formatUsd(merged.costQuality.cacheSavingsUsd)}</strong>
                <p>{copy("Estimate based on public prices for these records")}</p>
              </div>
            </>
          ) : metric === "tokens" ? (
            <UsageTypeRows
              label={uiText("Tokens by type")}
              hitRate={cacheInputRate(merged)}
              rows={tokenTypeSegments(merged)}
              format={formatTokens}
            />
          ) : (
            <>
              <UsageTypeRows
                label={uiText("Cost by type")}
                rows={displayCostRows(merged.categoryCost, showingKept ? [] : reported)}
                format={formatUsd}
              />
              {merged.speedCost.fast + merged.speedCost.ultrafast > 0 ? (
                <UsageShareBar
                  label={uiText("Cost by speed")}
                  segments={speedCostSegments(merged.speedCost)}
                  format={formatUsd}
                  aside={<SpeedPremium premiumUsd={merged.speedCost.premium} />}
                />
              ) : null}
            </>
          )}
        </section>
      ) : null}
      <section data-usage-card className="flex min-w-0 flex-col gap-3 overflow-x-auto">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-medium text-foreground">
            {apple ? copy("By model") : uiText("Breakdown")}
          </h2>
          {!apple ? (
            <ToggleGroup
              aria-label={uiText("Usage breakdown")}
              variant="segmented"
              value={[breakdown]}
              onValueChange={(next) => {
                const value = next[0];
                if (value === "model" || value === "project" || value === "time") {
                  setBreakdown(value);
                }
              }}
            >
              {(
                [
                  { value: "model", label: uiText("Model") },
                  { value: "project", label: uiText("Project") },
                  { value: "time", label: shownHourly ? uiText("Hour") : uiText("Day") },
                ] as const
              ).map((option) => (
                <Toggle key={option.value} value={option.value}>
                  {option.label}
                </Toggle>
              ))}
            </ToggleGroup>
          ) : null}
        </div>

        {apple || breakdown === "model" ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-right text-xs text-muted-foreground">
                <th className="py-2 pr-3 pl-2 text-left font-normal">#</th>
                <th className="w-full py-2 text-left font-normal">{uiText("Model")}</th>
                <th className="py-2 pl-6 font-normal">{usageTableHeaders(metric).primary}</th>
                <th className="hidden py-2 pl-6 font-normal sm:table-cell">{uiText("Share")}</th>
                <th className="py-2 pr-2 pl-6 font-normal">
                  {usageTableHeaders(metric).secondary}
                </th>
              </tr>
            </thead>
            <tbody>
              {breakdownModels.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-muted-foreground">
                    {uiText("No activity in this window.")}
                  </td>
                </tr>
              ) : (
                breakdownModels.map((model, index) => {
                  const key = `${model.provider}:${model.model}`;
                  const value = metric === "tokens" ? model.totalTokens : model.costUsd;
                  const hasBar = value > 0 && breakdownPeak > 0;
                  const share = modelShare(model, metric === "tokens" ? "tokens" : "cost");
                  const rowFigures = figureClass(loadingProviders.has(model.provider));
                  return (
                    <tr
                      key={key}
                      className="relative border-b border-border/50 text-right whitespace-nowrap text-muted-foreground tabular-nums transition-colors hover:bg-muted/50 has-focus-visible:bg-muted/50"
                    >
                      <td className="py-2.5 pr-3 pl-2 text-left text-xs">{index + 1}</td>
                      <td className="py-2.5 text-left whitespace-normal">
                        <button
                          type="button"
                          onClick={() => onSelectModel(key)}
                          className={cn(
                            "flex items-center gap-2 text-left text-foreground outline-none after:absolute after:inset-0",
                            !hasBar && "py-1",
                          )}
                        >
                          <span
                            aria-hidden
                            className="size-2 shrink-0 rounded-xs"
                            style={{ background: PROVIDER_PRESENTATION[model.provider].color }}
                          />
                          {model.model}
                        </button>
                        {hasBar ? (
                          <div aria-hidden className={cn("mt-1.5 h-[3px] max-w-48", rowFigures)}>
                            <div
                              className="usage-grow h-full rounded-full"
                              style={{
                                width: `max(0.5rem, ${(value / breakdownPeak) * 100}%)`,
                                backgroundColor: PROVIDER_PRESENTATION[model.provider].color,
                              }}
                            />
                          </div>
                        ) : null}
                      </td>
                      <td className={cn("py-2.5 pl-6 text-foreground", rowFigures)}>
                        {metric === "tokens" ? (
                          formatTokens(model.totalTokens)
                        ) : isModelCostUnknown(model) ? (
                          <span className="text-muted-foreground">{uiText("Unpriced")}</span>
                        ) : (
                          formatUsd(model.costUsd)
                        )}
                      </td>
                      <td className={cn("hidden py-2.5 pl-6 sm:table-cell", rowFigures)}>
                        {share === null ? "" : formatPercent(share)}
                      </td>
                      <td className={cn("py-2.5 pr-2 pl-6", rowFigures)}>
                        {formatTokens(
                          metric === "tokens" ? model.tokens.outputTokens : model.totalTokens,
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        ) : breakdown === "project" ? (
          <table className={cn("w-full text-sm", figureClass(loadingPartial))}>
            <thead>
              <tr className="border-b border-border text-right text-xs text-muted-foreground">
                <th className="py-2 pr-3 text-left font-normal">#</th>
                <th className="w-full py-2 text-left font-normal">{uiText("Project")}</th>
                <th className="py-2 pl-6 font-normal">{usageTableHeaders(metric).primary}</th>
                <th className="hidden py-2 pl-6 font-normal sm:table-cell">{uiText("Share")}</th>
                <th className="py-2 pl-6 font-normal">{usageTableHeaders(metric).secondary}</th>
              </tr>
            </thead>
            <tbody>
              {breakdownProjects.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-muted-foreground">
                    {uiText("No activity in this window.")}
                  </td>
                </tr>
              ) : (
                breakdownProjects.map((project, index) => {
                  const value = metric === "tokens" ? project.totalTokens : project.costUsd;
                  const costUnknown =
                    project.records > 0 && project.unpricedRecords >= project.records;
                  return (
                    <tr
                      key={project.key}
                      className="border-b border-border/50 text-right whitespace-nowrap text-muted-foreground tabular-nums"
                    >
                      <td className="py-2.5 pr-3 text-left text-xs">{index + 1}</td>
                      <td className="py-2.5 text-left whitespace-normal">
                        <span className={project.kind === "project" ? "text-foreground" : ""}>
                          {project.kind === "project"
                            ? project.title
                            : project.kind === "unlinked"
                              ? uiText("Not in a T3 thread")
                              : uiText("Not reported by this server")}
                        </span>
                        {project.kind === "project" && selectedEnvironments.length > 1 ? (
                          <span className="ml-1.5 text-xs">{project.environmentLabel}</span>
                        ) : null}
                        {value > 0 && projectPeak > 0 ? (
                          <div aria-hidden className="mt-1.5 h-[3px] max-w-48">
                            <div
                              className="h-full rounded-full bg-foreground/60"
                              style={{ width: `max(0.5rem, ${(value / projectPeak) * 100}%)` }}
                            />
                          </div>
                        ) : null}
                      </td>
                      <td className="py-2.5 pl-6 text-foreground">
                        {costUnknown ? (
                          <span className="text-muted-foreground">{uiText("Unpriced")}</span>
                        ) : (
                          formatUsd(project.costUsd)
                        )}
                      </td>
                      <td className="hidden py-2.5 pl-6 sm:table-cell">
                        {metric === "tokens"
                          ? formatPercent(project.tokenShare)
                          : costUnknown
                            ? ""
                            : formatPercent(project.costShare)}
                      </td>
                      <td className="py-2.5 pl-6">{formatTokens(project.totalTokens)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        ) : (
          <div
            className="overflow-x-auto outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            role="region"
            aria-label="Usage breakdown by time"
            tabIndex={0}
          >
            <table className="w-full text-sm whitespace-nowrap">
              <colgroup>
                <col className="w-2/5" />
              </colgroup>
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="py-2 pl-2 font-normal">{uiText(shownHourly ? "Hour" : "Day")}</th>
                  {activeProviders.map((provider) => (
                    <th key={provider} className="py-2 pl-4 text-right font-normal">
                      {usageSeriesLabel(provider)}
                    </th>
                  ))}
                  <th className="py-2 pl-4 text-right font-normal">{uiText("Total")}</th>
                  <th className="py-2 pr-2 pl-4 text-right font-normal">
                    {usageTableHeaders(metric).secondary}
                  </th>
                </tr>
              </thead>
              <tbody>
                {breakdownPeriods.length === 0 ? (
                  <tr>
                    <td
                      colSpan={activeProviders.length + 3}
                      className="py-6 text-center text-muted-foreground"
                    >
                      {uiText("No activity in this window.")}
                    </td>
                  </tr>
                ) : (
                  breakdownPeriods.map((period) => (
                    <tr
                      key={"hourStart" in period ? period.hourStart : period.day}
                      className="border-b border-border/50 transition-colors hover:bg-muted/50"
                    >
                      <td className="py-2 pl-2 text-foreground">
                        {"hourStart" in period
                          ? formatHourShort(period.hourStart, shownWindow.timeZone, hour12)
                          : formatDayShort(period.day)}
                      </td>
                      {activeProviders.map((provider) => (
                        <td
                          key={provider}
                          className={cn(
                            "py-2 pl-4 text-right text-muted-foreground tabular-nums",
                            figureClass(loadingProviders.has(provider)),
                          )}
                        >
                          {(metric === "tokens" ? formatTokens : formatUsd)(
                            [...period.byProvider]
                              .filter(([kind]) => usageSeries(kind) === provider)
                              .reduce(
                                (sum, [, entry]) =>
                                  sum + (metric === "tokens" ? entry.totalTokens : entry.costUsd),
                                0,
                              ),
                          )}
                        </td>
                      ))}
                      <td
                        className={cn(
                          "py-2 pl-4 text-right text-foreground tabular-nums",
                          figureClass(loadingPartial),
                        )}
                      >
                        {metric === "tokens"
                          ? formatTokens(period.totalTokens)
                          : formatUsd(period.costUsd)}
                      </td>
                      <td
                        className={cn(
                          "py-2 pr-2 pl-4 text-right text-muted-foreground tabular-nums",
                          figureClass(loadingPartial),
                        )}
                      >
                        {formatTokens(period.totalTokens)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {apple &&
        sourceMessages
          .filter(
            (message) =>
              !/cursor/i.test(message) ||
              merged.providers.some(
                (p) => p.provider === "cursor" && (p.records > 0 || p.sessions > 0),
              ),
          )
          .map((message) => (
            <p
              key={message}
              className={
                apple ? "usage-info-banner" : "text-sm text-muted-foreground lg:col-span-2"
              }
            >
              {usageDiagnosticText(message, uiText)}
            </p>
          ))}
    </div>
  );
}

function ProviderMark({
  provider,
  className,
}: {
  readonly provider: UsageProviderKind;
  readonly className: string;
}) {
  const presentation = PROVIDER_PRESENTATION[provider];
  return (
    <ProviderInstanceIcon
      driverKind={presentation.driverKind}
      displayName={presentation.label}
      iconClassName={className}
    />
  );
}
function figureClass(loading: boolean) {
  return cn("transition-opacity", loading && "opacity-40 delay-150");
}
function Metric({
  label,
  value,
  loading,
  note,
}: {
  readonly label: string;
  readonly value: string;
  readonly loading: boolean;
  readonly note?: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className={cn("text-base font-medium text-foreground tabular-nums", figureClass(loading))}
      >
        {value}
      </dd>
      {note ? <span className="text-3xs text-muted-foreground">{note}</span> : null}
    </div>
  );
}
function UsageCoverageNotice({
  environments,
  duplicateSources,
  contractMismatches,
}: {
  readonly environments: readonly EnvironmentUsageStatus[];
  readonly duplicateSources: readonly string[];
  readonly contractMismatches: MergedUsage["contractMismatches"];
}) {
  const uiText = useUiText();
  const failed = environments.filter((environment) => environment.error !== null);
  const mismatchByEnvironment = new Map(
    contractMismatches.map((mismatch) => [mismatch.environmentId, mismatch]),
  );
  const incompatible = environments.flatMap((environment) => {
    const mismatch = mismatchByEnvironment.get(environment.environmentId);
    return mismatch === undefined ? [] : [{ environment, mismatch }];
  });
  if (failed.length === 0 && incompatible.length === 0 && duplicateSources.length === 0) {
    return null;
  }
  return (
    <div className="flex flex-col gap-1 border-t border-border px-2 py-2 text-xs text-muted-foreground">
      {failed.map((environment) => (
        <span key={environment.label}>
          {environment.label}
          {": "}
          {environment.error}
        </span>
      ))}
      {incompatible.map(({ environment, mismatch }) => (
        <span key={environment.environmentId}>
          {formatUsageContractMismatch(environment.label, mismatch)}
        </span>
      ))}
      {duplicateSources.length > 0 ? (
        <span>
          {uiText("Counted once across environments sharing a transcript directory:")}
          {duplicateSources.join(", ")}
        </span>
      ) : null}
    </div>
  );
}
function UsageEnvironmentFilter({
  environments,
  selectedEnvironments,
  selectedEnvironmentIds,
  onSelectionChange,
  showUsageStatus,
  refreshing,
  isPartial,
  duplicateSources,
  contractMismatches,
  onOpenModelPrices,
}: {
  readonly environments: readonly EnvironmentUsageStatus[];
  readonly selectedEnvironments: readonly EnvironmentUsageStatus[];
  readonly selectedEnvironmentIds: ReadonlySet<EnvironmentId> | null;
  readonly onSelectionChange: (ids: ReadonlySet<EnvironmentId> | null) => void;
  readonly showUsageStatus: boolean;
  readonly refreshing: boolean;
  readonly isPartial: boolean;
  readonly duplicateSources: readonly string[];
  readonly contractMismatches: MergedUsage["contractMismatches"];
  readonly onOpenModelPrices: () => void;
}) {
  const uiText = useUiText();
  const allSelected = selectedEnvironmentIds === null;
  const label = allSelected
    ? uiText("All environments")
    : selectedEnvironments.length === 1
      ? selectedEnvironments[0]!.label
      : `${selectedEnvironments.length} environments`;
  const hasIssue =
    selectedEnvironments.some((environment) => environment.error !== null) ||
    contractMismatches.length > 0;
  return (
    <Menu>
      <MenuTrigger render={<InlineButton />} className="group/usage-environment min-w-0 max-w-full">
        <WorkspaceBreadcrumbText>{label}</WorkspaceBreadcrumbText>
        <span className="flex size-3.5 shrink-0 items-center justify-center text-muted-foreground">
          {showUsageStatus && hasIssue ? (
            <CircleAlertIcon
              className="size-3.5 text-warning-foreground"
              aria-label={uiText("Some environments could not report usage")}
            />
          ) : (
            <ChevronDownIcon
              className="size-3.5 opacity-60 transition-opacity group-hover/usage-environment:opacity-100 group-focus-visible/usage-environment:opacity-100 group-data-popup-open/usage-environment:opacity-100"
              aria-hidden
            />
          )}
        </span>
      </MenuTrigger>
      <MenuPopup data-usage-portal align="start">
        <MenuCheckboxItem
          checked={allSelected}
          closeOnClick={false}
          onCheckedChange={(checked) => onSelectionChange(checked ? null : new Set())}
        >
          {uiText("All environments")}
        </MenuCheckboxItem>
        <MenuSeparator />
        {environments.map((environment) => {
          const checked =
            selectedEnvironmentIds === null ||
            selectedEnvironmentIds.has(environment.environmentId);
          const progress = usageEnvironmentProgress(environment, refreshing);
          const status =
            environment.error !== null
              ? uiText("Unavailable")
              : environment.summary !== null &&
                  !isCompatibleUsageContractVersion(
                    environment.summary.contractVersion,
                    USAGE_CONTRACT_VERSION,
                  )
                ? uiText("Update required")
                : !environment.isConnected
                  ? uiText("Connecting…")
                  : progress.phase === "loading"
                    ? uiText("Scanning…")
                    : progress.phase === "stale"
                      ? uiText("Refreshing…")
                      : progress.phase === "partway"
                        ? updatingProvidersLabel(progress.providers, providerLabel)
                        : uiText("Ready");
          return (
            <MenuCheckboxItem
              key={environment.environmentId}
              checked={checked}
              closeOnClick={false}
              onCheckedChange={(nextChecked) => {
                const next = new Set(selectedEnvironments.map((entry) => entry.environmentId));
                if (nextChecked) next.add(environment.environmentId);
                else next.delete(environment.environmentId);
                onSelectionChange(next.size === environments.length ? null : next);
              }}
            >
              <span className="flex min-w-0 items-center gap-3">
                <span className="min-w-0 flex-1 truncate">{environment.label}</span>
                {showUsageStatus ? (
                  <span
                    className={cn(
                      "shrink-0 text-xs text-muted-foreground",
                      environment.error !== null && "text-destructive",
                    )}
                  >
                    {status}
                  </span>
                ) : null}
              </span>
            </MenuCheckboxItem>
          );
        })}
        {environments.length === 0 ? (
          <p className="px-2 py-2 text-xs text-muted-foreground">
            {uiText("No environments connected.")}
          </p>
        ) : null}
        {showUsageStatus && isPartial ? (
          <p className="px-2 py-2 text-xs text-muted-foreground">
            {uiText("Totals are partial while selected environments scan.")}
          </p>
        ) : null}
        {showUsageStatus ? (
          <UsageCoverageNotice
            environments={selectedEnvironments}
            duplicateSources={duplicateSources}
            contractMismatches={contractMismatches}
          />
        ) : null}
        <MenuSeparator />
        <MenuItem onClick={onOpenModelPrices}>
          <SlidersHorizontalIcon aria-hidden />
          {uiText("Model prices")}
        </MenuItem>
      </MenuPopup>
    </Menu>
  );
}
function UsageProviderFilter({
  hiddenProviders,
  onChange,
}: {
  readonly hiddenProviders: ReadonlySet<UsageProviderKind>;
  readonly onChange: (hiddenProviders: readonly UsageProviderKind[]) => void;
}) {
  const uiText = useUiText();
  const visible = PROVIDER_ORDER.filter((provider) => !hiddenProviders.has(provider));
  const label =
    visible.length === PROVIDER_ORDER.length
      ? uiText("All providers")
      : visible.length === 0
        ? uiText("No providers")
        : visible.length === 1
          ? PROVIDER_PRESENTATION[visible[0]!].label
          : `${visible.length} providers`;
  return (
    <Menu>
      <MenuTrigger render={<InlineButton />} className="group/usage-provider min-w-0 max-w-full">
        <span className="min-w-0 truncate">{label}</span>
        <ChevronDownIcon
          className="size-3.5 shrink-0 text-muted-foreground opacity-60 transition-opacity group-hover/usage-provider:opacity-100 group-focus-visible/usage-provider:opacity-100 group-data-popup-open/usage-provider:opacity-100"
          aria-hidden
        />
      </MenuTrigger>
      <MenuPopup data-usage-portal align="start">
        <MenuCheckboxItem
          checked={hiddenProviders.size === 0}
          closeOnClick={false}
          onCheckedChange={(checked) => onChange(checked ? [] : PROVIDER_ORDER)}
        >
          {uiText("All providers")}
        </MenuCheckboxItem>
        <MenuSeparator />
        {PROVIDER_ORDER.map((provider) => (
          <MenuCheckboxItem
            key={provider}
            checked={!hiddenProviders.has(provider)}
            closeOnClick={false}
            onCheckedChange={(checked) =>
              onChange(
                PROVIDER_ORDER.filter((entry) =>
                  entry === provider ? !checked : hiddenProviders.has(entry),
                ),
              )
            }
          >
            <span className="flex min-w-0 items-center gap-2">
              <ProviderMark provider={provider} className="size-3.5" />
              <span className="truncate">{providerLabel(provider)}</span>
            </span>
          </MenuCheckboxItem>
        ))}
      </MenuPopup>
    </Menu>
  );
}

function usageDiagnosticText(message: string, text: ReturnType<typeof useUiText>) {
  const match =
    /^(\d+) malformed or inconsistent usage record\(s\) were skipped; usage may be incomplete\.$/.exec(
      message,
    );
  return match ? text(MALFORMED_USAGE_WARNING_TEMPLATE, { count: match[1] }) : text(message);
}
