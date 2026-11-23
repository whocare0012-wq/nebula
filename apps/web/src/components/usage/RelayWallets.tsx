import type { LimitPresentations } from "@t3tools/shared/usageLimits";
import type { UsageLimitSourceWallet } from "@t3tools/contracts";

import { useUiText } from "~/i18n/useUiText";
import { formatUsd, useUsageCurrencyKey } from "./usageMoney";

function formatAmount(wallet: UsageLimitSourceWallet, value: number): string {
  return !wallet.unit || wallet.unit.toUpperCase() === "USD"
    ? formatUsd(value)
    : `${value.toFixed(2)} ${wallet.unit}`;
}

/** What the key Claude Code sends through each Sub2API relay has spent there. */
export function RelayWallets({ presentations }: { readonly presentations: LimitPresentations }) {
  const uiText = useUiText();
  useUsageCurrencyKey();
  const seen = new Set<string>();
  const wallets = [...presentations.values()].flatMap((presentation) =>
    (presentation.serverConfig?.usageLimitSources ?? []).flatMap((source) => {
      const key = source.origin ?? source.id;
      if (!source.wallet || seen.has(key)) return [];
      seen.add(key);
      return [{ key, label: source.label, wallet: source.wallet }];
    }),
  );
  if (wallets.length === 0) return null;
  return (
    <ul data-usage-relay-wallets className="space-y-1">
      {wallets.map(({ key, label, wallet }) => (
        <li
          key={key}
          className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
        >
          <span className="font-medium text-foreground">
            {uiText("{relay} key spend", { relay: label })}
          </span>
          <span className="tabular-nums">
            {wallet.balance === undefined
              ? uiText("Not charged to a balance")
              : uiText("Balance {amount}", { amount: formatAmount(wallet, wallet.balance) })}
          </span>
          <span className="tabular-nums">
            {uiText("Today {amount} · {count} requests", {
              amount: formatAmount(wallet, wallet.todayCost),
              count: wallet.todayRequests.toLocaleString(),
            })}
          </span>
          <span className="tabular-nums">
            {uiText("Total {amount}", { amount: formatAmount(wallet, wallet.totalCost) })}
          </span>
        </li>
      ))}
    </ul>
  );
}
