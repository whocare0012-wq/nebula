import {
  ProviderDriverKind,
  UsageLimitSourceError,
  type UsageLimitSourceAccount,
  type UsageLimitSourceWallet,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";

import { makeUnavailableUsageLimits } from "@t3tools/provider-core/server/usageLimits";
import { claudeUsageResponseToLimits } from "../provider/claudeUsageLimits.ts";
import { describeManagementFailure, type CliproxyHub } from "./cliproxyApi.ts";

const Envelope = <A extends Schema.Top>(data: A) =>
  Schema.Struct({ code: Schema.Number, data: Schema.optional(data) });

const Account = Schema.Struct({
  id: Schema.Number,
  name: Schema.optional(Schema.String),
  platform: Schema.String,
  type: Schema.optional(Schema.String),
  status: Schema.optional(Schema.String),
});
type Account = typeof Account.Type;

const AccountPage = Envelope(Schema.Struct({ items: Schema.Array(Account) }));

const Window = Schema.NullOr(
  Schema.Struct({
    utilization: Schema.optional(Schema.NullOr(Schema.Number)),
    utilization_unknown: Schema.optional(Schema.Boolean),
    resets_at: Schema.optional(Schema.NullOr(Schema.String)),
  }),
);
type Window = typeof Window.Type;

const Usage = Envelope(
  Schema.Struct({
    five_hour: Schema.optional(Window),
    seven_day: Schema.optional(Window),
    seven_day_sonnet: Schema.optional(Window),
    seven_day_fable: Schema.optional(Window),
    error: Schema.optional(Schema.NullOr(Schema.String)),
  }),
);

const UsageTotals = Schema.Struct({
  actual_cost: Schema.optional(Schema.Number),
  cost: Schema.optional(Schema.Number),
  requests: Schema.optional(Schema.Number),
});

const KeyUsage = Schema.Struct({
  isValid: Schema.optional(Schema.Boolean),
  mode: Schema.optional(Schema.String),
  planName: Schema.optional(Schema.String),
  unit: Schema.optional(Schema.String),
  balance: Schema.optional(Schema.NullOr(Schema.Number)),
  usage: Schema.optional(
    Schema.Struct({
      today: Schema.optional(UsageTotals),
      total: Schema.optional(UsageTotals),
    }),
  ),
});
const decodeKeyUsage = Schema.decodeUnknownEffect(KeyUsage);

const spent = (totals: typeof UsageTotals.Type | undefined) =>
  totals?.actual_cost ?? totals?.cost ?? 0;

/** Sub2API's own `/v1/usage` answer for an API key, as T3 shows it. */
export function keyUsageToWallet(usage: typeof KeyUsage.Type): UsageLimitSourceWallet | undefined {
  if (usage.isValid === false) return undefined;
  const plan = usage.planName?.trim();
  const unit = usage.unit?.trim();
  return {
    ...(plan ? { plan } : {}),
    ...(unit ? { unit } : {}),
    // An unrestricted key is not charged against the balance, so a zero there means nothing.
    ...(usage.mode !== "unrestricted" && typeof usage.balance === "number"
      ? { balance: usage.balance }
      : {}),
    todayCost: spent(usage.usage?.today),
    todayRequests: usage.usage?.today?.requests ?? 0,
    totalCost: spent(usage.usage?.total),
  };
}

const decodeAccountPage = Schema.decodeUnknownEffect(AccountPage);
const decodeUsage = Schema.decodeUnknownEffect(Usage);
const isUsageLimitSourceError = Schema.is(UsageLimitSourceError);

const CLAUDE = ProviderDriverKind.make("claudeAgent");
// API-key accounts have no subscription windows to read.
const SUBSCRIPTION_TYPES = new Set(["oauth", "setup-token"]);

// Sub2API marks utilization it only estimated from local stats; those bars would mislead.
const known = (window: Window | undefined) =>
  window && !window.utilization_unknown && typeof window.utilization === "number"
    ? { utilization: window.utilization, resets_at: window.resets_at ?? null }
    : null;

const accountIdentity = (account: Account) => {
  const name = account.name?.trim();
  return {
    id: name || `account-${account.id}`,
    ...(name && name.includes("@") ? { email: name } : {}),
  };
};

/** Reads the upstream Claude subscription windows a self-hosted Sub2API pools, with an admin API key. */
export const makeSub2apiApi = Effect.gen(function* () {
  const client = yield* HttpClient.HttpClient;

  const admin = Effect.fn("Sub2apiApi.admin")(function* (hub: CliproxyHub, path: string) {
    const url = yield* Effect.try({
      try: () => {
        const base = new URL(hub.url);
        base.pathname = base.pathname.replace(/\/?$/, "/");
        return new URL(`api/v1/admin/${path}`, base).toString();
      },
      catch: () => new UsageLimitSourceError({ detail: "The Sub2API URL is not valid." }),
    });
    return yield* client
      .execute(
        HttpClientRequest.get(url).pipe(
          HttpClientRequest.setHeader("x-api-key", hub.managementKey),
        ),
      )
      .pipe(
        Effect.flatMap(HttpClientResponse.filterStatusOk),
        Effect.flatMap((response) => response.json),
        Effect.timeout("15 seconds"),
        Effect.mapError(
          (error) => new UsageLimitSourceError({ detail: describeManagementFailure(error) }),
        ),
      );
  });

  const readAccount = Effect.fn("Sub2apiApi.readAccount")(function* (
    hub: CliproxyHub,
    account: Account,
  ) {
    const checkedAt = DateTime.formatIso(yield* DateTime.now);
    const identity = accountIdentity(account);
    const reading = yield* Effect.gen(function* () {
      const usage = yield* decodeUsage(yield* admin(hub, `accounts/${account.id}/usage`));
      const data = usage.data;
      if (usage.code !== 0 || !data || data.error) {
        return yield* new UsageLimitSourceError({
          detail: "Sub2API could not read this account's usage.",
        });
      }
      const scoped: ReadonlyArray<readonly [string, Window | undefined]> = [
        ["Sonnet", data.seven_day_sonnet],
        ["Fable", data.seven_day_fable],
      ];
      const model_scoped = scoped.flatMap(([display_name, window]) => {
        const reading = known(window);
        return reading ? [{ display_name, ...reading }] : [];
      });
      // A variable, not a literal: model_scoped postdates the SDK typings (see claudeUsageLimits).
      const rateLimits = {
        five_hour: known(data.five_hour),
        seven_day: known(data.seven_day),
        model_scoped,
      };
      return claudeUsageResponseToLimits({
        checkedAt,
        response: { rate_limits_available: true, rate_limits: rateLimits },
      }).limits;
    }).pipe(
      Effect.catch((error) =>
        Effect.succeed(
          makeUnavailableUsageLimits({
            checkedAt,
            reason: "probeFailed",
            message: isUsageLimitSourceError(error)
              ? error.detail
              : "Sub2API could not read this account's usage.",
          }),
        ),
      ),
    );
    return {
      ...identity,
      driver: CLAUDE,
      plan: "Claude Subscription",
      usageLimits: reading,
    } satisfies UsageLimitSourceAccount;
  });

  const readAccounts = Effect.fn("Sub2apiApi.readAccounts")(function* (
    hub: CliproxyHub,
  ): Effect.fn.Return<ReadonlyArray<UsageLimitSourceAccount>, UsageLimitSourceError> {
    const page = yield* admin(hub, "accounts?platform=anthropic&lite=true&page_size=1000").pipe(
      Effect.flatMap(decodeAccountPage),
      Effect.mapError((error) =>
        isUsageLimitSourceError(error)
          ? error
          : new UsageLimitSourceError({ detail: "Sub2API could not list accounts." }),
      ),
    );
    if (page.code !== 0 || !page.data) {
      return yield* new UsageLimitSourceError({ detail: "Sub2API could not list accounts." });
    }
    const readable = page.data.items.filter(
      (account) =>
        account.platform === "anthropic" &&
        (account.type === undefined || SUBSCRIPTION_TYPES.has(account.type)) &&
        account.status !== "disabled",
    );
    return yield* Effect.forEach(readable, (account) => readAccount(hub, account), {
      concurrency: 4,
    });
  });

  /** What `apiKey` has spent at the relay; undefined when the relay cannot tell. */
  const readWallet = Effect.fn("Sub2apiApi.readWallet")(function* (origin: string, apiKey: string) {
    return yield* client
      .execute(
        HttpClientRequest.get(new URL("/v1/usage", origin).toString()).pipe(
          HttpClientRequest.setHeader("Authorization", `Bearer ${apiKey}`),
        ),
      )
      .pipe(
        Effect.flatMap(HttpClientResponse.filterStatusOk),
        Effect.flatMap((response) => response.json),
        Effect.flatMap(decodeKeyUsage),
        Effect.timeout("15 seconds"),
        Effect.map(keyUsageToWallet),
        Effect.orElseSucceed(() => undefined),
      );
  });

  return { readAccounts, readWallet };
});
