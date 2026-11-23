import { EnvironmentId, RunId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import { GTProvider } from "gt-react";
import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import { act, fakeTimers, render } from "../../../test/render";
import zh from "../../i18n/translations/zh.json";
import { makeThreadProjectionFixture } from "../../test-fixtures";
import { SessionStatsBar } from "./SessionStatsBar";
import "~/index.css";

vi.mock("../../state/threads", () => ({
  useEnvironmentThread: () => ({ data: Option.none() }),
}));

const start = DateTime.makeUnsafe(1_000);
const finish = DateTime.makeUnsafe(31_000);
const env = EnvironmentId.make("session-stats-fixture");

function projection(finished: boolean) {
  const fixture = makeThreadProjectionFixture();
  const id = RunId.make("run-1");
  return {
    ...fixture,
    runs: [
      {
        id,
        ordinal: 1,
        providerInstanceId: "codex",
        modelSelection: { model: "test-model" },
        status: finished ? "completed" : "running",
        startedAt: start,
        requestedAt: start,
        completedAt: finished ? finish : null,
      },
    ],
    providerTurns: finished
      ? [
          {
            startedAt: start,
            completedAt: finish,
            turnTokenUsage: {
              usageStatus: "complete",
              inputTokens: 500,
              cachedInputTokens: 400,
              outputTokens: 300,
            },
          },
        ]
      : [],
    turnItems: [{ type: "subagent", status: "running", runId: id }],
  } as unknown as ReturnType<typeof makeThreadProjectionFixture>;
}

function bar(data: ReturnType<typeof projection>, locale: "en" | "zh", disconnected = false) {
  return (
    <GTProvider locale={locale} translations={{ zh, en: {} } as never}>
      <SessionStatsBar
        projection={data}
        environmentId={env}
        threadId={data.thread.id}
        itemCount={1}
        disconnected={disconnected}
      />
    </GTProvider>
  );
}

it("shows the first active round with no usage and stops the clock when hidden and finished", async () => {
  const active = projection(false);
  using visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  await using screen = await render(bar(active, "zh", true));
  using _timers = fakeTimers();
  vi.setSystemTime(1_000 + 23 * 60_000);
  await screen.rerender(bar(active, "zh"));
  const summary = () =>
    screen.container.querySelector("[data-session-stats] [data-v9-stats-wide]")?.textContent;
  expect(summary()).toBe("第 1 轮 · 进行中 · 1 步 · 已运行 23 分钟");
  expect(screen.container.textContent).toContain("本轮结束后上报");
  expect(screen.container.textContent).not.toContain("0 令牌");
  expect(vi.getTimerCount()).toBe(1);
  await act(() => {
    vi.advanceTimersByTime(60_000);
  });
  expect(summary()).toContain("已运行 24 分");
  await act(() => {
    visibility.mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect(vi.getTimerCount()).toBe(0);
  await act(() => {
    vi.advanceTimersByTime(60_000);
  });
  expect(summary()).toContain("已运行 24 分");
  await act(() => {
    visibility.mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect(summary()).toContain("已运行 25 分");
  await screen.rerender(bar(projection(true), "zh"));
  expect(summary()).toBe("1 轮 1 步 · 10 令牌/秒");
  expect(screen.container.textContent).toContain("800 令牌");
  expect(screen.container.textContent).toContain("80%");
  expect(vi.getTimerCount()).toBe(0);
});

it("explains unreported fields and exposes finished token details using English UI copy", async () => {
  await page.viewport(800, 600);
  const data = projection(false);
  await using screen = await render(bar(data, "en"));
  await screen.getByRole("button", { name: /^Round 1 · In progress · 1 step/ }).click();
  const stats = page.getByRole("dialog", { name: "Session overview" });
  await expect.element(stats.getByText("Model time")).toBeVisible();
  expect(stats.element().textContent).toContain("Not recorded");
  expect(stats.element().textContent).toContain("Not reported");
  expect(stats.element().textContent).not.toMatch(/\p{Script=Han}/u);
  await screen.rerender(bar(projection(true), "en"));
  await screen.getByRole("button", { name: "1 round 1 step · 10 tok/s" }).click();
  await screen.getByRole("button", { name: "800 tok · Cache 80%" }).click();
  await expect.element(page.getByText("Cache read")).toBeVisible();
  expect(page.getByRole("dialog", { name: "Tokens & cache" }).element().textContent).not.toMatch(
    /\p{Script=Han}/u,
  );
});

it("shows the live output rate of the running turn and hides it while disconnected", async () => {
  const id = RunId.make("run-1");
  const base = projection(false);
  const live = {
    ...base,
    runs: base.runs.map((run) => ({ ...run, activeAttemptId: "attempt-1" })),
    providerTurns: [
      {
        id: "turn-1",
        runAttemptId: "attempt-1",
        ordinal: 1,
        status: "running",
        startedAt: start,
        completedAt: null,
        turnTokenUsage: { usageStatus: "partial", outputTokens: 120 },
      },
    ],
    turnItems: [{ type: "assistant_message", status: "running", runId: id }],
  } as unknown as ReturnType<typeof projection>;
  using _visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  await using screen = await render(bar(live, "en", true));
  using _timers = fakeTimers();
  vi.setSystemTime(1_000 + 4_000);
  await screen.rerender(bar(live, "en"));
  const summary = () =>
    screen.container.querySelector("[data-session-stats] [data-v9-stats-wide]")?.textContent;
  expect(summary()).toContain("30 tok/s");
  await screen.rerender(bar(live, "en", true));
  expect(summary()).not.toContain("tok/s");
});
