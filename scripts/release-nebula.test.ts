import { describe, expect, it } from "vite-plus/test";

import {
  bumpVersion,
  draftReleaseNotes,
  formatVersion,
  latestReleaseTag,
  parseVersion,
} from "./release-nebula.ts";

describe("release-nebula", () => {
  it("picks the newest release tag and bumps it", () => {
    const latest = latestReleaseTag(
      [
        "aaa\trefs/tags/v1.0.9",
        "bbb\trefs/tags/v1.0.10",
        "ccc\trefs/tags/v1.0.10^{}",
        "ddd\trefs/tags/nightly",
      ].join("\n"),
    );
    expect(latest).toEqual({ version: [1, 0, 10], commit: "bbb" });
    expect(formatVersion(bumpVersion(latest!.version, "patch"))).toBe("1.0.11");
    expect(formatVersion(bumpVersion(latest!.version, "minor"))).toBe("1.1.0");
    expect(formatVersion(bumpVersion(latest!.version, "major"))).toBe("2.0.0");
    expect(parseVersion("v2.3.4")).toEqual([2, 3, 4]);
    expect(parseVersion("2.3")).toBeUndefined();
  });

  it("drafts bilingual notes and summarizes upstream merges", () => {
    const notes = draftReleaseNotes([
      {
        subject: "Merge remote-tracking branch 'origin/main' into stardust-fusion",
        mergedCount: 42,
      },
      { subject: "Merge upstream T3 Code main into T3 Nebula", mergedCount: 8 },
      { subject: "Find the Codex desktop app's bundled CLI on Windows" },
    ]);
    expect(notes).toContain("- Find the Codex desktop app's bundled CLI on Windows");
    expect(notes).toContain("- Merged 50 upstream T3 Code commits.");
    expect(notes).toContain("- 合并上游 T3 Code 的 50 个提交。");
    expect(notes).not.toContain("Merge remote-tracking");
  });
});
