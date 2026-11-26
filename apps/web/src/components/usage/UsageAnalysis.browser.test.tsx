import { useState } from "react";
import { expect, it, vi } from "vite-plus/test";
import { cdp, page, userEvent } from "vite-plus/test/browser";
import { render } from "../../../test/render";
import { testUiLocale } from "../../../test/uiLocale";
import { applyThemePalette } from "../../themePalette";
import {
  UsageProviderRows,
  UsageBreakdownCard,
  V9CostDashboard,
  V9TokensDashboard,
  providerTotals,
} from "./UsageAppleOverview";
import { UsageProviderChart } from "./UsageProviderChart";
import { UsageTokenChart } from "./UsageTokenChart";
import { UsageModelDialog } from "./UsageModelDialog";
import { UsageMotion } from "./UsageMotion";
import { analysisFixture, analysisHours } from "./usageAnalysis.fixture";
import {
  mergeUsageEnvironments,
  scopeUsageEnvironments,
  tokenPeriodTotals,
  toggleUsageFilter,
} from "./usageAnalysis";
import type { UsageProviderKind } from "@t3tools/contracts";
import { EnvironmentId, UsageDay } from "@t3tools/contracts";
import { useUsage } from "../../state/usage";
import "~/index.css";
import "./usagePresentation.css";

vi.mock(import("../../state/usage"), async (original) => ({
  ...(await original()),
  useUsage: vi.fn(),
}));

vi.mock(import("../../hooks/useTheme"), async (original) => ({
  ...(await original()),
  useTheme: (() => ({ theme: "apple" })) as never,
}));

