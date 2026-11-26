import { expect, it, vi } from "vite-plus/test";
import { cdp, page, userEvent } from "vite-plus/test/browser";
import { ProviderDriverKind } from "@t3tools/contracts";
import { collectLimitPools, type LimitAccount } from "@t3tools/shared/usageLimits";
import { render } from "../../../test/render";
import { testUiLocale } from "../../../test/uiLocale";
import { applyThemePalette } from "../../themePalette";
import { useUsage } from "../../state/usage";
import { UsageActivityHeatmap } from "./UsageAppleOverview";
import { UsageBusiestHour } from "./UsageBusiestHour";
import { UsageLimitRings } from "./UsageLimitRings";
import { quotaForecast } from "./usageQuotaPresentation";
import { mergeUsageEnvironments } from "./usageAnalysis";
import { analysisFixture } from "./usageAnalysis.fixture";
import "~/index.css";
import "./usagePresentation.css";

vi.mock(import("../../state/usage"), async (original) => ({
  ...(await original()),
  useUsage: vi.fn(),
}));

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

it("opens real activity details, switches between heatmap and distributions, and closes with Escape", async () => {
  await using _zone = await pinUtcZone();
  using _locale = testUiLocale("zh-CN");
  using _theme = appleTheme();
  try {
    const environments = analysisFixture();
    vi.mocked(useUsage).mockReturnValue({
      merged: mergeUsageEnvironments(environments),
      environments,
      selectedEnvironments: environments,
      isPending: false,
      isPartial: false,
      shown: null,
      refresh: vi.fn(async () => {}),
    });
    await using screen = await render(
      <UsageActivityHeatmap
        environmentIds={new Set(environments.map((env) => env.environmentId))}
        hiddenProviders={new Set()}
        referenceTime="2026-11-17T16:00:00Z"
        metric="tokens"
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "展开" }));
    const dialog = page.getByRole("dialog");
    await expect
      .element(dialog.getByRole("img", { name: "最近 7 天真实每小时用量热力格" }))
      .toBeVisible();
    await expect.element(dialog.getByText("5.80K", { exact: true }).first()).toBeVisible();
    await userEvent.click(dialog.getByRole("button", { name: "按星期", exact: true }));
    await expect
      .element(dialog.getByRole("img", { name: "最近 7 天真实每小时用量热力格", exact: true }))
      .toBeVisible();
    await expect.element(dialog.getByText("按星期", { exact: true })).toBeVisible();
    await expect.element(dialog.getByText("一天节奏", { exact: true })).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await expect.element(dialog).not.toBeInTheDocument();
  } finally {
    vi.mocked(useUsage).mockReset();
  }
});
it("opens the whole quota card without intercepting child actions and shows every real window", async () => {
  using _locale = testUiLocale("zh-CN");
  using _theme = appleTheme();
  const now = Date.parse("2026-11-17T16:00:00Z");
  const windows = [
    {
      id: "weekly",
      kind: "weekly" as const,
      label: "Weekly",
      usedPercent: 80,
      windowDurationMins: 1000,
      resetsAt: new Date(now + (1 - 0.1837) * 1000 * 60_000).toISOString(),
    },
    {
      id: "session",
      kind: "session" as const,
      label: "5-hour",
      usedPercent: 15,
      windowDurationMins: 300,
      resetsAt: new Date(now + 150 * 60_000).toISOString(),
    },
  ];
  const account: LimitAccount = {
    key: "test",
    driver: ProviderDriverKind.make("codex"),
    displayName: "Codex",
    email: undefined,
    plan: "Pro",
    accentColor: undefined,
    environments: [],
    sourceLabel: null,
    redeem: null,
    limits: { checkedAt: new Date(now).toISOString(), windows },
  };
  const pool = collectLimitPools([account], now)[0]!,
    onAction = vi.fn();
  await using screen = await render(
    <section data-usage-card className="usage-limit-ring-card">
      <UsageLimitRings pool={pool} now={now} label="Codex">
        <button type="button" onClick={onAction}>
          独立操作
        </button>
      </UsageLimitRings>
    </section>,
  );
  await userEvent.click(screen.getByRole("button", { name: "独立操作" }));
  expect(onAction).toHaveBeenCalledOnce();
  expect(page.getByRole("dialog").elements()).toHaveLength(0);
  const trigger = screen.getByRole("button", { name: "查看 Codex 全部额度窗口" });
  (trigger.element() as HTMLElement).focus();
  await userEvent.keyboard("{Enter}");
  const dialog = page.getByRole("dialog");
  await expect.element(dialog).toBeVisible();
  expect(dialog.element().querySelectorAll(".usage-burndown")).toHaveLength(2);
  expect(dialog.element().querySelector("[data-run-out-at]")?.getAttribute("data-run-out-at")).toBe(
    String(quotaForecast(windows[0]!, now).runOutAt),
  );
  expect(dialog.element().querySelector("[data-usage-runout]")).not.toBeNull();
  await expect.element(dialog.getByText("100%", { exact: true }).first()).toBeVisible();
});

it("finds the busiest hour from serial real readings across a long range", async () => {
  const environments = analysisFixture();
  vi.mocked(useUsage).mockImplementation((input) => {
    const first = input.sinceTime === "2026-11-01T00:00:00.000Z";
    const base = analysisFixture()[0]!;
    const bucket = base.summary!.buckets[0]!;
    const data = [
      {
        ...base,
        summary: {
          ...base.summary!,
          buckets: [
            {
              ...bucket,
              hourStart: first ? "2026-11-01T01:00:00Z" : "2026-11-08T02:00:00Z",
              totals: { ...bucket.totals, uncachedInputTokens: first ? 1000 : 9000 },
            },
          ],
        },
      },
    ];
    return {
      merged: mergeUsageEnvironments(data),
      environments: data,
      selectedEnvironments: data,
      isPending: false,
      isPartial: false,
      shown: null,
      refresh: vi.fn(async () => {}),
    };
  });
  await using screen = await render(
    <UsageBusiestHour
      days={["2026-11-01", "2026-11-08"]}
      timeZone="UTC"
      hour12={false}
      model={mergeUsageEnvironments(environments).models.find(
        (model) => model.model === "codex-0",
      )!}
      environments={environments}
    />,
  );
  await expect.element(screen.getByText("02:00", { exact: true })).toBeVisible();
  expect(new Set(vi.mocked(useUsage).mock.calls.map((call) => call[0].sinceTime))).toEqual(
    new Set(["2026-11-01T00:00:00.000Z", "2026-11-08T00:00:00.000Z"]),
  );
});
