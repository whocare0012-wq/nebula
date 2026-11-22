import { formatPercent, formatTokens } from "@t3tools/shared/usageFormat";
import { formatUsd } from "./usageMoney";
import { uiText } from "~/i18n";
import type { UsageMetric } from "./usageShortcuts";

export function usageMetricPresentation(
  metric: UsageMetric,
  totals: {
    readonly costUsd: number;
    readonly totalTokens: number;
    readonly costShare?: number;
    readonly tokenShare?: number;
  },
) {
  const isCost = metric === "cost";
  return {
    isCost,
    value: isCost ? formatUsd(totals.costUsd) : formatTokens(totals.totalTokens),
    share: isCost
      ? uiText("{0} of cost · {1} tokens", {
          "0": formatPercent(totals.costShare ?? 0),
          "1": formatTokens(totals.totalTokens),
        })
      : uiText("{0} of tokens · {1}", {
          "0": formatPercent(totals.tokenShare ?? 0),
          "1": formatUsd(totals.costUsd),
        }),
  };
}

export function usageTableHeaders(metric: UsageMetric) {
  return {
    primary: uiText(metric === "tokens" ? "Processed tokens" : "Cost"),
    secondary: uiText(metric === "tokens" ? "Output" : "Tokens"),
  };
}