function AnalysisFixture() {
  const [provider, setProvider] = useState<UsageProviderKind | null>(null);
  const [hour, setHour] = useState<string | null>(null);
  const all = analysisFixture();
  const scoped = scopeUsageEnvironments(all, new Set(), provider);
  const chart = mergeUsageEnvironments(scoped);
  const detail = mergeUsageEnvironments(scopeUsageEnvironments(scoped, new Set(), null, hour));
  return (
    <div data-usage-page data-apple-dashboard>
      <UsageProviderRows
        rows={providerTotals(mergeUsageEnvironments(all), ["codex", "claude"], "tokens")}
        metric="tokens"
        loadingProviders={new Set()}
        selectedProvider={provider}
        onSelectProvider={(picked) => setProvider((current) => toggleUsageFilter(current, picked))}
      />
      <output aria-label="筛选总量">{chart.totalTokens}</output>
      <UsageMotion replay={provider ?? "all"}>
        <UsageTokenChart
          periods={analysisHours}
          totals={tokenPeriodTotals(scoped, analysisHours, true)}
          formatPeriod={(period) => period.slice(11, 16)}
          selectedHour={hour}
          onSelectHour={(picked) => setHour((current) => toggleUsageFilter(current, picked))}
          hourly
        />
      </UsageMotion>
      <UsageBreakdownCard
        merged={detail}
        metric="tokens"
        hourly
        formatPeriod={(period) => period.slice(11, 16)}
        onSelectModel={() => {}}
        selectedHour={hour}
        onClearHour={() => setHour(null)}
      />
    </div>
  );
}
it("dims other providers, toggles off, shows real type tooltips, filters an hour and cancels", async () => {
  using _locale = testUiLocale("zh-CN");
  using _theme = appleTheme();
  await using screen = await render(<AnalysisFixture />);
  await userEvent.click(screen.getByRole("button", { name: /Codex/ }));
  await expect.element(screen.getByLabelText("筛选总量")).toHaveTextContent("2800");
  await expect
    .element(screen.getByRole("button", { name: /Claude Code/ }))
    .toHaveAttribute("data-dim");
  await userEvent.click(screen.getByRole("button", { name: /Codex/ }));
  await expect.element(screen.getByLabelText("筛选总量")).toHaveTextContent("5800");
  const bar = screen.getByRole("button", { name: /13:52，/ });
  await userEvent.hover(bar);
  expect(screen.container.querySelector(".usage-readout")?.textContent).toContain("1.60K");
  expect(screen.container.querySelector(".usage-readout")?.textContent).toContain("缓存写入");
  await userEvent.click(bar);
  await expect.element(screen.getByRole("button", { name: "取消小时筛选" })).toBeVisible();
  expect(screen.container.querySelectorAll(".usage-breakdown-table tbody tr")).toHaveLength(2);
  await userEvent.click(screen.getByRole("button", { name: "取消小时筛选" }));
  expect(screen.container.querySelectorAll(".usage-breakdown-table tbody tr")).toHaveLength(4);
});
it("keeps long values in separate columns inside a 560 px sheet and inherits orange in both appearances", async () => {
  using _locale = testUiLocale("zh-CN");
  const root = document.documentElement,
    theme = root.getAttribute("data-theme-id"),
    style = root.getAttribute("style"),
    wasDark = root.classList.contains("dark");
  try {
    applyThemePalette("apple", "light");
    const model = mergeUsageEnvironments(analysisFixture()).models[0]!;
    await using screen = await render(
      <UsageModelDialog
        model={{ ...model, costUsd: 5363.77, totalTokens: 3_190_000_000 }}
        environments={analysisFixture()}
        metric="tokens"
        chartWindow={{
          days: [],
          hours: analysisHours,
          resolution: "hour",
          timeZone: "UTC",
          referenceTime: analysisHours[1],
          hour12: false,
        }}
        onClose={() => {}}
        onSetPrice={() => {}}
      />,
    );
    const sheet = document.querySelector<HTMLElement>("[data-usage-sheet]")!;
    for (const animation of document.getAnimations()) animation.finish();
    expect(sheet.getBoundingClientRect().width).toBeLessThanOrEqual(560);
    const stats = [...sheet.querySelectorAll<HTMLElement>(".usage-model-stats > div")];
    for (const stat of stats) {
      const value = stat.querySelector("dd")!,
        rect = value.getBoundingClientRect(),
        column = stat.getBoundingClientRect();
      expect(rect.left).toBeGreaterThanOrEqual(column.left);
      expect(rect.right).toBeLessThanOrEqual(column.right);
      expect(value.scrollWidth).toBeLessThanOrEqual(value.clientWidth);
    }
    await expect.element(page.getByRole("button", { name: "调整价格…" })).toBeVisible();
    expect(sheet.querySelectorAll(".usage-model-stats dt")[0]?.textContent).toBe("令牌");
    for (const appearance of ["light", "dark"] as const) {
      applyThemePalette("apple", appearance);
      expect(getComputedStyle(sheet).getPropertyValue("--primary").trim()).toBe("#ff5a1f");
    }
    expect(screen.container).toBeDefined();
  } finally {
    if (theme === null) root.removeAttribute("data-theme-id");
    else root.setAttribute("data-theme-id", theme);
    if (style === null) root.removeAttribute("style");
    else root.setAttribute("style", style);
    root.classList.toggle("dark", wasDark);
  }
});
it("opens a model from any cell or the keyboard and expands beyond six items", async () => {
  using _locale = testUiLocale("zh-CN");
  const merged = mergeUsageEnvironments(analysisFixture()),
    onSelect = vi.fn();
  const models = Array.from({ length: 8 }, (_, rank) => ({
    ...merged.models[0]!,
    model: `model-${rank}`,
  }));
  await using screen = await render(
    <UsageBreakdownCard
      merged={{ ...merged, models }}
      metric="tokens"
      hourly
      formatPeriod={(value) => value}
      onSelectModel={onSelect}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: /还有 2 项/ }));
  expect(screen.container.querySelectorAll("tbody tr")).toHaveLength(8);
  const row = screen.getByRole("row", { name: "查看 model-7 模型详情" });
  await userEvent.click(row.getByRole("cell").last());
  expect(onSelect).toHaveBeenCalledWith(`${models[7]!.provider}:model-7`);
  (row.element() as HTMLElement).focus();
  await userEvent.keyboard("{Enter}");
  expect(onSelect).toHaveBeenCalledTimes(2);
});

