import { serverCopy } from "~/i18n/serverCopy";
import { uiText } from "../../i18n";
import { Tooltip, TooltipTrigger, TooltipPopup } from "../ui/tooltip";
import { useTheme } from "../../hooks/useTheme";
import { useState } from "react";
import type { StorageActionInput, StorageInspection } from "@t3tools/contracts";
import { Button } from "../ui/button";
import { cleanupRisk, GIB } from "./cleanupModel";
import { formatBytes } from "../../lib/formatBytes";
import { cleanupCategoryLabel } from "./cleanupText";
import styles from "./cleanupOverview.module.css";
import { hostCopy } from "./hostCopy";

function splitTiles(
  rows: ReadonlyArray<{ id: string; bytes: number }>,
  x = 0,
  y = 0,
  width = 100,
  height = 100,
): Array<{ id: string; x: number; y: number; width: number; height: number }> {
  if (!rows.length) return [];
  if (rows.length === 1) return [{ id: rows[0]!.id, x, y, width, height }];
  const total = rows.reduce((sum, r) => sum + r.bytes, 0);
  let cut = 1,
    sum = rows[0]!.bytes;
  while (cut < rows.length - 1 && sum < total / 2) {
    sum += rows[cut]!.bytes;
    cut++;
  }
  const fraction = sum / total;
  return width >= height
    ? [
        ...splitTiles(rows.slice(0, cut), x, y, width * fraction, height),
        ...splitTiles(rows.slice(cut), x + width * fraction, y, width * (1 - fraction), height),
      ]
    : [
        ...splitTiles(rows.slice(0, cut), x, y, width, height * fraction),
        ...splitTiles(rows.slice(cut), x, y + height * fraction, width, height * (1 - fraction)),
      ];
}

