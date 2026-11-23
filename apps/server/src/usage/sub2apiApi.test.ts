import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { HttpClient, HttpClientResponse } from "effect/http";

import { keyUsageToWallet, makeSub2apiApi } from "./sub2apiApi.ts";

const hub = { url: "https://relay.test:8443/", managementKey: "admin-secret" };

function fixture(usage: Record<string, unknown>) {
  const requests: Array<{ readonly url: string; readonly key: string | undefined }> = [];
  const http = HttpClient.make((request) =>
    Effect.sync(() => {
      requests.push({ url: request.url, key: request.headers["x-api-key"] });
      const path = new URL(request.url).pathname;
      const body =
        path === "/api/v1/admin/accounts"
          ? {
              code: 0,
              data: {
                items: [
                  { id: 1, name: "max@example.com", platform: "anthropic", type: "oauth" },
                  { id: 2, name: "pool-b", platform: "anthropic", type: "setup-token" },
                  { id: 3, name: "paid-key", platform: "anthropic", type: "apikey" },
                ],
              },
            }
          : path === "/api/v1/admin/accounts/2/usage"
            ? { code: 0, data: { five_hour: null, error: "upstream refused" } }
            : { code: 0, data: usage };
      return HttpClientResponse.fromWeb(request, Response.json(body));
    }),
  );
  return {
    requests,
    api: makeSub2apiApi.pipe(Effect.provideService(HttpClient.HttpClient, http)),
  };
}

describe("Sub2API admin usage", () => {
  it.effect("reads subscription windows of Claude accounts with the admin key", () =>
    Effect.gen(function* () {
      const test = fixture({
        five_hour: { utilization: 42, resets_at: "2099-01-01T05:00:00Z" },
        seven_day: { utilization: 61.5, resets_at: "2099-01-07T00:00:00Z" },
        seven_day_sonnet: { utilization: 12, resets_at: null },
        seven_day_fable: { utilization: 0, utilization_unknown: true, resets_at: null },
      });
      const accounts = yield* (yield* test.api).readAccounts(hub);

      expect(test.requests.every((request) => request.key === "admin-secret")).toBe(true);
      expect(test.requests.map((request) => new URL(request.url).pathname)).not.toContain(
        "/api/v1/admin/accounts/3/usage",
      );
      expect(accounts.map((account) => [account.id, account.email])).toEqual([
        ["max@example.com", "max@example.com"],
        ["pool-b", undefined],
      ]);
      expect(
        accounts[0]?.usageLimits.windows.map((window) => [window.id, window.usedPercent]),
      ).toEqual([
        ["five_hour", 42],
        ["seven_day", 61.5],
        ["seven_day_sonnet", 12],
      ]);
      expect(accounts[1]?.usageLimits.unavailable?.reason).toBe("probeFailed");
    }),
  );

  it.effect("reads what the Claude Code key spent, sending it only to the relay", () =>
    Effect.gen(function* () {
      const seen: Array<{ readonly url: string; readonly auth: string | undefined }> = [];
      const usage = {
        isValid: true,
        mode: "quota_limited",
        planName: "钱包余额",
        unit: "USD",
        balance: 12.5,
        usage: {
          today: { actual_cost: 4.25, cost: 5, requests: 70 },
          total: { actual_cost: 280.2, requests: 4232 },
        },
      };
      const http = HttpClient.make((request) =>
        Effect.sync(() => {
          seen.push({ url: request.url, auth: request.headers["authorization"] });
          return HttpClientResponse.fromWeb(request, Response.json(usage));
        }),
      );
      const api = yield* makeSub2apiApi.pipe(Effect.provideService(HttpClient.HttpClient, http));
      const wallet = yield* api.readWallet("https://relay.test:8443", "sk-user");

      expect(seen).toEqual([{ url: "https://relay.test:8443/v1/usage", auth: "Bearer sk-user" }]);
      expect(wallet).toEqual({
        plan: "钱包余额",
        unit: "USD",
        balance: 12.5,
        todayCost: 4.25,
        todayRequests: 70,
        totalCost: 280.2,
      });
      expect(keyUsageToWallet({ ...usage, mode: "unrestricted", balance: 0 })?.balance).toBe(
        undefined,
      );
      expect(keyUsageToWallet({ ...usage, isValid: false })).toBeUndefined();
    }),
  );
});