function appleTheme() {
  const root = document.documentElement,
    theme = root.getAttribute("data-theme-id"),
    style = root.getAttribute("style"),
    dark = root.classList.contains("dark");
  applyThemePalette("apple", "light");
  return {
    [Symbol.dispose]() {
      if (theme === null) root.removeAttribute("data-theme-id");
      else root.setAttribute("data-theme-id", theme);
      if (style === null) root.removeAttribute("style");
      else root.setAttribute("style", style);
      root.classList.toggle("dark", dark);
    },
  };
}

it("tracks current and previous cost values with dots and the absolute previous figure", async () => {
  using _locale = testUiLocale("zh-CN");
  using _theme = appleTheme();
  const merged = mergeUsageEnvironments(analysisFixture());
  await using screen = await render(
    <UsageProviderChart
      totalOnly
      previous={merged}
      previousWindow={{
        sinceDay: "2026-11-16" as never,
        untilDay: "2026-11-16" as never,
        timeZone: "UTC",
        resolution: "hour",
        sinceTime: analysisHours[0],
        untilTime: "2026-11-16T15:52:00.000Z",
      }}
      providers={["codex", "claude"]}
      days={[]}
      daily={merged.daily}
      hours={analysisHours}
      hourly={merged.hourly}
      metric="cost"
      referenceTime={analysisHours[1]}
      resolution="hour"
      timeZone="UTC"
      hour12={false}
    />,
  );
  await userEvent.hover(screen.getByRole("img", { name: "费用趋势，可悬停查看时段明细" }));
  expect(screen.container.querySelectorAll("[data-usage-hover]")).toHaveLength(2);
  await expect.element(screen.getByText("$6.00 · 前一时段", { exact: true })).toBeVisible();
});

it("draws the cost total as one bar per period in the V9 bar style", async () => {
  using _theme = appleTheme();
  const merged = mergeUsageEnvironments(analysisFixture());
  await using screen = await render(
    <UsageProviderChart
      totalOnly
      chartStyle="bar"
      providers={["codex", "claude"]}
      days={[]}
      daily={merged.daily}
      hours={analysisHours}
      hourly={merged.hourly}
      metric="cost"
      referenceTime={analysisHours[1]}
      resolution="hour"
      timeZone="UTC"
      hour12={false}
    />,
  );
  const bars = screen.container.querySelectorAll("[data-usage-total-bars] rect");
  expect(bars).toHaveLength(analysisHours.length);
  // Bars replace the filled curve rather than drawing on top of it.
  expect(screen.container.querySelector('path[fill="url(#usage-total-fill)"]')).toBeNull();
  for (const bar of bars) {
    expect(Number(bar.getAttribute("x"))).toBeGreaterThanOrEqual(0);
    expect(Number(bar.getAttribute("height"))).toBeGreaterThanOrEqual(0);
  }
});

function V9CostFixture() {
  const envs = analysisFixture();
  const merged = mergeUsageEnvironments(envs);
  const [style, setStyle] = useState<"bar" | "area">("bar");
  const [provider, setProvider] = useState<UsageProviderKind | null>(null);
  const [period, setPeriod] = useState<string | null>(null);
  return (
    <V9CostDashboard
      merged={merged}
      previous={merged}
      selectedEnvironments={envs}
      priorEnvironments={envs}
      environmentIds={new Set([EnvironmentId.make("test")])}
      hiddenProviders={new Set()}
      rankedProviders={["codex", "claude"]}
      shownWindow={{
        sinceDay: UsageDay.make("2026-11-16"),
        untilDay: UsageDay.make("2026-11-16"),
        timeZone: "UTC",
        resolution: "hour",
        sinceTime: analysisHours[0],
        untilTime: "2026-11-16T15:52:00.000Z",
      }}
      periods={analysisHours}
      hourly
      formatPeriod={(p) => p.slice(11, 16)}
      windowDays={1}
      periodOptions={[
        { days: 1, label: "24 小时" },
        { days: 7, label: "7 天" },
      ]}
      onSelectWindow={() => {}}
      chartStyle={style}
      onChangeChartStyle={setStyle}
      selectedProvider={provider}
      onSelectProvider={setProvider}
      selectedPeriod={period}
      onSelectPeriod={setPeriod}
      onSelectModel={() => {}}
      heatmapReferenceTime="2026-11-16T16:00:00.000Z"
    />
  );
}

