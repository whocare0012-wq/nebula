import { expect, it } from "vite-plus/test";
import {
  cleanupRisk,
  cleanupSuggestionGroups,
  selectedReleaseBytes,
  selectedCleanupEntry,
  volumeGauge,
  GIB,
  latestCleanupScan,
  runCleanupBatch,
} from "./cleanupModel";
import type { StorageEntry } from "./storageInventoryModel";

const entry = (id: string, options: Partial<StorageEntry> = {}): StorageEntry => ({
  id,
  name: id,
  path: `/data/${id}`,
  kind: "builds",
  reason: "reviewed",
  bytes: GIB,
  canRelease: true,
  canArchive: true,
  ...options,
});
it("defaults only to reviewed regenerable data and never reselects a deselected item", () => {
  const entries = [
    entry("backup", { kind: "backups" }),
    entry("unknown", { canRelease: false }),
    entry("build"),
  ];
  expect(selectedCleanupEntry(entries, undefined)?.id).toBe("build");
  expect(selectedCleanupEntry(entries, null)).toBeUndefined();
  expect(selectedCleanupEntry(entries.slice(0, 2), undefined)).toBeUndefined();
  expect(selectedCleanupEntry(entries, "backup")?.id).toBe("backup");
});
it("rejects locked, protected and revoked selections even with contradictory permission flags", () => {
  for (const item of [
    entry("x", { canRelease: false }),
    entry("x", { canArchive: false }),
    entry("x", { kind: "database" }),
    entry("x", { kind: "attachments" }),
    entry("x", { kind: "protected" }),
  ]) {
    expect(cleanupRisk(item)).toBe("locked");
    expect(selectedCleanupEntry([item], "x")).toBeUndefined();
  }
  expect(selectedCleanupEntry([], "removed")).toBeUndefined();
});
it("marks volumes below the display reserve and never invents an unknown total", () => {
  const volume = {
    id: "disk",
    name: "Disk",
    path: "/",
    freeBytes: 39 * GIB,
    totalBytes: 400 * GIB,
  };
  expect(volumeGauge(volume)).toEqual({ low: true, freePercent: 9.75, reservePercent: 10 });
  expect(volumeGauge({ ...volume, freeBytes: 40 * GIB }).low).toBe(false);
  expect(volumeGauge({ id: "disk", name: "Disk", path: "/", freeBytes: 39 * GIB })).toEqual({
    low: true,
    freePercent: null,
    reservePercent: null,
  });
  expect(volumeGauge({ ...volume, freeBytes: 500 * GIB }).freePercent).toBe(100);
});

it("keeps recent caches manual, trash out of safe selection, and respects per-volume reserves", () => {
  const safe = entry("cache", {
    destination: "delete-rebuildable",
    risk: "safe",
    locked: false,
    rebuildable: true,
    canArchive: false,
  });
  const recent = { ...safe, id: "recent", risk: "caution" as const };
  const trash = { ...safe, id: "trash", destination: "trash" as const, rebuildable: false };
  expect(cleanupRisk(safe)).toBe("safe");
  expect(cleanupRisk(recent)).toBe("review");
  expect(cleanupRisk(trash)).toBe("review");
  expect(selectedCleanupEntry([recent, trash, safe], undefined)?.id).toBe("cache");
  expect(cleanupRisk({ ...safe, locked: true })).toBe("locked");
  expect(
    volumeGauge({
      id: "v",
      name: "v",
      path: "/",
      freeBytes: 45 * GIB,
      totalBytes: 400 * GIB,
      reserveGiB: 50,
    }).low,
  ).toBe(true);
});

it("does not let a previous completed status hide the next scan", () => {
  const previous = {
    requestId: 10,
    phase: "completed" as const,
    checked: 2,
    total: 2,
    current: "",
    truncated: false,
  };
  const next = { ...previous, requestId: 11, phase: "scanning" as const, checked: 0 };
  expect(latestCleanupScan(next, previous)?.phase).toBe("scanning");
  expect(latestCleanupScan(next, { ...next, phase: "completed" })?.phase).toBe("completed");
  expect(latestCleanupScan(undefined, next)).toBe(next);
});

