import type { ServerProviderUsageWindow } from "@t3tools/contracts";
import { quotaAccounts, type QuotaAccount } from "@t3tools/shared/usageLimits";
export { quotaAccounts, type QuotaAccount } from "@t3tools/shared/usageLimits";
import * as Schema from "effect/Schema";

import { quotaReadingStale } from "./usageQuotaPresentation";

export const QUOTA_PREFERENCES_KEY = "t3code:quota-topbar:v1";
export const QuotaPreferencesSchema = Schema.Struct({
  pins: Schema.NullOr(Schema.Array(Schema.String)),
  pinsEdited: Schema.optionalKey(Schema.Boolean),
  windows: Schema.Record(Schema.String, Schema.String),
  showNames: Schema.Boolean,
  followSession: Schema.optionalKey(Schema.Boolean),
});
export type QuotaPreferences = typeof QuotaPreferencesSchema.Type;
export const DEFAULT_QUOTA_PREFERENCES: QuotaPreferences = {
  pins: null,
  pinsEdited: false,
  windows: {},
  showNames: true,
  followSession: true,
};
export function quotaPins(
  preferences: QuotaPreferences,
  accounts: readonly QuotaAccount[],
): readonly string[] {
  if (preferences.pinsEdited === true && preferences.pins !== null)
    return [...new Set(preferences.pins)].slice(0, 4);
  const drivers = new Set<string>();
  const priority = ["codex", "claudeAgent", "antigravity"];
  return [...accounts]
    .sort(
      (a, b) =>
        (priority.indexOf(a.driver) < 0 ? 10 : priority.indexOf(a.driver)) -
        (priority.indexOf(b.driver) < 0 ? 10 : priority.indexOf(b.driver)),
    )
    .filter((a) => {
      if (
        !a.limits?.windows.length ||
        a.limits.unavailable?.reason === "unsupported" ||
        drivers.has(a.driver)
      )
        return false;
      drivers.add(a.driver);
      return true;
    })
    .slice(0, 3)
    .map((a) => a.id);
}
/** The open thread's provider instance, and the model it runs when that model is known. */
export interface QuotaCurrent {
  readonly environmentId: string;
  readonly instanceId: string;
  readonly model?: string | undefined;
}

/** The login the open thread's provider instance signs in with, when it has a quota to show. */
function followedQuotaAccount(
  accounts: readonly QuotaAccount[],
  current: QuotaCurrent | null,
): QuotaAccount | null {
  if (current === null) return null;
  return (
    accounts.find(
      (account) =>
        account.limits?.windows.length &&
        account.limits.unavailable?.reason !== "unsupported" &&
        account.instances.some(
          (instance) =>
            instance.environmentId === current.environmentId &&
            instance.instanceId === current.instanceId,
        ),
    ) ?? null
  );
}

/**
 * Pinned accounts, with the open thread's account in view when following is on: it takes the
 * place of a pinned account of the same provider, or comes first when none is pinned. The
 * swap is never saved, so the pins come back when the thread closes.
 */
export function quotaShownIds(
  preferences: QuotaPreferences,
  accounts: readonly QuotaAccount[],
  current: QuotaCurrent | null,
): { readonly ids: readonly string[]; readonly followedId: string | null } {
  const pins = quotaPins(preferences, accounts);
  const followed =
    preferences.followSession === false ? null : followedQuotaAccount(accounts, current);
  if (followed === null) return { ids: pins, followedId: null };
  if (pins.includes(followed.id)) return { ids: pins, followedId: followed.id };
  const sameProvider = pins.findIndex(
    (id) => accounts.find((account) => account.id === id)?.driver === followed.driver,
  );
  return {
    ids:
      sameProvider < 0
        ? [followed.id, ...pins].slice(0, 4)
        : pins.map((id, index) => (index === sameProvider ? followed.id : id)),
    followedId: followed.id,
  };
}

/** The model the open thread runs on this account, which decides which of its quotas matters. */
export function quotaModelFor(account: QuotaAccount, current: QuotaCurrent | null) {
  if (!current?.model) return undefined;
  return account.instances.some(
    (instance) =>
      instance.environmentId === current.environmentId &&
      instance.instanceId === current.instanceId,
  )
    ? current.model
    : undefined;
}

// Antigravity meters Gemini apart from Claude and GPT, which share one ("3p") quota. Gemini
// comes first: the shared window does not move while Gemini runs.
function antigravityWindows(
  windows: readonly ServerProviderUsageWindow[],
  model: string | undefined,
): readonly ServerProviderUsageWindow[] {
  const thirdParty = /^(claude|gpt)/i.test(model ?? "");
  const family = windows.filter((w) =>
    thirdParty ? /^(3p|claude|gpt)-/.test(w.id) : /^gemini-(?!argon-|carbon-)/.test(w.id),
  );
  return family.length ? family : windows;
}

export function quotaWindow(
  account: QuotaAccount,
  preferences: QuotaPreferences,
  model?: string,
): ServerProviderUsageWindow | null {
  if (account.limits?.unavailable?.reason === "unsupported") return null;
  const wanted = preferences.windows[account.id];
  if (wanted) return account.limits?.windows.find((w) => `${w.kind}:${w.id}` === wanted) ?? null;
  const all = account.limits?.windows ?? [];
  const windows = account.driver === "antigravity" ? antigravityWindows(all, model) : all;
  return windows.find((w) => w.kind === "weekly") ?? windows[0] ?? null;
}
export function quotaState(
  account: QuotaAccount,
  window: ServerProviderUsageWindow | null,
  now: number,
) {
  if (!window || !Number.isFinite(window.usedPercent))
    return { remaining: null, state: "unknown" as const };
  const reset = Date.parse(window.resetsAt ?? "");
  if (Number.isFinite(reset) && reset <= now)
    return { remaining: Math.round(100 - window.usedPercent), state: "reset" as const };
  const stale = quotaReadingStale(account.limits, now, account.connected, account.failed);
  return {
    remaining: Math.round(100 - Math.max(0, Math.min(100, window.usedPercent))),
    state: stale ? ("stale" as const) : ("current" as const),
  };
}

/** Keep quota derivation and subscribers asleep for catalog/status-only pushes. */
export function createQuotaAccountsSelector() {
  let previousInputs: readonly unknown[] | undefined;
  let previous: readonly QuotaAccount[] = [];
  return (presentations: Parameters<typeof quotaAccounts>[0]): readonly QuotaAccount[] => {
    const inputs = [...presentations].flatMap(([id, p]) => [
      id,
      p.entry.target.label,
      p.connection.phase,
      p.serverConfig === null,
      p.serverConfig?.usageLimitSources,
      p.serverConfig?.providers.length,
      ...(p.serverConfig?.providers ?? []).flatMap((provider) => [
        provider.instanceId,
        provider.driver,
        provider.enabled,
        provider.installed,
        provider.availability,
        provider.displayName,
        provider.accentColor,
        provider.auth,
        provider.usageLimits,
      ]),
    ]);
    if (
      previousInputs?.length === inputs.length &&
      inputs.every((value, i) => value === previousInputs![i])
    )
      return previous;
    previousInputs = inputs;
    previous = quotaAccounts(presentations);
    return previous;
  };
}
