import { uiText as copy } from "~/i18n";
import { UsageBusiestHour } from "./UsageBusiestHour";

import { useUsageDateFormat } from "./useUsageDateFormat";
import { UsageModelBars } from "./UsageModelBars";
import { useTheme } from "../../hooks/useTheme";
import { UsageDetailsSheet } from "./UsageDetailsSheet";
import { UsageCount } from "./UsageMotion";
import { useUiText } from "~/i18n/useUiText";
import { formatPercent, formatTokens } from "@t3tools/shared/usageFormat";
import { formatUsd } from "./usageMoney";
import { isModelCostUnknown, type ModelTotals } from "@t3tools/shared/usageMerge";

import { mergeAnsweredUsage, type EnvironmentUsageStatus } from "../../state/usage";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { UsageProviderChart, type UsageChartMetric } from "./UsageProviderChart";
import { UsageShareBar } from "./UsageShareBar";
import {
  cacheHitRate,
  costPerMillionTokens,
  costTypeSegments,
  speedCostSegments,
  tokenTypeSegments,
} from "./usageBreakdown";
import { PROVIDER_PRESENTATION } from "./usageProviders";

export interface UsageChartWindow {
  readonly periodLabel?: string;
  readonly selectedHour?: string | null;
  readonly days: readonly string[];
  readonly hours: readonly string[];
  readonly resolution: "day" | "hour";
  readonly timeZone: string;
  readonly referenceTime: string | undefined;
  readonly hour12: boolean;
}

