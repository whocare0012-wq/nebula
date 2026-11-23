import { GTProvider } from "gt-react";
import { memo, useState } from "react";
import { expect, it } from "vite-plus/test";
import { render } from "../../test/render";
import { useUiText } from "./useUiText";
import zh from "./translations/zh.json";

const Copy = memo(function Copy() {
  const text = useUiText();
  const [draft, setDraft] = useState("保留这段输入");
  return (
    <>
      <span>{text("Settings")}</span>
      <span>{text("Reset credits ({count})", { count: 3 })}</span>
      <input aria-label="draft" value={draft} onChange={(event) => setDraft(event.target.value)} />
    </>
  );
});

it("changes custom labels through GT without remounting a memoized composer", async () => {
  const tree = (locale: string) => (
    <GTProvider locale={locale} translations={{ zh, en: {} } as never}>
      <Copy />
    </GTProvider>
  );
  await using screen = await render(tree("zh"), { router: false });
  await expect.element(screen.getByText("设置", { exact: true })).toBeVisible();
  await expect.element(screen.getByText("重置机会（3 次）", { exact: true })).toBeVisible();
  const original = screen.container.querySelector("input");
  await screen.rerender(tree("en"));
  await expect.element(screen.getByText("Settings", { exact: true })).toBeVisible();
  expect(screen.container.querySelector("input")).toBe(original);
  expect(original?.value).toBe("保留这段输入");
  await screen.rerender(tree("zh"));
  await expect.element(screen.getByText("设置", { exact: true })).toBeVisible();
});

import { useUsageDateFormat } from "../components/usage/useUsageDateFormat";
import { TimelineSystemDivider } from "../components/chat/TimelineSystemDivider";
function TimeAndStatusCopy() {
  const format = useUsageDateFormat();
  const text = useUiText();
  return (
    <>
      <TimelineSystemDivider label="Finished" detail="Stopped by user" />
      <span>{text("Worked for {duration}", { duration: "5m 46s" })}</span>
      <span>{format.formatHourShort("2026-11-15T11:44:00Z", "America/Los_Angeles", true)}</span>
      <span>{format.formatHourShort("2026-11-16T08:44:00Z", "America/Los_Angeles", false)}</span>
      <span>{format.formatDayShort("2026-09-05")}</span>
    </>
  );
}
it("renders Chinese status copy and local hour labels with the real bucket minute, including midnight, on a live locale change", async () => {
  const tree = (locale: string) => (
    <GTProvider locale={locale} translations={{ zh, en: {} } as never}>
      <TimeAndStatusCopy />
    </GTProvider>
  );
  await using screen = await render(tree("zh"), { router: false });
  await expect.element(screen.getByText("已完成", { exact: true })).toBeVisible();
  await expect.element(screen.getByText(/已手动停止/)).toBeVisible();
  await expect.element(screen.getByText("已工作 5 分 46 秒", { exact: true })).toBeVisible();
  await expect.element(screen.getByText("03:44", { exact: true })).toBeVisible();
  await expect.element(screen.getByText("00:44", { exact: true })).toBeVisible();
  await expect.element(screen.getByText("09/05", { exact: true })).toBeVisible();
  await screen.rerender(tree("en"));
  await expect.element(screen.getByText("Finished", { exact: true })).toBeVisible();
});

import { ThreadErrorBanner } from "../components/chat/ThreadErrorBanner";
import { WorkLogRow } from "../components/chat/WorkLog";
import { conversationLabel } from "./conversationLabel";
import { syncCustomLocale } from "./customLocale";
import { DEFAULT_COMPOSER_PLACEHOLDER } from "../composerPlaceholder";
import { TaskCommandActivities } from "../components/chat/TaskCommandActivities";
function ConversationCopy() {
  const text = useUiText();
  return (
    <>
      {/* Timeline rows translate their summaries before handing them to WorkLogRow. */}
      <WorkLogRow label={conversationLabel("Ran 3 commands", text)} />
      <WorkLogRow label={conversationLabel("Ran 10 commands and used browser 12 times", text)} />
      <WorkLogRow label={conversationLabel("Tasks 0/4 · 核对文件", text)} />
      <WorkLogRow label={conversationLabel("Worked for 4m 35s", text)} />
      <ThreadErrorBanner error="The libtv MCP server requires OAuth reauthentication. Run `codex mcp login libtv`." />
      <ThreadErrorBanner error="Cancelled because the server restarted before the provider work completed." />
      <span>{text("Waiting")}</span>
      <input aria-label="输入" placeholder={text(DEFAULT_COMPOSER_PLACEHOLDER)} />
      <TaskCommandActivities
        activities={[
          {
            id: "1",
            kind: "command",
            label: "读取",
            path: "/tmp/说明.md",
            command: "cat /tmp/说明.md",
            status: "completed",
          },
        ]}
        onOpenFile={undefined}
      />
    </>
  );
}
it("renders Chinese conversation, task, sidebar, composer and plugin system copy while retaining command originals", async () => {
  // Error banners read the app-wide UI locale, which the app syncs from the language setting.
  syncCustomLocale("zh");
  using _locale = {
    [Symbol.dispose]() {
      syncCustomLocale("en");
    },
  };
  await using screen = await render(
    <GTProvider locale="zh" translations={{ zh, en: {} } as never}>
      <ConversationCopy />
    </GTProvider>,
    { router: false },
  );
  for (const label of [
    "运行了 3 条命令",
    "运行了 10 条命令，用了 12 次浏览器",
    "任务 0/4 · 核对文件",
    "已工作 4 分 35 秒",
    "等待中",
    "服务重启时任务尚未完成，已取消本次运行。",
    "libtv 插件需要重新登录：运行 `codex mcp login libtv`",
  ])
    await expect.element(screen.getByText(label, { exact: true })).toBeVisible();
  await expect
    .element(screen.getByRole("textbox", { name: "输入" }))
    .toHaveAttribute("placeholder", "问点什么… @ 文件、$ 技能、/ 命令");
  const visible = screen.container.innerText;
  expect(visible).not.toMatch(
    /Ran \d|Tasks \d|Waiting|Ask anything|\d+m \d+s|requires OAuth|Cancelled because/,
  );
});
