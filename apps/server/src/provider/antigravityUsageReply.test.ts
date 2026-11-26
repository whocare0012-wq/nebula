import { describe, expect, it } from "vite-plus/test";

import { parseAntigravityUsageReply } from "./antigravityUsageReply.ts";

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