export function CleanupDetails({
  data,
  disabled,
  onSettings,
  onSelect,
  selectedVolumePath,
  windows = false,
}: {
  windows?: boolean;
  selectedVolumePath?: string;
  data: StorageInspection;
  disabled: boolean;
  onSettings?:
    | ((input: Extract<StorageActionInput, { action: "cleanup-settings" }>) => void)
    | undefined;
  onSelect: (id: string) => void;
}) {
  const { theme } = useTheme();
  const apple = theme === "apple";
  const [volumePath, setVolumePath] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const volume =
    data.volumes.find((v) => v.path === (selectedVolumePath ?? volumePath)) ?? data.volumes[0];
  const entries = data.entries.filter(
    (e) => (!volume || e.volumePath === volume.path) && e.bytes != null && e.bytes > 0,
  );
  const nonOverlapping = entries.filter(
    (e) =>
      !entries.some(
        (other) =>
          !other.id.endsWith(":remainder") &&
          other.id !== e.id &&
          e.path.startsWith(other.path + "/"),
      ),
  );
  const keyFor = (e: (typeof entries)[number]) =>
    cleanupRisk(e) === "locked" ? e.id : (e.category ?? e.kind);
  const grouped = new Map<string, number>();
  for (const e of nonOverlapping)
    grouped.set(keyFor(e), (grouped.get(keyFor(e)) ?? 0) + (e.bytes ?? 0));
  const rows = category
    ? nonOverlapping
        .filter((e) => (e.category ?? e.kind) === category)
        .map((e) => ({ id: e.id, bytes: e.bytes ?? 0 }))
    : [...grouped].map(([id, bytes]) => ({ id, bytes }));
  const tiles = splitTiles(rows.toSorted((a, b) => b.bytes - a.bytes));
  return (
    <details className={styles.group} data-clean-map={apple || undefined} open={apple || undefined}>
      <summary>
        <span>{apple ? uiText("Space map") : uiText("Space map & protection")}</span>
        {!apple ? <span>{uiText("Expand")}</span> : <span data-usage-map-disk>{volume?.name}</span>}
      </summary>
      <div className={styles.detailsBody}>
        {!apple ? (
          <label className={styles.destination}>
            {uiText("Volume")}
            <select
              value={volume?.path ?? ""}
              onChange={(e) => {
                setVolumePath(e.target.value);
                setCategory(null);
              }}
            >
              {data.volumes.map((v) => (
                <option key={v.id} value={v.path}>
                  {serverCopy(v.name)}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <div className={styles.listHeading}>
          <button type="button" className={styles.clear} onClick={() => setCategory(null)}>
            {uiText("Measured items")}
          </button>
          <span>
            {category ? cleanupCategoryLabel(category) : uiText("Select a category to drill down")}
          </span>
        </div>
        <div
          className={styles.treemap}
          data-empty={tiles.length ? undefined : true}
          aria-label={uiText("Measured storage treemap")}
        >
          {tiles.map((tile, index) => {
            const entry = nonOverlapping.find((e) => e.id === tile.id);
            const row = rows.find((r) => r.id === tile.id)!;
            return (
              <Tooltip key={tile.id}>
                <TooltipTrigger
                  render={<button type="button" />}
                  data-small={tile.width < 18 || tile.height < 14 || undefined}
                  aria-label={`${entry?.path ?? cleanupCategoryLabel(tile.id)} · ${formatBytes(row.bytes)}`}
                  style={{
                    left: `${tile.x}%`,
                    top: `${tile.y}%`,
                    width: `${tile.width}%`,
                    height: `${tile.height}%`,
                    opacity: 1 - (index % 3) * 0.12,
                  }}
                  data-protected={
                    entry
                      ? cleanupRisk(entry) === "locked"
                      : nonOverlapping
                          .filter((e) => (e.category ?? e.kind) === tile.id)
                          .some((e) => cleanupRisk(e) === "locked")
                  }
                  disabled={disabled}
                  onClick={() =>
                    entry
                      ? cleanupRisk(entry) !== "locked"
                        ? onSelect(entry.id)
                        : undefined
                      : setCategory(tile.id)
                  }
                >
                  <strong>
                    {entry?.path.endsWith("/sessions")
                      ? uiText("Conversation records")
                      : (entry?.name ?? cleanupCategoryLabel(tile.id))}
                    {entry && cleanupRisk(entry) === "locked" ? uiText(" · Protected") : ""}
                  </strong>
                  <span>{formatBytes(row.bytes)}</span>
                </TooltipTrigger>
                <TooltipPopup>
                  {entry?.name ?? cleanupCategoryLabel(tile.id)} · {formatBytes(row.bytes)}
                </TooltipPopup>
              </Tooltip>
            );
          })}
          {!tiles.length ? <p>{uiText("No measured entries on this volume yet.")}</p> : null}
        </div>
        <details>
          <summary>{uiText("Protection settings")}</summary>
          <div className={styles.settingsGrid}>
            {data.volumes.map((v) => (
              <form
                className={styles.protection}
                key={`${v.id}:${v.reserveGiB}`}
                onSubmit={(event) => {
                  event.preventDefault();
                  const reserve = Number(new FormData(event.currentTarget).get("reserve"));
                  if (Number.isFinite(reserve) && reserve >= 40 && reserve <= 1024)
                    onSettings?.({
                      action: "cleanup-settings",
                      volumePath: v.path,
                      reserveGiB: reserve,
                    });
                }}
              >
                <strong>{serverCopy(v.name)}</strong>
                <label>
                  {uiText("Reserve GiB (minimum 40)")}
                  <input
                    name="reserve"
                    type="number"
                    min="40"
                    max="1024"
                    step="1"
                    required
                    defaultValue={v.reserveGiB ?? 40}
                    disabled={disabled || !onSettings}
                  />
                </label>
                <Button
                  type="submit"
                  variant="outline"
                  size="sm"
                  disabled={disabled || !onSettings}
                >
                  {uiText("Save")}
                </Button>
                {v.freeBytes < (v.reserveGiB ?? 40) * GIB ? (
                  <p role="alert">{uiText("Below reserve. Execution will be refused.")}</p>
                ) : null}
                {!apple && (v.history?.length ?? 0) > 1 ? (
                  <svg viewBox="0 0 240 60" role="img" aria-label={uiText("Free space history.")}>
                    <polyline
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      points={v
                        .history!.map(
                          (sample, i) =>
                            `${(i * 240) / (v.history!.length - 1)},${55 - Math.min(1, sample.freeBytes / (v.totalBytes ?? Math.max(...v.history!.map((s) => s.freeBytes)))) * 50}`,
                        )
                        .join(" ")}
                    />
                  </svg>
                ) : (
                  <span>{uiText("History accumulates after scans")}</span>
                )}
              </form>
            ))}
          </div>
        </details>
        <label className={styles.entryChoice}>
          <input
            type="checkbox"
            checked={data.scanOnOpenDaily ?? false}
            disabled={disabled || !onSettings}
            onChange={(event) =>
              onSettings?.({ action: "cleanup-settings", scanOnOpenDaily: event.target.checked })
            }
          />
          {uiText("Scan once daily when this page is opened")}
        </label>
        <p className={styles.scope}>
          {uiText(
            hostCopy(
              "No background timer or automatic deletion. Trash is retained until manually restored or emptied.",
              windows,
            ),
          )}
        </p>
      </div>
    </details>
  );
}