export function UsageModelDialog({
  model,
  environments,
  metric,
  chartWindow,
  onSetPrice,
  onClose,
}: {
  readonly model: ModelTotals;
  readonly environments: readonly EnvironmentUsageStatus[];
  readonly metric: UsageChartMetric;
  readonly chartWindow: UsageChartWindow;
  readonly onSetPrice: () => void;
  readonly onClose: () => void;
}) {
  const uiText = useUiText();
  const { theme } = useTheme();
  const dateFormat = useUsageDateFormat();
  const usage = mergeAnsweredUsage(
    environments,
    (bucket) => bucket.provider === model.provider && bucket.model === model.model,
  );
  const providers = [model.provider];
  const presentation = PROVIDER_PRESENTATION[model.provider];
  const costUnknown = isModelCostUnknown(model);
  const hitRate = cacheHitRate(model);
  const perMillion = costPerMillionTokens(model);
  const stats = [
    {
      label: "Cost",
      value: costUnknown ? "Unpriced" : formatUsd(model.costUsd),
      number: costUnknown ? null : model.costUsd,
      format: formatUsd,
    },
    {
      label: "Tokens",
      value: formatTokens(model.totalTokens),
      number: model.totalTokens,
      format: formatTokens,
    },
    perMillion === null
      ? null
      : {
          label: "Per 1M tokens",
          value: formatUsd(perMillion),
          number: perMillion,
          format: formatUsd,
        },
    hitRate === null
      ? null
      : {
          label: "Cache hit",
          value: formatPercent(hitRate),
          number: hitRate,
          format: formatPercent,
        },
  ].filter((stat) => stat !== null);

  const busiest = usage.hourly.toSorted((a, b) => b.totalTokens - a.totalTokens)[0];
  const appleStats = [
    {
      label: copy("Tokens"),
      value: formatTokens(model.totalTokens),
      number: model.totalTokens,
      format: formatTokens,
    },
    {
      label: copy("Estimated cost"),
      value: costUnknown ? copy("Unpriced") : formatUsd(model.costUsd),
      number: costUnknown ? null : model.costUsd,
      format: formatUsd,
    },
    {
      label: copy("Share of tokens"),
      value: formatPercent(model.tokenShare),
      number: model.tokenShare,
      format: formatPercent,
    },
    {
      label: copy("Peak hour"),
      value:
        busiest && busiest.totalTokens > 0 ? (
          dateFormat.formatHourShort(busiest.hourStart, chartWindow.timeZone, chartWindow.hour12)
        ) : chartWindow.resolution === "day" ? (
          <UsageBusiestHour
            key={`${model.provider}:${model.model}:${chartWindow.days[0]}:${chartWindow.days.at(-1)}`}
            days={chartWindow.days}
            timeZone={chartWindow.timeZone}
            hour12={chartWindow.hour12}
            model={model}
            environments={environments}
          />
        ) : (
          copy("No hourly usage")
        ),
      number: null,
      format: formatTokens,
    },
  ];
  const period =
    chartWindow.periodLabel ??
    (chartWindow.resolution === "hour"
      ? copy("Last 24 hours")
      : copy("Last {count} days", { count: chartWindow.days.length }));
  const share =
    metric === "tokens"
      ? copy("{value} of tokens", { value: formatPercent(model.tokenShare) })
      : costUnknown
        ? copy("Unpriced")
        : copy("{value} of cost", { value: formatPercent(model.costShare) });

  if (theme === "apple")
    return (
      <UsageDetailsSheet
        open
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
        title={model.model}
        description={`${presentation.label} · ${period} · ${share}`}
      >
        <div className="flex min-w-0 flex-col gap-4">
          <dl className="usage-model-stats">
            {appleStats.map((stat) => (
              <div key={stat.label} className="flex min-w-0 flex-col gap-0.5">
                <dt className="text-xs text-muted-foreground">{uiText(stat.label)}</dt>
                <dd>
                  {stat.number === null ? (
                    <span data-text-stat>{stat.value}</span>
                  ) : (
                    <UsageCount value={stat.number} format={stat.format} />
                  )}
                </dd>
              </div>
            ))}
          </dl>

          {/* Unpriced cost is unknown, not zero, so its trend shows tokens. */}
          <UsageModelBars
            usage={usage}
            window={chartWindow}
            metric={costUnknown ? "tokens" : metric}
          />

          <section className="usage-analysis-panel">
            <div className="usage-type-table" role="table" aria-label={uiText("Tokens and costs")}>
              <div role="row" className="usage-type-row usage-type-head">
                <span>{uiText("Type")}</span>
                <span>{uiText("Share of tokens")}</span>
                <span>{uiText("Tokens")}</span>
                <span>{uiText("Cost")}</span>
              </div>
              {tokenTypeSegments(model.tokens)
                .map((row) => ({
                  ...row,
                  cost:
                    costTypeSegments(usage.categoryCost).find((cost) => cost.label === row.label)
                      ?.value ?? 0,
                }))
                .filter((row) => row.value > 0 || row.cost > 0)
                .toSorted((a, b) => b.value - a.value)
                .map((row) => (
                  <div role="row" className="usage-type-row" key={row.label}>
                    <span>{row.label}</span>
                    <span className="usage-type-track">
                      <i
                        style={{
                          width: `${Math.max(1.5, model.totalTokens > 0 ? (row.value / model.totalTokens) * 100 : 0)}%`,
                        }}
                      />
                    </span>
                    <span>{formatTokens(row.value)}</span>
                    <span>{costUnknown ? uiText("Unpriced") : formatUsd(row.cost)}</span>
                  </div>
                ))}
              {usage.categoryCost.unsplit > 0 ? (
                <div role="row" className="usage-type-row">
                  <span>{uiText("Unallocated")}</span>
                  <span />
                  <span>–</span>
                  <span>{formatUsd(usage.categoryCost.unsplit)}</span>
                </div>
              ) : null}
            </div>
          </section>
          {usage.speedCost.fast + usage.speedCost.ultrafast > 0 ? (
            <UsageShareBar
              label="Cost by speed"
              segments={speedCostSegments(usage.speedCost)}
              format={formatUsd}
              aside={<SpeedPremium premiumUsd={usage.speedCost.premium} />}
            />
          ) : null}
        </div>

        <div className="usage-model-price-entry">
          <span className="usage-model-secondary">
            {copy("{price} per million tokens · {rate} cache hit rate", {
              price: perMillion === null ? uiText("Unpriced") : formatUsd(perMillion),
              rate: hitRate === null ? uiText("No data yet") : formatPercent(hitRate),
            })}
          </span>
          <Button variant="outline" size="sm" onClick={onSetPrice}>
            {uiText("Edit pricing…")}
          </Button>
        </div>
        {model.unpricedTokens > 0 ? (
          <p className="usage-model-secondary">
            {copy("{count} unpriced tokens", { count: formatTokens(model.unpricedTokens) })}
          </p>
        ) : null}
      </UsageDetailsSheet>
    );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPopup data-usage-dialog className="max-w-3xl">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <ProviderInstanceIcon
              driverKind={presentation.driverKind}
              displayName={presentation.label}
              iconClassName="size-5"
            />
            <DialogTitle>{model.model}</DialogTitle>
          </div>
          <DialogDescription>
            {presentation.label}
            {costUnknown ? "" : ` · ${formatPercent(model.costShare)} of cost`}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="flex flex-col gap-8">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
              {stats.map((stat) => (
                <div key={stat.label} className="flex min-w-0 flex-col gap-0.5">
                  <dt className="text-xs text-muted-foreground">{uiText(stat.label)}</dt>
                  <dd className="text-2xl font-semibold text-foreground">{stat.value}</dd>
                </div>
              ))}
            </dl>

            {/* Unpriced cost is unknown, not zero, so its trend shows tokens. */}
            <UsageProviderChart
              providers={providers}
              days={chartWindow.days}
              daily={usage.daily}
              hours={chartWindow.hours}
              hourly={usage.hourly}
              metric={costUnknown ? "tokens" : metric}
              referenceTime={chartWindow.referenceTime}
              resolution={chartWindow.resolution}
              timeZone={chartWindow.timeZone}
              hour12={chartWindow.hour12}
            />

            <div className="grid gap-x-10 gap-y-8 sm:grid-cols-2">
              {costUnknown ? null : (
                <UsageShareBar
                  label="Cost by type"
                  segments={costTypeSegments(usage.categoryCost)}
                  format={formatUsd}
                />
              )}
              <UsageShareBar
                label="Tokens by type"
                segments={tokenTypeSegments(model.tokens)}
                format={formatTokens}
              />
              {usage.speedCost.fast + usage.speedCost.ultrafast > 0 ? (
                <UsageShareBar
                  label="Cost by speed"
                  segments={speedCostSegments(usage.speedCost)}
                  format={formatUsd}
                  aside={<SpeedPremium premiumUsd={usage.speedCost.premium} />}
                />
              ) : null}
            </div>
          </div>
        </DialogPanel>
        {model.unpricedTokens > 0 ? (
          <DialogFooter variant="bare" className="items-center sm:justify-between">
            <span className="text-xs text-muted-foreground">
              {formatTokens(model.unpricedTokens)}
              {uiText("tokens have no known price")}
            </span>
            <Button onClick={onSetPrice}>{uiText("Set price")}</Button>
          </DialogFooter>
        ) : null}
      </DialogPopup>
    </Dialog>
  );
}

export function SpeedPremium({ premiumUsd }: { readonly premiumUsd: number }) {
  const uiText = useUiText();
  return (
    <span className="text-xs text-muted-foreground">
      {uiText("Premium")}
      <span className="text-foreground tabular-nums">{formatUsd(premiumUsd)}</span>
    </span>
  );
}
