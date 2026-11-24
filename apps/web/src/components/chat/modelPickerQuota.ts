import { uiText } from "../../i18n";
import type { ProviderDriverKind, ServerProvider, UsageProviderKind } from "@t3tools/contracts";
import type { ModelThroughputTotals } from "@t3tools/shared/usageMerge";
import { DEFAULT_QUOTA_PREFERENCES, quotaState, quotaWindow } from "../usage/quotaTopbarModel";

/** Minimum completed turns required before a model can earn the "Ultrafast" tag. */
const MIN_FASTEST_MODEL_TURNS = 5;

/** Remaining quota percentage at or below which quota always takes priority over speed/price tags. */
const LOW_QUOTA_PRIORITY_THRESHOLD = 20;

export interface ModelPickerQuotaInfo {
  readonly label: string;
  readonly low: boolean;
  readonly remaining: number;
}

export interface ModelPickerModelTag {
  readonly isFastest: boolean;
  readonly isLowPrice: boolean;
}

export interface ModelPickerTagCandidate {
  readonly key: string;
  readonly instanceId: string;
  readonly driverKind: ProviderDriverKind;
  readonly slug: string;
  readonly isUnavailable?: boolean | undefined;
}

const DRIVER_TO_USAGE_PROVIDER: Readonly<Record<string, UsageProviderKind>> = {
  claudeAgent: "claude",
  claude: "claude",
  codex: "codex",
  grok: "grok",
  cursor: "cursor",
  opencode: "opencode",
  antigravity: "antigravity",
  pi: "pi",
  muse: "muse",
};

function driverKindToUsageProvider(driverKind: ProviderDriverKind): UsageProviderKind | null {
  return DRIVER_TO_USAGE_PROVIDER[String(driverKind)] ?? null;
}

function normalizeModelLookupKey(model: string): string {
  const trimmed = model.trim().toLowerCase();
  const bracket = trimmed.indexOf("[");
  return bracket === -1 ? trimmed : trimmed.slice(0, bracket);
}

function bareModelLookupKey(key: string): string {
  const slash = key.lastIndexOf("/");
  return slash === -1 ? key : key.slice(slash + 1);
}

function lookupModelUnitPrice(
  modelUnitPrices: Readonly<Record<string, number>> | undefined,
  slug: string,
): number | null {
  if (modelUnitPrices === undefined) return null;
  const key = normalizeModelLookupKey(slug);
  if (key.length === 0) return null;
  const direct = modelUnitPrices[key];
  if (typeof direct === "number" && Number.isFinite(direct) && direct >= 0) return direct;
  const bare = bareModelLookupKey(key);
  if (bare !== key) {
    const fallback = modelUnitPrices[bare];
    if (typeof fallback === "number" && Number.isFinite(fallback) && fallback >= 0) {
      return fallback;
    }
  }
  return null;
}

export function modelPickerQuotaInfo(
  provider: Pick<ServerProvider, "driver" | "usageLimits">,
  now: number,
  /** Picks the quota this model draws on when a provider meters model families apart. */
  model?: string,
): ModelPickerQuotaInfo | null {
  const limits = provider.usageLimits;
  const account = {
    id: "",
    driver: provider.driver,
    label: "",
    title: "",
    name: "",
    instances: [],
    alias: "",
    limits,
    connected: true,
    failed: !!limits?.unavailable,
  };
  const status = quotaState(account, quotaWindow(account, DEFAULT_QUOTA_PREFERENCES, model), now);
  if (limits?.unavailable || status.state !== "current" || status.remaining === null) return null;
  return {
    label: uiText("{remaining}% left", { remaining: status.remaining }),
    low: status.remaining < 15,
    remaining: status.remaining,
  };
}

export function modelPickerQuota(
  provider: Pick<ServerProvider, "driver" | "usageLimits">,
  now: number,
) {
  const info = modelPickerQuotaInfo(provider, now);
  return info === null ? null : { label: info.label, low: info.low };
}

/**
 * Compute real-data "Ultrafast" and "Low-cost" tags for selectable models:
 * - Low-cost: lowest combined (input + output) unit price among at least 2 comparable models in the same provider.
 * - Ultrafast: #1 measured throughput across all models with throughput data and sample size >= 5 turns.
 */
