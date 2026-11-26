import { syncCustomLocale } from "../../i18n/customLocale";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { EnvironmentId, ProviderInstanceId } from "@t3tools/contracts";
import { GTProvider } from "gt-react";
import { render } from "../../../test/render";
import { ResetCreditDialog, useResetCredit } from "./UsageLimits";
import { resetCreditChoices } from "./usageResetCreditPresentation";
import zh from "../../i18n/translations/zh.json";
import "~/index.css";
import "./usagePresentation.css";

const mock = vi.hoisted(() => ({
  calls: [] as string[],
  outcome: "reset",
  failed: false,
  refreshFailed: false,
}));
vi.mock(import("../../state/session"), async (original) => ({
  ...(await original()),
  useEnvironmentScope: () => true,
  readEnvironmentScope: () => true,
}));
vi.mock("../../state/use-atom-command", () => ({
  useAtomCommand: (command: { label: string }) => async () => {
    mock.calls.push(command.label);
    if (mock.failed || (mock.refreshFailed && command.label.toLowerCase().includes("refresh")))
      return { _tag: "Failure", cause: { error: new Error("模拟提供方暂时不可用") } };
    return { _tag: "Success", value: { outcome: mock.outcome } };
  },
}));
function Harness({ high = false, multi = false }: { high?: boolean; multi?: boolean }) {
  const now = Date.parse("2026-11-17T16:00:00Z");
  const credits = {
    availableCount: 3,
    nextExpiresAt: "2026-11-30T00:00:00Z",
    ...(multi
      ? {
          options: [
            {
              creditId: "weekly",
              label: "Weekly reset",
              description: "Refills your weekly limit.",
              availableCount: 1,
              expiresAt: "2026-12-05T00:00:00Z",
            },
            {
              creditId: "session",
              label: "5-hour reset",
              description: "Refills your 5-hour limit.",
              availableCount: 2,
              expiresAt: "2026-11-24T00:00:00Z",
            },
          ],
        }
      : {}),
  };
  const choices = resetCreditChoices(
    credits,
    { instanceId: ProviderInstanceId.make("fixture") },
    now,
  );
  const reset = useResetCredit(EnvironmentId.make("fixture"), credits.availableCount);
  return (
    <>
      <button type="button" onClick={() => reset.confirm(choices[0]!)}>
        使用夹具
      </button>
      <span role="status">{reset.status}</span>
      <ResetCreditDialog
        open={reset.confirming}
        onOpenChange={reset.setConfirming}
        choice={reset.choice}
        choices={choices}
        onChoice={reset.confirm}
        credits={credits}
        windows={[
          {
            id: "weekly",
            kind: "weekly",
            label: "Weekly",
            usedPercent: high ? 18 : 85,
            resetsAt: "2026-11-22T22:29:00Z",
          },
          {
            id: "5h",
            kind: "session",
            label: "5-hour",
            usedPercent: high ? 18 : 100,
            resetsAt: "2026-11-17T18:00:00Z",
          },
        ]}
        now={now}
        provider="Codex"
        onConfirm={() => void reset.redeem()}
        disabled={reset.busy}
      />
    </>
  );
}
it("uses only a simulated consume command for confirmation, high-balance cancel, option selection, success refresh and failure", async () => {
  syncCustomLocale("zh");
  using _locale = {
    [Symbol.dispose]() {
      syncCustomLocale("en");
    },
  };
  mock.calls = [];
  mock.failed = false;
  mock.refreshFailed = false;
  mock.outcome = "reset";
  const view = (high = false, multi = false) => (
    <GTProvider locale="zh" translations={{ zh, en: {} } as never}>
      <Harness high={high} multi={multi} />
    </GTProvider>
  );
  await using screen = await render(view());
  await userEvent.click(screen.getByText("使用夹具"));
  await expect.element(page.getByRole("alertdialog")).toBeVisible();
  expect(document.querySelector(".usage-reset-window")?.textContent?.replace(/\s/g, "")).toContain(
    "15%→100%",
  );
  await userEvent.click(page.getByRole("button", { name: "使用 1 次", exact: true }));
  await vi.waitFor(() =>
    expect(screen.container.querySelector("[role=status]")?.textContent).toContain("已重置"),
  );
  expect(mock.calls).toHaveLength(2);
  await screen.rerender(view(true));
  await userEvent.click(screen.getByText("使用夹具"));
  expect(document.querySelector(".usage-reset-dialog")?.textContent).toContain("现在用有点早");
  await userEvent.click(page.getByRole("button", { name: "先不用", exact: true }));
  expect(mock.calls).toHaveLength(2);
  await screen.rerender(view(false, true));
  await userEvent.click(screen.getByText("使用夹具"));
  await expect.element(page.getByRole("radio").first()).toBeChecked();
  await userEvent.click(page.getByRole("radio").last());
  // Expiry dates render in the browser's zone, so the expected day follows the host.
  const weeklyExpiry = new Date("2026-12-05T00:00:00Z");
  const weeklyExpiryDay = [weeklyExpiry.getMonth() + 1, weeklyExpiry.getDate()]
    .map((part) => String(part).padStart(2, "0"))
    .join("/");
  expect(document.querySelector(".usage-reset-dialog")?.textContent).toContain(weeklyExpiryDay);
  mock.failed = true;
  await userEvent.click(page.getByRole("button", { name: "使用所选", exact: true }));
  await vi.waitFor(() =>
    expect(screen.container.querySelector("[role=status]")?.textContent).toContain(
      "模拟提供方暂时不可用",
    ),
  );
  mock.failed = false;
  mock.refreshFailed = true;
  await screen.rerender(view());
  await userEvent.click(screen.getByText("使用夹具"));
  await userEvent.click(page.getByRole("button", { name: "使用 1 次", exact: true }));
  await vi.waitFor(() =>
    expect(screen.container.querySelector("[role=status]")?.textContent).toContain("额度刷新失败"),
  );
});
