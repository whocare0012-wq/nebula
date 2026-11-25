import {
  collectHttpQuotaSources,
  type LimitPresentations,
  remainingPercent,
} from "@t3tools/shared/usageLimits";
import { formatResetsIn } from "@t3tools/shared/usageLimitsCopy";

import { useUiText } from "~/i18n/useUiText";

/** Quotas read from the HTTP quota sources configured in Settings → Usage providers. */
export function HttpQuotaSources({
  presentations,
  now,
}: {
  readonly presentations: LimitPresentations;
  readonly now: number;
}) {
  const uiText = useUiText();
  const sources = collectHttpQuotaSources(presentations);
  if (sources.length === 0) return null;
  return (
    <>
      {sources.map((source) => (
        <section
          key={source.key}
          data-usage-http-quota-source
          className="space-y-3 rounded-xl border p-4"
        >
          <h2 className="text-sm font-medium">{source.label}</h2>
          {source.quotaAccounts?.map((account) => (
            <div key={account.id} className="space-y-1">
              <h3 className="text-sm font-medium">{account.label}</h3>
              {account.windows.map((window) => {
                const reset = formatResetsIn(window, now);
                return (
                  <div
                    key={window.id}
                    className="flex justify-between gap-3 text-sm text-muted-foreground"
                  >
                    <span>{window.label}</span>
                    <span className="tabular-nums">
                      {uiText("{remaining}% left", { remaining: remainingPercent(window) })}
                      {reset ? ` · ${reset}` : ""}
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
        </section>
      ))}
    </>
  );
}
