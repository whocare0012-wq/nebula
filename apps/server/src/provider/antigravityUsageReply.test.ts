import { describe, expect, it } from "vite-plus/test";

import { parseAntigravityCliUsage, parseAntigravityUsageReply } from "./antigravityUsageReply.ts";

const MODELS = ["gemini-3.1-pro", "gemini-3-flash", "claude-sonnet-4-6", "gpt-oss-120b"];

describe("parseAntigravityUsageReply", () => {
  it("turns each remaining-percent bucket into a window for the models its group meters", () => {
    const reply = [
      "### Session Usage",
      "- **Session total:** data not available yet",
      "",
      "### Quota Limits",
      "- **Gemini Models**",
      "  - **Weekly Limit Remaining:** 91% remaining (resets Oct 02, 2026, 14:00 UTC)",
      "- **Claude and GPT models**",
      "    - **5h Limit:** 100% remaining",
    ].join("\n");

    expect(parseAntigravityUsageReply(reply, MODELS)).toEqual([
      {
        id: "antigravity-gemini-models-weekly-limit-remaining",
        label: "Gemini Models · Weekly Limit Remaining",
        usedPercent: 9,
        kind: "weekly",
        windowDurationMins: 7 * 24 * 60,
        resetsAt: "2026-10-02T14:00:00.000Z",
        modelIds: ["gemini-3.1-pro", "gemini-3-flash"],
      },
      {
        id: "antigravity-claude-and-gpt-models-5h-limit",
        label: "Claude and GPT models · 5h Limit",
        usedPercent: 0,
        kind: "session",
        windowDurationMins: 5 * 60,
        modelIds: ["claude-sonnet-4-6", "gpt-oss-120b"],
      },
    ]);
  });

  it("skips unit counts, disabled buckets, alerts and percentages out of range", () => {
    const reply = [
      "### Quota Limits",
      "- **Alert:** You have used 80% of your monthly budget.",
      "- **Gemini Models**",
      "  *(Shared by every Gemini model)*",
      "  - **Requests:** 1,000 units remaining (resets Oct 02, 2026, 14:00 UTC)",
      "  - **Weekly:** Disabled: not in your plan",
      "  - **Burst:** 140% remaining",
      "- **Image models**",
      "  - **Monthly Budget:** 20% remaining (resets someday)",
    ].join("\n");

    expect(parseAntigravityUsageReply(reply, MODELS)).toEqual([
      {
        id: "antigravity-image-models-monthly-budget",
        label: "Image models · Monthly Budget",
        usedPercent: 80,
        kind: "monthly",
      },
    ]);
  });

  it("reads nothing from a reply without a quota section", () => {
    expect(parseAntigravityUsageReply("Unable to retrieve quota status", MODELS)).toEqual([]);
    expect(
      parseAntigravityUsageReply(
        "### Quota Limits\n- Not applicable for current authentication method.",
        MODELS,
      ),
    ).toEqual([]);
  });
});

// Shape of `agy --print /usage --output-format json` from agy 1.x, trimmed.
const CLI_USAGE = JSON.stringify({
  conversation_id: "",
  status: "SUCCESS",
  num_turns: 0,
  usage: { total_tokens: 0 },
  command: {
    name: "usage",
    data: {
      groups: [
        {
          name: "Gemini Models",
          buckets: [
            {
              id: "gemini-weekly",
              name: "Weekly Limit Remaining",
              window: "weekly",
              remaining_fraction: 0.75,
              reset_time: "2026-12-03T17:07:21Z",
            },
            {
              id: "gemini-5h",
              name: "Five Hour Limit Remaining",
              window: "5h",
              remaining_fraction: 0.5,
              reset_time: "2026-11-26T22:07:21Z",
            },
          ],
        },
        {
          name: "Claude and GPT models",
          buckets: [
            {
              id: "3p-5h",
              name: "Five Hour Limit Remaining",
              window: "5h",
              remaining_fraction: 1,
              reset_time: "1970-01-01T00:00:00Z",
            },
            { id: "3p-old", name: "Retired", remaining_fraction: 0.2, disabled: true },
          ],
        },
      ],
    },
  },
});

describe("parseAntigravityCliUsage", () => {
  it("turns each bucket into a window for the models its group meters", () => {
    expect(parseAntigravityCliUsage(`I1127 starting\n${CLI_USAGE}\n`, MODELS)).toEqual([
      {
        id: "antigravity-gemini-weekly",
        label: "Gemini Models · Weekly",
        usedPercent: 25,
        kind: "weekly",
        windowDurationMins: 7 * 24 * 60,
        resetsAt: "2026-12-03T17:07:21.000Z",
        modelIds: ["gemini-3.1-pro", "gemini-3-flash"],
      },
      {
        id: "antigravity-gemini-5h",
        label: "Gemini Models · 5-hour",
        usedPercent: 50,
        kind: "session",
        windowDurationMins: 5 * 60,
        resetsAt: "2026-11-26T22:07:21.000Z",
        modelIds: ["gemini-3.1-pro", "gemini-3-flash"],
      },
      {
        id: "antigravity-3p-5h",
        label: "Claude and GPT models · 5-hour",
        usedPercent: 0,
        kind: "session",
        windowDurationMins: 5 * 60,
        modelIds: ["claude-sonnet-4-6", "gpt-oss-120b"],
      },
    ]);
  });

  it("rejects a reply that was a model turn rather than the /usage command", () => {
    const turn = JSON.stringify({ status: "SUCCESS", response: "What should I do?", num_turns: 1 });
    expect(parseAntigravityCliUsage(turn, MODELS)).toBeUndefined();
    expect(parseAntigravityCliUsage("AGY_ERROR: timeout", MODELS)).toBeUndefined();
  });
});