function V9TokensFixture({
  onSelectModel,
  withThroughput = false,
}: {
  readonly onSelectModel: (key: string) => void;
  readonly withThroughput?: boolean;
}) {
  const baseEnvs = analysisFixture();
  const envs = withThroughput
    ? baseEnvs.map((env) =>
        env.summary
          ? {
              ...env,
              summary: {
                ...env.summary,
                throughput: [
                  {
                    provider: "codex" as const,
                    model: "codex-0",
                    outputTokens: 800,
                    modelMs: 10_000,
                    turns: 6,
                  },
                  {
                    provider: "claude" as const,
                    model: "claude-0",
                    outputTokens: 560,
                    modelMs: 10_000,
                    turns: 4,
                  },
                ],
              },
            }
          : env,
      )
    : baseEnvs;
  const merged = mergeUsageEnvironments(envs);
  const [provider, setProvider] = useState<UsageProviderKind | null>(null);
  const [period, setPeriod] = useState<string | null>(null);
  const scoped = scopeUsageEnvironments(envs, new Set(), provider);
  return (
    <V9TokensDashboard
      merged={merged}
      selectedEnvironments={envs}
      environmentIds={new Set([EnvironmentId.make("test")])}
      hiddenProviders={new Set()}
      rankedProviders={["codex", "claude"]}
      periods={analysisHours}
      periodTotals={tokenPeriodTotals(scoped, analysisHours, true)}
      hourly
      formatPeriod={(p) => p.slice(11, 16)}
      windowDays={1}
      periodOptions={[
        { days: 1, label: "24 小时" },
        { days: 7, label: "7 天" },
      ]}
      onSelectWindow={() => {}}
      selectedProvider={provider}
      onSelectProvider={setProvider}
      selectedPeriod={period}
      onSelectPeriod={setPeriod}
      onSelectModel={onSelectModel}
      heatmapReferenceTime="2026-11-16T16:00:00.000Z"
    />
  );
}

it("renders V9 cost page with bar/area toggle, provider drill-down, beUI insight fold, and rank tabs", async () => {
  using _locale = testUiLocale("zh-CN");
  using _theme = appleTheme();
  const envs = analysisFixture();
  vi.mocked(useUsage).mockReturnValue({
    merged: mergeUsageEnvironments(envs),
    environments: envs,
    selectedEnvironments: envs,
    isPending: false,
    isPartial: false,
    shown: null,
    refresh: vi.fn(async () => {}),
  });
  try {
    await using screen = await render(<V9CostFixture />);
    expect(screen.container.querySelector("[data-v9-cost-bars]")).not.toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "面积图" }));
    expect(screen.container.querySelector("[data-v9-cost-area]")).not.toBeNull();
    expect(screen.container.querySelector("[data-v9-cost-bars]")).toBeNull();

    // Provider row selection uses neutral surface (data-sel) and dims siblings (data-dim).
    const codexRow = screen.container.querySelector<HTMLButtonElement>('[data-ctv9="prov-row"]')!;
    await userEvent.click(codexRow);
    expect(codexRow.getAttribute("data-sel")).toBe("true");
    expect(
      screen.container.querySelectorAll('[data-ctv9="prov-row"][data-dim="true"]'),
    ).toHaveLength(1);
    await expect.element(screen.getByRole("button", { name: "恢复全量" })).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "恢复全量" }));
    expect(
      screen.container.querySelectorAll('[data-ctv9="prov-row"][data-dim="true"]'),
    ).toHaveLength(0);

    // beUI insight folds smoothly via data-open toggle.
    const insight = screen.container.querySelector<HTMLElement>('[data-ctv9="beui-insight"]')!;
    expect(insight.getAttribute("data-open")).toBe("true");
    await userEvent.click(
      screen.container.querySelector<HTMLButtonElement>('[data-ctv9="beui-insight-head"]')!,
    );
    expect(insight.getAttribute("data-open")).toBeNull();

    // Ranking tabs switch between model, project, and peak hours.
    await userEvent.click(screen.getByRole("button", { name: "按项目" }));
    expect(
      screen.container.querySelectorAll('[data-ctv9="rank-table"] tbody tr').length,
    ).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole("button", { name: "按高峰小时" }));
    expect(screen.container.querySelectorAll('[data-ctv9="rank-table"] tbody tr')).toHaveLength(2);
  } finally {
    vi.mocked(useUsage).mockReset();
  }
});

