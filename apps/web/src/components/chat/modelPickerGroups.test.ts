import { ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { ProviderInstanceEntry } from "../../providerInstances";
import {
  groupModelPickerEntries,
  modelPickerGroupKey,
  resolveModelPickerGroupAccount,
} from "./modelPickerGroups";

function entry(
  id: string,
  driver: string,
  options: { displayName?: string; ready?: boolean; isDefault?: boolean; agent?: string } = {},
): ProviderInstanceEntry {
  return {
    instanceId: ProviderInstanceId.make(id),
    driverKind: ProviderDriverKind.make(driver),
    displayName: options.displayName ?? id,
    ...(options.agent ? { acpRegistryAgentId: options.agent } : {}),
    enabled: true,
    installed: true,
    status: options.ready === false ? "error" : "ready",
    isDefault: options.isDefault ?? false,
    isAvailable: true,
    snapshot: {} as ProviderInstanceEntry["snapshot"],
    models: [],
  };
}

const ids = (entries: ReadonlyArray<ProviderInstanceEntry>) => entries.map((e) => e.instanceId);

describe("groupModelPickerEntries", () => {
  it("puts every account of a provider in one group named after the provider", () => {
    const groups = groupModelPickerEntries([
      entry("codex", "codex", { displayName: "Codex", isDefault: true }),
      entry("claudeAgent", "claudeAgent", { displayName: "Claude" }),
      entry("codex_work", "codex", { displayName: "ChatGPT - work" }),
    ]);
    expect(groups.map((g) => [g.label, ids(g.entries)])).toEqual([
      ["Codex", ["codex", "codex_work"]],
      ["Claude", ["claudeAgent"]],
    ]);
  });

  it("keeps a single account's own name", () => {
    const [group] = groupModelPickerEntries([
      entry("codex_work", "codex", { displayName: "ChatGPT - work" }),
    ]);
    expect(group?.label).toBe("ChatGPT - work");
  });

  it("keeps different registry agents apart", () => {
    const groups = groupModelPickerEntries([
      entry("gemini", "acpRegistry", { agent: "gemini" }),
      entry("qwen", "acpRegistry", { agent: "qwen" }),
    ]);
    expect(groups).toHaveLength(2);
    expect(modelPickerGroupKey(groups[0]!.entries[0]!)).toBe("acpRegistry:gemini");
  });

  it("never merges registry agents that have no agent id", () => {
    const groups = groupModelPickerEntries([
      entry("custom-a", "acpRegistry"),
      entry("custom-b", "acpRegistry"),
    ]);
    expect(groups).toHaveLength(2);
  });
});

describe("resolveModelPickerGroupAccount", () => {
  const [group] = groupModelPickerEntries([
    entry("a", "codex"),
    entry("b", "codex"),
    entry("c", "codex", { ready: false }),
  ]);
  const resolve = (input: {
    selected?: string;
    chosen?: string;
    active?: string;
    remembered?: string;
  }) =>
    resolveModelPickerGroupAccount({
      group: group!,
      selectedInstanceId: input.selected ?? "all",
      chosenInstanceId: input.chosen ? ProviderInstanceId.make(input.chosen) : undefined,
      activeInstanceId: ProviderInstanceId.make(input.active ?? "claudeAgent"),
      rememberedInstanceId: input.remembered,
      isSelectable: (e) => e.status === "ready",
    }).instanceId;

  it("shows the open tab's account first, then this popup's pick, the thread's, the last used", () => {
    expect(resolve({ selected: "b", chosen: "a", active: "a", remembered: "a" })).toBe("b");
    expect(resolve({ chosen: "b", active: "a", remembered: "a" })).toBe("b");
    expect(resolve({ active: "b", remembered: "a" })).toBe("b");
    expect(resolve({ remembered: "b" })).toBe("b");
    expect(resolve({})).toBe("a");
  });

  it("skips accounts that cannot be picked unless their tab is open", () => {
    expect(resolve({ remembered: "c" })).toBe("a");
    expect(resolve({ selected: "c" })).toBe("c");
  });
});
