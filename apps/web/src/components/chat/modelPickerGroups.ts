import { PROVIDER_DISPLAY_NAMES, type ProviderInstanceId } from "@t3tools/contracts";

import type { ProviderInstanceEntry } from "../../providerInstances";

export interface ModelPickerGroup {
  readonly key: string;
  readonly label: string;
  readonly entries: ReadonlyArray<ProviderInstanceEntry>;
}

// Registry agents share one driver kind, so the agent id tells them apart; one without an id
// (a custom agent) is never merged with another.
export function modelPickerGroupKey(
  entry: Pick<ProviderInstanceEntry, "instanceId" | "driverKind" | "acpRegistryAgentId">,
): string {
  if (entry.driverKind !== "acpRegistry") return entry.driverKind;
  return entry.acpRegistryAgentId
    ? `acpRegistry:${entry.acpRegistryAgentId}`
    : `instance:${entry.instanceId}`;
}

/** One group per provider, in the order its first account appears. */
export function groupModelPickerEntries(
  entries: ReadonlyArray<ProviderInstanceEntry>,
): ReadonlyArray<ModelPickerGroup> {
  const byKey = new Map<string, ProviderInstanceEntry[]>();
  for (const entry of entries) {
    const key = modelPickerGroupKey(entry);
    const group = byKey.get(key);
    if (group) group.push(entry);
    else byKey.set(key, [entry]);
  }
  return [...byKey].map(([key, group]) => {
    const first = group[0]!;
    const label =
      group.length === 1 || first.driverKind === "acpRegistry"
        ? (group.find((entry) => entry.isDefault) ?? first).displayName
        : (PROVIDER_DISPLAY_NAMES[first.driverKind] ?? first.displayName);
    return { key, label, entries: group };
  });
}

/**
 * The account a group shows: the open tab's account, then the one picked in this popup, the
 * thread's own, the one last used for this provider, and finally the first that can be picked.
 */
export function resolveModelPickerGroupAccount(input: {
  readonly group: ModelPickerGroup;
  readonly selectedInstanceId: string;
  readonly chosenInstanceId: ProviderInstanceId | undefined;
  readonly activeInstanceId: ProviderInstanceId;
  readonly rememberedInstanceId: string | undefined;
  readonly isSelectable: (entry: ProviderInstanceEntry) => boolean;
}): ProviderInstanceEntry {
  const { group } = input;
  const find = (instanceId: string | undefined, requireSelectable: boolean) =>
    instanceId === undefined
      ? undefined
      : group.entries.find(
          (entry) =>
            entry.instanceId === instanceId && (!requireSelectable || input.isSelectable(entry)),
        );
  return (
    find(input.selectedInstanceId, false) ??
    find(input.chosenInstanceId, true) ??
    find(input.activeInstanceId, true) ??
    find(input.rememberedInstanceId, true) ??
    group.entries.find(input.isSelectable) ??
    group.entries[0]!
  );
}
