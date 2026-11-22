import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  communityReleaseNumber,
  communityUpdateActions,
  parseCommunityRelease,
} from "./communityUpdates.logic";
const stardustRelease = (version = "1.0.1") => ({
  tag_name: `v${version}`,
  draft: false,
  prerelease: false,
  assets: [
    {
      name: `T3-Stardust-${version}-macOS-arm64.zip`,
      state: "uploaded",
      size: 123,
      digest: `sha256:${"a".repeat(64)}`,
    },
  ],
  html_url: "https://evil.example/",
});
const release = (number = 48) => ({
  tag_name: `xiaoxin-c${number}-macos-20261112`,
  draft: false,
  prerelease: false,
  assets: [
    {
      name: `Xiaoxin-T3-Code-C${number}-macOS-arm64.zip`,
      state: "uploaded",
      size: 123,
      digest: `sha256:${"a".repeat(64)}`,
    },
  ],
  html_url: "https://evil.example/",
});
beforeEach(() => {
  vi.resetModules();
  const saved = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => saved.get(k) ?? null,
    setItem: (k: string, v: string) => saved.set(k, v),
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});
describe("community release boundaries", () => {
  it("compares Stardust semver and legacy community numbers while rejecting upstream v0.x tags", () => {
    expect(communityReleaseNumber("xiaoxin-c100-macos-20261112")).toBe(100);
    expect(communityReleaseNumber("v1.0.0")).toBe(1_010_000);
    expect(communityReleaseNumber("v1.0.1")).toBeGreaterThan(communityReleaseNumber("v1.0.0")!);
    expect(communityReleaseNumber("v1.0.0")).toBeGreaterThan(
      communityReleaseNumber("xiaoxin-c100-macos-20261112")!,
    );
    expect(communityReleaseNumber("v0.1.9")).toBeNull();
    expect(communityReleaseNumber("xiaoxin-c48-windows-20261112")).toBeNull();
  });
  it("ignores arbitrary response URLs and builds repository-bound links", () => {
    const r = parseCommunityRelease(stardustRelease("1.2.2"));
    expect(r.url).toBe("https://github.com/zds-xiaoxin/xiaoxin-t3code/releases/tag/v1.2.2");
    expect(r.compareUrl).toContain("compare/v1.2.1...v1.2.2");
    const legacy = parseCommunityRelease(release());
    expect(legacy.url).toBe(
      "https://github.com/zds-xiaoxin/xiaoxin-t3code/releases/tag/xiaoxin-c48-macos-20261112",
    );
  });
  it.each([
    { ...stardustRelease(), draft: true },
    { ...stardustRelease(), prerelease: true },
    { ...stardustRelease(), assets: [] },
    { ...stardustRelease(), assets: [{ ...stardustRelease().assets[0], digest: "" }] },
  ])("rejects unpublished, preview or incomplete binaries", (r) =>
    expect(() => parseCommunityRelease(r)).toThrow(),
  );
  it("custom mode exposes only source review and never installation", () => {
    expect(communityUpdateActions("custom")).toEqual({
      canOpenDownloadPage: false,
      canViewSourceDiff: true,
      canInstall: false,
    });
    expect(communityUpdateActions("standard").canInstall).toBe(false);
  });
});
describe("community checks", () => {
  it("defaults to standard mode with background checks off, and finds a newer release when on", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => stardustRelease("1.2.2") });
    vi.stubGlobal("fetch", fetch);
    const { useCommunityUpdates: s } = await import("./communityUpdates");
    expect(s.getState().mode).toBe("standard");
    expect(s.getState().automatic).toBe(false);
    s.getState().setAutomatic(true);
    await s.getState().check();
    expect(s.getState().status).toBe("available");
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
    await s.getState().check();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each(["1.2.0", "1.0.11", "1.0.2"])(
    "does not offer the shipped or an older version (%s) as an upgrade",
    async (version) => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({ ok: true, json: async () => stardustRelease(version) }),
      );
      const { useCommunityUpdates: s } = await import("./communityUpdates");
      await s.getState().check(true);
      expect(s.getState().status).toBe("current");
    },
  );
  it("deduplicates simultaneous checks and preserves a mode change during the request", async () => {
    let resolve!: (r: unknown) => void;
    const fetch = vi.fn(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    vi.stubGlobal("fetch", fetch);
    const { useCommunityUpdates: s } = await import("./communityUpdates");
    s.getState().setMode("standard");
    const first = s.getState().check(true);
    const second = s.getState().check(true);
    s.getState().setMode("custom");
    resolve({ ok: true, json: async () => stardustRelease("1.0.1") });
    await Promise.all([first, second]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(s.getState().mode).toBe("custom");
  });
  it("respects disabled background checks while allowing an explicit manual check", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => stardustRelease("1.0.1") });
    vi.stubGlobal("fetch", fetch);
    const { useCommunityUpdates: s } = await import("./communityUpdates");
    s.getState().setAutomatic(false);
    await s.getState().check();
    expect(fetch).not.toHaveBeenCalled();
    await s.getState().check(true);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("reports network errors without starting another automatic request", async () => {
    const fetch = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetch);
    const { useCommunityUpdates: s } = await import("./communityUpdates");
    s.getState().setAutomatic(true);
    await s.getState().check();
    expect(s.getState()).toMatchObject({ status: "error", error: "offline" });
    await s.getState().check();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("corrupt preferences fail back to standard mode", async () => {
    localStorage.setItem("t3code:community-updates:v1", "invalid");
    const { useCommunityUpdates: s } = await import("./communityUpdates");
    expect(s.getState().mode).toBe("standard");
  });
  it("moves an unchosen legacy custom default to standard but keeps an explicit choice", async () => {
    localStorage.setItem(
      "t3code:community-updates:v1",
      JSON.stringify({ mode: "custom", automatic: true, lastAttempt: 0, notifiedTag: "" }),
    );
    const first = await import("./communityUpdates");
    expect(first.useCommunityUpdates.getState().mode).toBe("standard");
    first.useCommunityUpdates.getState().setMode("custom");
    vi.resetModules();
    const second = await import("./communityUpdates");
    expect(second.useCommunityUpdates.getState().mode).toBe("custom");
  });
});
