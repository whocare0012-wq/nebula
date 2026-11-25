import { testUiLocale } from "../../../test/uiLocale";
import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import { CHATGPT_USAGE_URL } from "@t3tools/shared/usageLimits";
import { describe, expect, it } from "vite-plus/test";

import "~/index.css";

import { render } from "../../../test/render";
import { UsageLimitsPooled } from "./UsageLimitsPooled";

const checkedAt = "2026-10-25T16:00:00.000Z";

function managedChatGpt(instanceId: string, displayName: string): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make(instanceId),
    driver: ProviderDriverKind.make("codex"),
    displayName,
    enabled: true,
    installed: true,
    version: "0.164.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt,
    models: [],
    slashCommands: [],
    skills: [],
    usageLimits: {
      checkedAt,
      windows: [],
      unavailable: { reason: "unsupported", message: "Track usage in ChatGPT." },
      externalUsage: { label: "ChatGPT usage", url: CHATGPT_USAGE_URL },
    },
  };
}

describe("UsageLimitsPooled ChatGPT usage card", () => {
  it("names the managed connections it covers", async () => {
    const presentations = new Map([
      [
        EnvironmentId.make("desk"),
        {
          entry: { target: { label: "Desk" } },
          serverConfig: {
            providers: [
              managedChatGpt("chatgpt_work", "ChatGPT Work"),
              managedChatGpt("chatgpt_personal", "ChatGPT Personal"),
            ],
          },
        },
      ],
    ]);
    await using screen = await render(
      <UsageLimitsPooled presentations={presentations} now={Date.parse(checkedAt)} />,
    );

    await expect
      .element(screen.getByText("ChatGPT Work on Desk, ChatGPT Personal on Desk"))
      .toBeVisible();
    await expect
      .element(screen.getByText("View usage in ChatGPT with your connected account."))
      .toBeVisible();
  });
});

it("suppresses stale and failed quota predictions while keeping last readings visible", async () => {
  using _locale = testUiLocale("zh-CN");
  const provider = managedChatGpt("sample", "Sample quota");
  const limit = {
    checkedAt,
    windows: [
      {
        id: "weekly",
        kind: "weekly" as const,
        label: "Weekly",
        usedPercent: 90,
        windowDurationMins: 10080,
        resetsAt: "2026-10-26T16:00:00.000Z",
      },
    ],
  };
  for (const unavailable of [undefined, { reason: "probeFailed" as const }]) {
    const presentations = new Map([
      [
        EnvironmentId.make("desk"),
        {
          entry: { target: { label: "Desk" } },
          serverConfig: {
            providers: [
              { ...provider, usageLimits: { ...limit, ...(unavailable ? { unavailable } : {}) } },
            ],
          },
        },
      ],
    ]);
    await using screen = await render(
      <UsageLimitsPooled presentations={presentations} now={Date.parse(checkedAt) + 600001} />,
    );
    const text = screen.container.textContent;
    expect(text).toContain("暂不预测");
    expect(text).not.toContain("部分额度按当前速度会提前用完");
    expect(text).not.toContain("充足");
  }
});

it("gives each Claude login its own card, titled by its instance name", async () => {
  const claude = (instanceId: string, displayName: string, email: string, used: number) => ({
    ...managedChatGpt(instanceId, displayName),
    driver: ProviderDriverKind.make("claudeAgent"),
    auth: { status: "authenticated" as const, email },
    usageLimits: {
      checkedAt,
      windows: [
        {
          id: "seven_day",
          kind: "weekly" as const,
          label: "Weekly",
          usedPercent: used,
          windowDurationMins: 10080,
          resetsAt: "2026-10-27T16:00:00.000Z",
        },
      ],
    },
  });
  const presentations = new Map([
    [
      EnvironmentId.make("desk"),
      {
        entry: { target: { label: "Desk" } },
        serverConfig: {
          providers: [
            claude("claude-pro2", "Claude 小号 Pro", "a@example.invalid", 10),
            claude("claude-pro3", "Claude 小号 3", "b@example.invalid", 60),
          ],
        },
      },
    ],
  ]);
  await using screen = await render(
    <UsageLimitsPooled presentations={presentations} now={Date.parse(checkedAt)} />,
  );
  const cards = [...screen.container.querySelectorAll<HTMLElement>("[data-usage-card]")];
  const titles = cards.map((card) => card.querySelector("h2")?.textContent ?? "");
  expect(titles.filter((title) => title.startsWith("Claude 小号 Pro"))).toHaveLength(1);
  expect(titles.filter((title) => title.startsWith("Claude 小号 3"))).toHaveLength(1);
  expect(cards.filter((card) => card.id.startsWith("usage-limit-claudeAgent:"))).toHaveLength(2);
  const timeline = cards.map((card) => card.textContent ?? "").join("");
  expect(timeline).toContain("Claude 小号 3Lowest remaining 40%");
  expect(timeline).toContain("Claude 小号 ProLowest remaining 90%");
});