// The fixture's hours sit near UTC day boundaries, so a far-off host zone reshuffles the grid.
async function pinUtcZone(): Promise<AsyncDisposable> {
  const session = cdp();
  await session.send("Emulation.setTimezoneOverride", { timezoneId: "UTC" });
  return {
    [Symbol.asyncDispose]: async () => {
      await session.send("Emulation.setTimezoneOverride", { timezoneId: "" });
    },
  };
}

it("renders V9 tokens page with 3-layer stacked bars, half-ring gauge, 7x24 dot states, and model details", async () => {
  await using _zone = await pinUtcZone();
  using _locale = testUiLocale("zh-CN");
  using _theme = appleTheme();
  const envs = analysisFixture();
  vi.mocked(useUsage).mockReturnValue({
    merged: mergeUsageEnvironments(envs),
    environments: envs,
    selectedEnvironments: envs,
    isPending: false,
    isPartial: false,
    shown: null,
    refresh: vi.fn(async () => {}),
  });
  const onSelectModel = vi.fn();
  try {
    await using screen = await render(<V9TokensFixture onSelectModel={onSelectModel} />);
    expect(
      screen.container.querySelectorAll("[data-v9-token-bars] [data-ctv9='chart-col-g']"),
    ).toHaveLength(2);
    expect(screen.container.querySelector('[data-ctv9="tok-cache-arc"]')).not.toBeNull();
    expect(screen.container.querySelectorAll('[data-ctv9="io-ratio-bar"]')).toHaveLength(2);
    expect(screen.container.querySelector('[data-hm-state="missing"]')).not.toBeNull();
    expect(screen.container.querySelector('[data-hm-state="zero"]')).not.toBeNull();
    expect(screen.container.querySelector('[data-hm-state="active"]')).not.toBeNull();

    const firstModelRow = screen.container.querySelector<HTMLTableRowElement>(
      '[data-ctv9="rank-table"] tbody tr',
    )!;
    await userEvent.click(firstModelRow);
    expect(onSelectModel).toHaveBeenCalledOnce();

    // Without server throughput (legacy server), hero subline omits throughput and rows show "—" with tooltip.
    const subline = screen.container.querySelector("[data-v9-tokens-subline]")!;
    expect(subline.textContent).not.toContain("tok/s");
    expect(subline.textContent).not.toContain("令牌/秒");
    const emptyThroughput = screen.container.querySelectorAll('[data-v9-prov-throughput="empty"]');
    expect(emptyThroughput).toHaveLength(2);
    expect(emptyThroughput[0]?.textContent).toBe("\u2014");
    expect(emptyThroughput[0]?.getAttribute("aria-label")).toBeTruthy();
  } finally {
    vi.mocked(useUsage).mockReset();
  }
});

it("shows overall and per-provider throughput rates on V9 tokens page when server reports throughput", async () => {
  using _locale = testUiLocale("zh-CN");
  using _theme = appleTheme();
  const envs = analysisFixture();
  vi.mocked(useUsage).mockReturnValue({
    merged: mergeUsageEnvironments(envs),
    environments: envs,
    selectedEnvironments: envs,
    isPending: false,
    isPartial: false,
    shown: null,
    refresh: vi.fn(async () => {}),
  });
  try {
    await using screen = await render(<V9TokensFixture onSelectModel={() => {}} withThroughput />);
    // Combined: (800 + 560) / 20s = 68 tok/s.
    const subline = screen.container.querySelector("[data-v9-tokens-subline]")!;
    expect(subline.textContent).toContain("68");
    const provRates = [
      ...screen.container.querySelectorAll<HTMLElement>("[data-v9-prov-throughput]"),
    ].map((el) => el.textContent);
    expect(provRates).toEqual(["80 令牌/秒", "56 令牌/秒"]);
  } finally {
    vi.mocked(useUsage).mockReset();
  }
});
