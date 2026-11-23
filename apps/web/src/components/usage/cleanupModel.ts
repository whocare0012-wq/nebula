import type { StorageInspection } from "@t3tools/contracts";
import { storageTabFor, type StorageEntry } from "./storageInventoryModel";

const DISPLAY_RESERVE_GIB = 40;
export const GIB = 1024 ** 3;

export function cleanupRisk(entry: StorageEntry): "safe" | "review" | "locked" {
  if (storageTabFor(entry) === "protected") return "locked";
  if (entry.destination !== undefined) {
    if (entry.locked || !entry.canRelease) return "locked";
    return entry.risk === "safe" && entry.rebuildable && entry.destination === "delete-rebuildable"
      ? "safe"
      : "review";
  }
  if (!entry.canRelease || entry.canArchive === false || storageTabFor(entry) === "protected")
    return "locked";
  return ["builds", "dependencies", "cache"].includes(entry.kind) ? "safe" : "review";
}

export function selectedCleanupEntry(
  entries: ReadonlyArray<StorageEntry>,
  selection: string | null | undefined,
): StorageEntry | undefined {
  const entry =
    selection === undefined
      ? entries
          .filter((item) => cleanupRisk(item) === "safe" && (item.bytes ?? 0) >= 200_000_000)
          .toSorted((a, b) => (b.bytes ?? 0) - (a.bytes ?? 0))[0]
      : entries.find((item) => item.id === selection);
  return entry && entry.bytes !== 0 && cleanupRisk(entry) !== "locked" ? entry : undefined;
}

export function volumeGauge(volume: StorageInspection["volumes"][number]) {
  const total = volume.totalBytes;
  const reserve = volume.reserveGiB ?? DISPLAY_RESERVE_GIB;
  const knownTotal = total !== undefined && Number.isFinite(total) && total > 0;
  return {
    low: volume.freeBytes < reserve * GIB,
    freePercent: knownTotal ? Math.max(0, Math.min(100, (volume.freeBytes / total) * 100)) : null,
    reservePercent: knownTotal ? Math.min(100, ((reserve * GIB) / total) * 100) : null,
  };
}

export function latestCleanupScan(
  data: StorageInspection["scan"],
  status: StorageInspection["scan"],
) {
  if (!status) return data;
  if (!data) return status;
  return (data.requestId ?? 0) > (status.requestId ?? 0) ? data : status;
}

export function selectedSafeBytes(entry: StorageEntry | undefined): number {
  return entry && cleanupRisk(entry) === "safe" ? Math.max(0, entry.bytes ?? 0) : 0;
}

export function cleanupSuggestionGroups(entries: ReadonlyArray<StorageEntry>) {
  const grouped = new Map<
    string,
    {
      id: string;
      category: string;
      volumePath: string;
      risk: ReturnType<typeof cleanupRisk>;
      entries: StorageEntry[];
      bytes: number;
      incomplete: boolean;
      small: boolean;
    }
  >();
  for (const entry of entries) {
    if (entry.bytes === 0) continue;
    const risk = cleanupRisk(entry),
      category = entry.category ?? entry.kind;
    const volumePath = entry.volumePath ?? "/";
    const aggregate = ["rollback-apps", "old-builds", "cold-backups"].includes(category);
    const id = `${volumePath}:${risk}:${aggregate ? category : entry.id}`;
    const group = grouped.get(id) ?? {
      id,
      category,
      volumePath,
      risk,
      entries: [],
      bytes: 0,
      incomplete: false,
      small: false,
    };
    group.entries.push(entry);
    group.bytes += Math.max(0, entry.bytes ?? 0);
    group.incomplete ||= entry.bytes == null;
    grouped.set(id, group);
  }
  return [...grouped.values()]
    .map((g) => ({
      ...g,
      entries: g.entries.toSorted((a, b) => (b.bytes ?? 0) - (a.bytes ?? 0)),
      small: !g.incomplete && g.bytes < 50_000_000,
    }))
    .toSorted((a, b) => b.bytes - a.bytes || a.id.localeCompare(b.id));
}