it("hides objects under 1 MB and chooses only the largest safe object above 200 MB", () => {
  const rows = [
    entry("zero", { bytes: 0 }),
    entry("tiny", { bytes: 4_000 }),
    entry("small", { bytes: 49_999_999 }),
    entry("medium", { bytes: 199_999_999 }),
    entry("threshold", { bytes: 200_000_000 }),
    entry("large", { bytes: 2 * GIB }),
    entry("unknown", { bytes: null }),
  ];
  expect(selectedCleanupEntry(rows, undefined)?.id).toBe("large");
  expect(selectedCleanupEntry(rows.slice(0, 4), undefined)).toBeUndefined();
  expect(selectedCleanupEntry(rows, "zero")).toBeUndefined();
  expect(selectedReleaseBytes([selectedCleanupEntry(rows, undefined)!])).toBe(2 * GIB);
  expect(
    selectedReleaseBytes([
      entry("cache", { destination: "delete-rebuildable" }),
      entry("installer", { destination: "trash" }),
      entry("archive"),
    ]),
  ).toBe(2 * GIB);
  const groups = cleanupSuggestionGroups(rows);
  expect(groups.flatMap((g) => g.entries.map((e) => e.id))).toEqual([
    "large",
    "threshold",
    "medium",
    "small",
    "unknown",
  ]);
});
it("groups by kind, destination, volume and lock state without inventing batch authorization", () => {
  const rows = [
    entry("old1", {
      category: "rollback-apps",
      risk: "confirm",
      destination: "trash",
      volumePath: "/",
    }),
    entry("old2", {
      category: "rollback-apps",
      risk: "confirm",
      destination: "trash",
      volumePath: "/",
    }),
    entry("latest", {
      category: "rollback-apps",
      locked: true,
      destination: "trash",
      volumePath: "/",
    }),
    entry("stage", {
      category: "old-builds",
      destination: "trash",
      volumePath: "/Volumes/external",
    }),
  ];
  const groups = cleanupSuggestionGroups([
    ...rows,
    entry("rebuild", {
      category: "rollback-apps",
      destination: "delete-rebuildable",
      volumePath: "/",
    }),
  ]);
  expect(groups).toHaveLength(4);
  expect(groups.at(-1)?.risk).toBe("locked");
  expect(groups.find((g) => g.entries.length === 2)).toMatchObject({
    bytes: 2 * GIB,
    risk: "review",
    volumePath: "/",
  });
  expect(groups.find((g) => g.risk === "locked")?.entries[0]?.id).toBe("latest");
  expect(selectedCleanupEntry(rows, undefined)).toBeUndefined();
});

it("plans and runs batch items one at a time, keeps going past failures and honors stop", async () => {
  const calls: string[] = [];
  const steps = {
    plan: async (id: string) => {
      calls.push(`plan ${id}`);
      return id === "busy" ? { error: "in use" } : { id: `plan-${id}` };
    },
    execute: async (planId: string) => {
      calls.push(`execute ${planId}`);
      return planId === "plan-expired" ? { error: "expired" } : { id: planId };
    },
    cancel: async (planId: string) => {
      calls.push(`cancel ${planId}`);
    },
  };
  const items = await runCleanupBatch(
    ["a", "busy", "expired", "b"].map((id) => entry(id)),
    steps,
    () => false,
    () => {},
  );
  expect(calls).toEqual([
    "plan a",
    "execute plan-a",
    "plan busy",
    "plan expired",
    "execute plan-expired",
    "cancel plan-expired",
    "plan b",
    "execute plan-b",
  ]);
  expect(items.map((item) => item.planId ?? item.error)).toEqual([
    "plan-a",
    "in use",
    "expired",
    "plan-b",
  ]);

  let stop = false;
  const stopped = await runCleanupBatch(
    ["a", "b"].map((id) => entry(id)),
    steps,
    () => stop,
    () => {
      stop = true;
    },
  );
  expect(stopped.map((item) => item.planId ?? "not run")).toEqual(["plan-a", "not run"]);
});
