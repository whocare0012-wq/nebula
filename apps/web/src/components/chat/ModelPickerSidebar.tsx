import { useUiText } from "~/i18n/useUiText";

import { Toolbar } from "@base-ui/react/toolbar";
import { type ProviderInstanceId } from "@t3tools/contracts";
import { memo } from "react";
import { ProviderInstanceIcon } from "./ProviderInstanceIcon";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { cn } from "~/lib/utils";
import "./composerV9.css";
import {
  isProviderInstancePickerReady,
  shouldShowInstanceBadge,
  type ProviderInstanceEntry,
} from "../../providerInstances";

export type ModelPickerTabId = ProviderInstanceId | "favorites" | "all";

function describeUnavailableInstance(
  entry: ProviderInstanceEntry,
  uiText: ReturnType<typeof useUiText>,
): string {
  const label = entry.displayName;
  // An unavailable instance (a driver this build lacks or the policy leaves out) says why instead.
  if ((!entry.enabled && entry.isAvailable) || entry.status === "disabled") {
    return uiText("{label}: Disabled in settings.", { label });
  }
  if (entry.status === "ready" && entry.isAvailable) {
    return label;
  }
  const kind = uiText(
    entry.status === "error" ? "Unavailable" : entry.status === "warning" ? "Limited" : "Not ready",
  );
  const msg = entry.snapshot.message?.trim();
  return msg
    ? uiText("{label}: {kind}. {message}", { label, kind, message: msg })
    : uiText("{label}: {kind}.", { label, kind });
}

export const ModelPickerSidebar = memo(function ModelPickerSidebar(props: {
  selectedInstanceId: ModelPickerTabId;
  onSelectInstance: (instanceId: ModelPickerTabId) => void;
  onFocusSearch: () => void;
  instanceEntries: ReadonlyArray<ProviderInstanceEntry>;
  showFavorites?: boolean;
  showAll?: boolean;
  disabledInstanceIds?: ReadonlySet<ProviderInstanceId>;
  selectableUnavailableInstanceIds?: ReadonlySet<ProviderInstanceId>;
  getDisabledInstanceTooltip?: (entry: ProviderInstanceEntry) => string;
  /** The account row under a provider tab that holds several accounts. */
  variant?: "providers" | "accounts";
  /** Remaining quota shown beside each account in the account row. */
  quotaByInstanceId?: ReadonlyMap<
    ProviderInstanceId,
    { readonly label: string; readonly remaining: number; readonly low: boolean } | null
  >;
}) {
  const uiText = useUiText();
  const handleSelect = (instanceId: ModelPickerTabId) => {
    props.onSelectInstance(instanceId);
  };
  const showFavorites = props.showFavorites ?? true;
  const showAll = props.showAll ?? true;
  const accounts = props.variant === "accounts";

  return (
    <Toolbar.Root
      data-model-picker-sidebar="true"
      data-v9-mp-tabs
      data-v9-mp-accounts={accounts ? "true" : undefined}
      aria-label={accounts ? uiText("Accounts") : uiText("Providers")}
      orientation="horizontal"
      onKeyDown={(event) => {
        if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        if (event.key === "ArrowDown") {
          event.preventDefault();
          props.onFocusSearch();
        }
      }}
    >
      {showFavorites ? (
        <Toolbar.Button
          data-model-picker-provider="favorites"
          data-v9-mp-tab
          type="button"
          aria-pressed={props.selectedInstanceId === "favorites"}
          onClick={() => handleSelect("favorites")}
        >
          <span>{uiText("Frequent")}</span>
        </Toolbar.Button>
      ) : null}

      {showAll ? (
        <Toolbar.Button
          data-model-picker-provider="all"
          data-v9-mp-tab
          type="button"
          aria-pressed={props.selectedInstanceId === "all"}
          onClick={() => handleSelect("all")}
        >
          <span>{uiText("All")}</span>
        </Toolbar.Button>
      ) : null}

      {props.instanceEntries.map((entry) => {
        const isUnavailable = !isProviderInstancePickerReady(entry);
        const isContextDisabled = props.disabledInstanceIds?.has(entry.instanceId) ?? false;
        const unavailableSelectionIsReachable =
          props.selectableUnavailableInstanceIds?.has(entry.instanceId) ?? false;
        const isDisabled = (isUnavailable && !unavailableSelectionIsReachable) || isContextDisabled;
        const isSelected = props.selectedInstanceId === entry.instanceId;
        const showInstanceBadge = shouldShowInstanceBadge(entry, props.instanceEntries);
        const quota = accounts ? props.quotaByInstanceId?.get(entry.instanceId) : null;

        const tooltip = isUnavailable
          ? describeUnavailableInstance(entry, uiText)
          : isContextDisabled
            ? (props.getDisabledInstanceTooltip?.(entry) ?? entry.displayName)
            : null;

        const button = (
          <Toolbar.Button
            key={entry.instanceId}
            data-model-picker-provider={entry.instanceId}
            data-provider-accent-color={entry.accentColor}
            data-v9-mp-tab
            type="button"
            disabled={isDisabled}
            focusableWhenDisabled={!isDisabled}
            aria-pressed={isSelected}
            aria-label={
              tooltip ?? (quota ? `${entry.displayName}, ${quota.label}` : entry.displayName)
            }
            onClick={() => !isDisabled && handleSelect(entry.instanceId)}
          >
            <ProviderInstanceIcon
              driverKind={entry.driverKind}
              displayName={entry.displayName}
              accentColor={entry.accentColor}
              acpRegistryAgentId={entry.acpRegistryAgentId}
              acpRegistryIconUrl={entry.acpRegistryIconUrl}
              showBadge={showInstanceBadge}
              size="compact"
              className="size-3"
              iconClassName={cn("size-3")}
            />
            <span>{entry.displayName}</span>
            {quota ? (
              <span data-v9-mp-meta data-low={quota.low ? "true" : undefined} aria-hidden="true">
                {quota.remaining}%
              </span>
            ) : null}
          </Toolbar.Button>
        );

        if (!tooltip) {
          return button;
        }

        return (
          <Tooltip key={entry.instanceId}>
            <TooltipTrigger
              render={isDisabled ? <span className="inline-flex shrink-0">{button}</span> : button}
            />
            <TooltipPopup side="top" align="center">
              {tooltip}
            </TooltipPopup>
          </Tooltip>
        );
      })}
    </Toolbar.Root>
  );
});
