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

/** Space the selection frees once it runs; a Trash move frees nothing until the Trash is emptied. */
export function selectedReleaseBytes(entries: ReadonlyArray<StorageEntry>): number {
  return entries
    .filter((entry) => entry.destination !== "trash")
    .reduce((sum, entry) => sum + Math.max(0, entry.bytes ?? 0), 0);
}

/** `undefined` keeps the single default suggestion; a set is the user's explicit choice. */
export function selectedCleanupEntries(
  entries: ReadonlyArray<StorageEntry>,
  selection: ReadonlySet<string> | undefined,
): StorageEntry[] {
  if (selection === undefined) {
    const suggested = selectedCleanupEntry(entries, undefined);
    return suggested ? [suggested] : [];
  }
  return entries.filter(
    (entry) => selection.has(entry.id) && entry.bytes !== 0 && cleanupRisk(entry) !== "locked",
  );
}

// One row per kind of cleanup; protected items share a single list-only row per volume.
export function cleanupSuggestionGroups(entries: ReadonlyArray<StorageEntry>) {
  const grouped = new Map<
    string,
    {
      id: string;
      category: string;
      destination: StorageEntry["destination"];
      volumePath: string;
      risk: ReturnType<typeof cleanupRisk>;
      entries: StorageEntry[];
      bytes: number;
      incomplete: boolean;
    }
  >();
  for (const entry of entries) {
    if (entry.bytes != null && entry.bytes < 1_000_000) continue;
    const risk = cleanupRisk(entry),
      category = entry.category ?? entry.kind;
    const volumePath = entry.volumePath ?? "/";
    const id =
      risk === "locked"
        ? `${volumePath}:locked`
        : `${volumePath}:${category}:${entry.destination ?? "archive"}`;
    const group = grouped.get(id) ?? {
      id,
      category,
      destination: entry.destination,
      volumePath,
      risk,
      entries: [],
      bytes: 0,
      incomplete: false,
    };
    if (group.risk === "safe" && risk === "review") group.risk = "review";
    group.entries.push(entry);
    group.bytes += Math.max(0, entry.bytes ?? 0);
    group.incomplete ||= entry.bytes == null;
    grouped.set(id, group);
  }
  return [...grouped.values()]
    .map((g) => ({
      ...g,
      entries: g.entries.toSorted((a, b) => (b.bytes ?? 0) - (a.bytes ?? 0)),
    }))
    .toSorted(
      (a, b) =>
        Number(a.risk === "locked") - Number(b.risk === "locked") ||
        b.bytes - a.bytes ||
        a.id.localeCompare(b.id),
    );
}

export type CleanupBatchItem = {
  readonly entry: StorageEntry;
  readonly planId?: string;
  readonly error?: string;
};
type BatchStep = { readonly id: string } | { readonly error: string };

/**
 * Runs items one at a time. Each is planned right before it runs, so its free-space and
 * content checks see what earlier items already released.
 */
export async function runCleanupBatch(
  entries: ReadonlyArray<StorageEntry>,
  steps: {
    readonly plan: (objectId: string) => Promise<BatchStep>;
    readonly execute: (planId: string) => Promise<BatchStep>;
    readonly cancel: (planId: string) => Promise<unknown>;
  },
  shouldStop: () => boolean,
  onProgress: (items: ReadonlyArray<CleanupBatchItem>) => void,
): Promise<ReadonlyArray<CleanupBatchItem>> {
  const items: CleanupBatchItem[] = entries.map((entry) => ({ entry }));
  for (const [index, entry] of entries.entries()) {
    if (shouldStop()) break;
    try {
      const planned = await steps.plan(entry.id);
      if ("error" in planned) items[index] = { entry, error: planned.error };
      else {
        const executed = await steps.execute(planned.id);
        if ("error" in executed) {
          items[index] = { entry, error: executed.error };
          await steps.cancel(planned.id);
        } else items[index] = { entry, planId: executed.id };
      }
    } catch (cause) {
      items[index] = { entry, error: String(cause) };
    }
    onProgress([...items]);
  }
  return items;
}