export function computeModelPickerTags(input: {
  readonly models: ReadonlyArray<ModelPickerTagCandidate>;
  readonly modelUnitPrices?: Readonly<Record<string, number>> | undefined;
  readonly throughput?:
    | ReadonlyArray<Pick<ModelThroughputTotals, "provider" | "model" | "turns" | "tokensPerSecond">>
    | undefined;
}): ReadonlyMap<string, ModelPickerModelTag> {
  const selectable = input.models.filter((model) => model.isUnavailable !== true);
  const lowPriceKeys = new Set<string>();

  if (input.modelUnitPrices !== undefined) {
    const byInstance = new Map<string, Array<{ readonly key: string; readonly price: number }>>();
    for (const model of selectable) {
      const price = lookupModelUnitPrice(input.modelUnitPrices, model.slug);
      if (price === null) continue;
      const list = byInstance.get(model.instanceId) ?? [];
      list.push({ key: model.key, price });
      byInstance.set(model.instanceId, list);
    }
    for (const priced of byInstance.values()) {
      if (priced.length < 2) continue;
      let minPrice = Infinity;
      let maxPrice = -Infinity;
      for (const entry of priced) {
        if (entry.price < minPrice) minPrice = entry.price;
        if (entry.price > maxPrice) maxPrice = entry.price;
      }
      if (minPrice >= maxPrice) continue;
      for (const entry of priced) {
        if (entry.price === minPrice) lowPriceKeys.add(entry.key);
      }
    }
  }

  const fastestExact = new Set<string>();
  const fastestBare = new Set<string>();
  const eligibleThroughput = (input.throughput ?? []).filter(
    (entry) =>
      entry.turns >= MIN_FASTEST_MODEL_TURNS &&
      entry.tokensPerSecond !== null &&
      Number.isFinite(entry.tokensPerSecond) &&
      entry.tokensPerSecond > 0,
  );
  if (eligibleThroughput.length > 0) {
    let bestRate = -Infinity;
    for (const entry of eligibleThroughput) {
      if (entry.tokensPerSecond! > bestRate) bestRate = entry.tokensPerSecond!;
    }
    for (const entry of eligibleThroughput) {
      if (entry.tokensPerSecond !== bestRate) continue;
      const normalized = normalizeModelLookupKey(entry.model);
      fastestExact.add(`${entry.provider}\u0000${normalized}`);
      fastestBare.add(`${entry.provider}\u0000${bareModelLookupKey(normalized)}`);
    }
  }

  const tags = new Map<string, ModelPickerModelTag>();
  for (const model of selectable) {
    const provider = driverKindToUsageProvider(model.driverKind);
    const normalized = normalizeModelLookupKey(model.slug);
    const isFastest =
      provider !== null &&
      (fastestExact.has(`${provider}\u0000${normalized}`) ||
        fastestBare.has(`${provider}\u0000${bareModelLookupKey(normalized)}`));
    const isLowPrice = lowPriceKeys.has(model.key);
    if (isFastest || isLowPrice) {
      tags.set(model.key, { isFastest, isLowPrice });
    }
  }
  return tags;
}

/** V9 right-side metadata priority: quota <= 20%, else earned tag, else quota, else null. */
export function resolveModelPickerRowMeta(input: {
  readonly quota: ModelPickerQuotaInfo | null;
  readonly tag: ModelPickerModelTag | undefined;
  readonly text?: typeof uiText;
}): { readonly label: string; readonly low: boolean } | null {
  const format = input.text ?? uiText;
  const { quota, tag } = input;
  if (quota !== null && quota.remaining <= LOW_QUOTA_PRIORITY_THRESHOLD) {
    return { label: quota.label, low: quota.low };
  }
  const isFastest = tag?.isFastest === true;
  const isLowPrice = tag?.isLowPrice === true;
  if (isFastest && isLowPrice) {
    return { label: format("Fast & Low-cost"), low: false };
  }
  if (isFastest) {
    return { label: format("Ultrafast"), low: false };
  }
  if (isLowPrice) {
    return { label: format("Low-cost"), low: false };
  }
  if (quota !== null) {
    return { label: quota.label, low: quota.low };
  }
  return null;
}
