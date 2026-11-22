import { describe, expect, it } from "vite-plus/test";
import {
  beatArch,
  beatOs,
  buildBeat,
  randomInstallId,
  readStardustStatsPreferences,
  shouldSendBeat,
  stardustVersionFromTag,
  utcDay,
} from "./stardustStats.logic";

const id = "ab".repeat(32);
const day = Date.UTC(2026, 10, 22, 9);

describe("stardust stats preferences", () => {
  it("defaults to off, notice not shown, a fresh install id", () => {
    expect(readStardustStatsPreferences(null, () => id)).toEqual({
      enabled: false,
      noticeShown: false,
      install: id,
      lastSentDay: "",
    });
  });
  it("keeps an explicit off and replaces malformed fields", () => {
    const prefs = readStardustStatsPreferences(
      { enabled: false, noticeShown: true, install: "nope", lastSentDay: "yesterday" },
      () => id,
    );
    expect(prefs).toEqual({ enabled: false, noticeShown: true, install: id, lastSentDay: "" });
  });
  it("makes 64-char hex ids", () => {
    expect(randomInstallId((b) => b.fill(255))).toBe("ff".repeat(32));
  });
});

describe("sending rules", () => {
  const base = { enabled: true, noticeShown: true, install: id, lastSentDay: "" };
  it("sends once per UTC day, only after the notice and only while on", () => {
    expect(shouldSendBeat(base, day)).toBe(true);
    expect(shouldSendBeat({ ...base, lastSentDay: utcDay(day) }, day)).toBe(false);
    expect(shouldSendBeat({ ...base, lastSentDay: "2026-11-21" }, day)).toBe(true);
    expect(shouldSendBeat({ ...base, noticeShown: false }, day)).toBe(false);
    expect(shouldSendBeat({ ...base, enabled: false }, day)).toBe(false);
  });
  it("builds exactly four fields from public release tags only", () => {
    expect(
      buildBeat({ preferences: base, tag: "v1.2.1", platform: "darwin", architecture: "arm" }),
    ).toEqual({
      install: id,
      version: "1.2.1",
      os: "darwin",
      arch: "arm64",
    });
    expect(
      buildBeat({
        preferences: base,
        tag: "xiaoxin-c48-macos-20261112",
        platform: "darwin",
        architecture: undefined,
      }),
    ).toBeNull();
    expect(
      buildBeat({ preferences: base, tag: "v1.2.1", platform: "android", architecture: undefined }),
    ).toBeNull();
    expect(stardustVersionFromTag("v1.2")).toBeNull();
    expect(beatOs("win32")).toBe("win32");
    expect(beatArch("x86")).toBe("x64");
    expect(beatArch(undefined)).toBe("arm64");
  });
});
