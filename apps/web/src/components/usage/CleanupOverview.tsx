import { serverCopy } from "~/i18n/serverCopy";
import { uiText } from "../../i18n";
import { UsageDetailsSheet } from "./UsageDetailsSheet";
import { cleanupRisk } from "./cleanupModel";
import { useTheme } from "../../hooks/useTheme";
import { CleanupDashboard, CleanupHistory } from "./CleanupDashboard";
import { UsageCount } from "./UsageMotion";
import { HardDriveIcon, LockKeyholeIcon, ArrowRightIcon } from "lucide-react";
import { cleanupCategoryLabel } from "./cleanupText";
import type { StorageActionInput, StorageInspection, StorageOperation } from "@t3tools/contracts";
import { useRef, useState } from "react";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { formatBytes } from "../../lib/formatBytes";
import {
  cleanupSuggestionGroups,
  selectedReleaseBytes,
  GIB,
  selectedCleanupEntries,
  volumeGauge,
} from "./cleanupModel";
import { type StorageEntry } from "./storageInventoryModel";
import { CleanupDetails } from "./CleanupDetails";
import { CleanupRecords } from "./CleanupRecords";
import { hostCopy } from "./hostCopy";
import styles from "./cleanupOverview.module.css";

const VISIBLE_ROWS = 8;

function VolumeGauge({ volume }: { volume: StorageInspection["volumes"][number] }) {
  const gauge = volumeGauge(volume);
  return (
    <div data-usage-card className={styles.volume} data-low={gauge.low}>
      <div className="flex items-center justify-between gap-2 text-xs">
        <strong className="flex items-center gap-2">
          <HardDriveIcon className="size-4" />
          {serverCopy(volume.name)}
        </strong>
        <span className="text-muted-foreground">
          {volume.totalBytes ? formatBytes(volume.totalBytes) : uiText("Total unavailable")}
        </span>
      </div>
      <div className="my-3 text-3xl font-semibold tabular-nums">
        <UsageCount value={volume.freeBytes / GIB} format={formatGiB} />
        <span className="ml-1 text-xs font-normal text-muted-foreground">GiB {uiText("free")}</span>
      </div>
      {gauge.freePercent !== null ? (
        <div className="relative h-3 rounded-full bg-muted">
          <div
            className="usage-grow h-full rounded-full bg-primary"
            style={{ width: `${100 - gauge.freePercent}%` }}
          />
          <span
            data-usage-pace
            className="absolute -top-1 h-5 w-px bg-foreground"
            style={{ right: `${gauge.reservePercent ?? 0}%` }}
          />
        </div>
      ) : null}
      <p className="mt-3 text-2xs text-muted-foreground">
        {uiText("Used / available · Reserve")} {volume.reserveGiB ?? 40} GiB
        {volume.reserveGiB === undefined ? uiText(" · display only") : ""}
      </p>
    </div>
  );
}
function formatGiB(n: number) {
  return n.toFixed(1);
}

export function CleanupOverview({
  data,
  allowed,
  busy,
  scanning,
  volumeId,
  onVolumeChange,
  onScan,
  onPreview,
  onPreviewBatch,
  completed,
  previewPlan,
  onSettings,
  windows = false,
}: {
  windows?: boolean;
  onSettings?: (input: Extract<StorageActionInput, { action: "cleanup-settings" }>) => void;
  data: StorageInspection;
  allowed: boolean;
  busy: boolean;
  scanning: boolean;
  volumeId: string;
  onVolumeChange: (id: string) => void;
  onScan: () => void;
  onPreview: (entry: StorageEntry) => void;
  onPreviewBatch: (entries: ReadonlyArray<StorageEntry>) => void;
  onLogsPreview: () => void;
  completed: StorageOperation | undefined;
  previewPlan: StorageOperation | null;
}) {
  const { theme } = useTheme();
  const apple = theme === "apple";
  const [diskPath, setDiskPath] = useState("/");
  const [detailEntry, setDetailEntry] = useState<StorageEntry | null>(null);
  const awaitingConfirmation = previewPlan?.phase === "planned";
  const controlsDisabled = busy || awaitingConfirmation;
  const [selection, setSelection] = useState<ReadonlySet<string> | undefined>(undefined);
  const picked = selectedCleanupEntries(data.entries, selection);
  const pickedIds = new Set(picked.map((entry) => entry.id));
  const selected = picked.length === 1 ? picked[0] : undefined;
  const batch = picked.length > 1;
  // Archives need a destination volume and their own preview, so they never join a batch.
  const batchBlocked = batch && picked.some((entry) => !entry.destination);
  const pickedBytes = picked.reduce((sum, entry) => sum + Math.max(0, entry.bytes ?? 0), 0);
  const choose = (ids: ReadonlyArray<string>, on: boolean) => {
    const next = new Set(pickedIds);
    for (const id of ids)
      if (on) next.add(id);
      else next.delete(id);
    setSelection(next);
  };
  const suggestionsRef = useRef<HTMLElement>(null);
  const [reviewRequest, setReviewRequest] = useState(0);
  const suggestions = cleanupSuggestionGroups(data.entries);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const releaseBytes = selectedReleaseBytes(picked);
  const reviewEntries = data.entries.filter((e) => cleanupRisk(e) === "review" && e.bytes !== 0);
  const reviewBytes = reviewEntries.reduce((sum, e) => sum + Math.max(0, e.bytes ?? 0), 0);
  const hasReview = reviewEntries.length > 0;
  const showSuggestions = () => {
    setReviewRequest((request) => request + 1);
    suggestionsRef.current?.scrollIntoView({ block: "start" });
  };
  type Group = (typeof suggestions)[number];
  const bytesText = (bytes: number | null | undefined) =>
    bytes == null ? uiText("Not measured") : formatBytes(bytes);
  const titleFor = (g: Group) =>
    g.risk === "locked"
      ? uiText("Protected · list only")
      : g.entries.length === 1
        ? serverCopy(g.entries[0]!.name)
        : g.category === "installers"
          ? uiText(g.destination === "trash" ? "Downloaded installers" : "App update installers")
          : g.category === "rollback-apps"
            ? uiText("Old T3 rollback apps")
            : g.category === "old-builds"
              ? uiText("Build staging")
              : g.category === "cold-backups"
                ? uiText("Cold backups")
                : cleanupCategoryLabel(g.category);
  const noteFor = (g: Group) =>
    g.risk === "locked"
      ? uiText("Keep in place")
      : g.destination === "trash"
        ? uiText(hostCopy("Move to Trash · no immediate space released", windows))
        : g.destination === "delete-rebuildable"
          ? uiText("Delete · rebuildable")
          : uiText("Free after verifying archive");
  const renderRow = (g: Group, entry: StorageEntry) =>
    apple ? (
      <div key={entry.id} className="usage-clean-row">
        <input
          type="checkbox"
          aria-label={uiText("Select {name}", { name: serverCopy(entry.name) })}
          checked={pickedIds.has(entry.id)}
          disabled={g.risk === "locked" || controlsDisabled || !allowed}
          onChange={(event) => choose([entry.id], event.target.checked)}
        />
        <button type="button" onClick={() => setDetailEntry(entry)}>
          <strong>{serverCopy(entry.name)}</strong>
          <small>{noteFor(g)}</small>
        </button>
        <span>{bytesText(entry.bytes)}</span>
        <span className="usage-tag">
          {g.risk === "locked"
            ? uiText("Protected")
            : cleanupRisk(entry) === "safe"
              ? uiText("Safe")
              : uiText("Confirmation needed")}
        </span>
      </div>
    ) : (
      <label key={entry.id} className={styles.row}>
        {g.risk === "locked" ? (
          <LockKeyholeIcon className="size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <input
            type="checkbox"
            aria-label={`${uiText("Select")} ${serverCopy(entry.name)}`}
            checked={pickedIds.has(entry.id)}
            disabled={controlsDisabled || !allowed}
            onChange={(event) => choose([entry.id], event.target.checked)}
          />
        )}
        <Tooltip>
          <TooltipTrigger render={<span className={styles.entryName} />}>
            {serverCopy(entry.name)}
          </TooltipTrigger>
          <TooltipPopup>
            <div className="max-w-md break-all">{entry.path}</div>
            {entry.reason ? (
              <div className="max-w-md text-muted-foreground">{serverCopy(entry.reason)}</div>
            ) : null}
          </TooltipPopup>
        </Tooltip>
        {cleanupRisk(entry) === "review" && g.entries.some((e) => cleanupRisk(e) === "safe") ? (
          <span className={styles.tag}>{uiText("Confirmation needed")}</span>
        ) : null}
        <span className={styles.entryBytes}>{bytesText(entry.bytes)}</span>
      </label>
    );
  const renderGroup = (g: Group) => {
    const all = expanded.has(g.id) || g.entries.length <= VISIBLE_ROWS + 1;
    const ids = g.entries.map((entry) => entry.id);
    const count = ids.filter((id) => pickedIds.has(id)).length;
    return (
      <details
        key={`${g.id}:${reviewRequest}`}
        className={styles.group}
        data-risk={g.risk}
        open={
          (count > 0 && count < ids.length) ||
          (reviewRequest > 0 && g.risk === "review") ||
          undefined
        }
      >
        <summary>
          {g.risk === "locked" ? null : (
            <input
              type="checkbox"
              className={styles.groupCheck}
              aria-label={uiText("Select all in {name}", { name: titleFor(g) })}
              checked={count === ids.length}
              ref={(input) => {
                if (input) input.indeterminate = count > 0 && count < ids.length;
              }}
              disabled={controlsDisabled || !allowed}
              onChange={(event) => choose(ids, event.target.checked)}
            />
          )}
          <span className={styles.groupTitle}>
            {titleFor(g)}
            {g.entries.length > 1 ? <small> · {g.entries.length}</small> : null}
          </span>
          <span className={styles.note}>{noteFor(g)}</span>
          <span className={styles.entryBytes}>
            {g.incomplete && g.bytes ? "≥ " : ""}
            {g.bytes || !g.incomplete ? formatBytes(g.bytes) : uiText("Not measured")}
          </span>
        </summary>
        <div className={styles.rows}>
          {(all ? g.entries : g.entries.slice(0, VISIBLE_ROWS)).map((entry) => renderRow(g, entry))}
          {all ? null : (
            <button
              type="button"
              className={styles.clear}
              onClick={() => setExpanded(new Set(expanded).add(g.id))}
            >
              {uiText("Show {count} more", { count: g.entries.length - VISIBLE_ROWS })}
            </button>
          )}
        </div>
      </details>
    );
  };
  const targets = data.volumes.filter((volume) => volume.internal === false);
  const target = targets.find((volume) => volume.id === volumeId);
  const action = apple ? (
    <div className="usage-clean-action">
      <span>
        {uiText("Selected")} <strong>{(pickedBytes / GIB).toFixed(1)} GiB</strong>
        {picked.some((entry) => cleanupRisk(entry) === "review")
          ? uiText(" · Review required")
          : ""}
      </span>
      <button
        type="button"
        disabled={
          !allowed ||
          controlsDisabled ||
          scanning ||
          !picked.length ||
          batchBlocked ||
          (selected !== undefined && !selected.destination && !target)
        }
        onClick={() => (batch ? onPreviewBatch(picked) : selected && onPreview(selected))}
      >
        {busy
          ? uiText("Working…")
          : awaitingConfirmation
            ? uiText("Confirm the plan")
            : batch
              ? uiText("Preview cleanup ({count} items)", { count: picked.length })
              : uiText("Preview cleanup")}
      </button>
      {selected && !selected.destination ? (
        <label>
          {uiText("Archive to")}
          <select
            value={volumeId}
            disabled={controlsDisabled}
            onChange={(event) => onVolumeChange(event.target.value)}
          >
            <option value="">{uiText("Choose external volume")}</option>
            {targets.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </div>
  ) : (
    <div data-usage-card className={styles.action} data-clean-action={apple || undefined}>
      <span className={styles.eyebrow}>{uiText("Freed by selection")}</span>
      {releaseBytes > 0 ? (
        <div className={styles.amount}>
          <strong key={releaseBytes} className={styles.number}>
            {(releaseBytes / GIB).toFixed(1)}
          </strong>
          <span>GiB</span>
        </div>
      ) : (
        <strong className={styles.emptyAmount}>
          {uiText("No safe items selected for release")}
        </strong>
      )}
      <p>
        {releaseBytes > 0
          ? uiText(
              hostCopy(
                "Trash moves are not counted; actual free space is measured after completion.",
                windows,
              ),
            )
          : hasReview
            ? `${uiText("Another")} ${(reviewBytes / GIB).toFixed(1)} GiB ${uiText("needs your review")}`
            : uiText("Scan or select a verified object from the suggestions.")}
      </p>
      <Button
        size="lg"
        disabled={
          !allowed ||
          controlsDisabled ||
          scanning ||
          batchBlocked ||
          (selected !== undefined && !selected.destination && !target)
        }
        onClick={() =>
          batch
            ? onPreviewBatch(picked)
            : selected
              ? onPreview(selected)
              : suggestions.length
                ? showSuggestions()
                : onScan()
        }
      >
        {awaitingConfirmation ? (
          uiText("Confirm the plan below")
        ) : busy ? (
          uiText("Processing…")
        ) : picked.length ? (
          <>
            {batch
              ? uiText("Preview cleanup ({count} items)", { count: picked.length })
              : uiText("Preview cleanup")}
            <ArrowRightIcon className="size-4" />
          </>
        ) : hasReview ? (
          uiText("Review confirmation items")
        ) : suggestions.length ? (
          uiText("View suggestions")
        ) : (
          uiText("Scan")
        )}
      </Button>
      {picked.length ? (
        <span className={styles.hint}>
          {batch
            ? uiText("{count} selected · {size}", {
                count: picked.length,
                size: formatBytes(pickedBytes),
              })
            : `${uiText("Selected")} ${serverCopy(selected!.name)} · ${bytesText(selected!.bytes)}`}
          {batchBlocked ? ` · ${uiText("Archive items must be previewed one at a time.")}` : ""}
        </span>
      ) : null}
      {selected && !selected.destination ? (
        <label className={styles.destination}>
          {uiText("Archive destination")}
          <select
            value={volumeId}
            disabled={controlsDisabled}
            onChange={(event) => onVolumeChange(event.target.value)}
          >
            <option value="">{uiText("Choose external volume")}</option>
            {targets.map((volume) => (
              <option key={volume.id} value={volume.id}>
                {serverCopy(volume.name)} · {formatBytes(volume.freeBytes)}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </div>
  );
  return (
    <div className={styles.root} data-clean-dashboard={apple || undefined}>
      <header className={styles.heading}>
        <h3>{uiText("Cleanup & organization")}</h3>
        <Button
          variant="outline"
          size="sm"
          disabled={controlsDisabled || scanning}
          onClick={onScan}
        >
          {scanning ? uiText("Scanning…") : uiText("Scan sizes")}
        </Button>
      </header>
      <div className={styles.scanWrap} data-scanning={scanning || undefined}>
        <div className={styles.scanInner}>
          <p role="status" className={styles.scan}>
            {scanning ? (
              <>
                {uiText("Measuring managed directories. No files are being removed.")}
                {data.scan
                  ? ` ${data.scan.checked} / ${data.scan.total} · ${data.scan.current}`
                  : ""}
              </>
            ) : null}
          </p>
        </div>
      </div>
      {apple ? (
        <CleanupDashboard
          data={data}
          releaseBytes={releaseBytes}
          volumePath={diskPath}
          onVolumeChange={setDiskPath}
        />
      ) : null}
      <div className={styles.hero}>
        {action}
        <div className={styles.volumes}>
          {data.volumes.map((volume) => (
            <VolumeGauge key={volume.id} volume={volume} />
          ))}
          {data.volumes.length === 0 ? <p>{uiText("Volume information unavailable.")}</p> : null}
        </div>
      </div>
      {completed ? (
        <div key={completed.id} role="status" className={styles.completed}>
          <strong>{uiText("Cleanup completed")}</strong>
          {completed.freeBefore !== undefined && completed.freeAfter !== undefined ? (
            <span>
              {uiText("Observed free-space change.")}{" "}
              {completed.freeAfter >= completed.freeBefore ? "+" : "−"}
              {formatBytes(Math.abs(completed.freeAfter - completed.freeBefore))} ·{" "}
              {uiText("includes other disk activity")}
            </span>
          ) : (
            <span>{uiText("Refreshing space measurements")}</span>
          )}
        </div>
      ) : null}
      {apple ? (
        <CleanupDetails
          selectedVolumePath={diskPath}
          data={data}
          disabled={controlsDisabled || !allowed}
          onSettings={onSettings}
          onSelect={(id) => setSelection(new Set([id]))}
          windows={windows}
        />
      ) : null}
      <section
        ref={suggestionsRef}
        className={styles.suggestions}
        aria-label={uiText("Cleanup suggestions")}
      >
        <h4 className={styles.listTitle}>{uiText("Cleanup suggestions")}</h4>
        {[
          ...new Set([...data.volumes.map((v) => v.path), ...suggestions.map((g) => g.volumePath)]),
        ].map((path, _index, paths) => {
          const items = suggestions.filter((g) => g.volumePath === path);
          if (!items.length) return null;
          return (
            <div key={path} className={styles.volumeGroup}>
              {paths.length > 1 ? (
                <h4>{serverCopy(data.volumes.find((v) => v.path === path)?.name ?? path)}</h4>
              ) : null}
              {items.map(renderGroup)}
            </div>
          );
        })}
        {!suggestions.length ? <p>{uiText("No nonempty objects in this scan.")}</p> : null}
        {picked.length ? (
          <button
            className={styles.clear}
            type="button"
            disabled={controlsDisabled}
            onClick={() => setSelection(new Set())}
          >
            {uiText("Clear selection")}
          </button>
        ) : null}
        {apple ? action : null}
        {data.truncated ? (
          <p className="text-xs text-muted-foreground" data-scan-limit-note>
            {uiText("Scan limit reached; inspect individual directories below.")}
          </p>
        ) : null}
      </section>
      {apple ? (
        <div className="usage-clean-bottom" data-single>
          <CleanupHistory data={data} />
          {data.archives.length || data.operations.length ? <CleanupRecords data={data} /> : null}
        </div>
      ) : null}
      {detailEntry ? (
        <UsageDetailsSheet
          open
          onOpenChange={(open) => {
            if (!open) setDetailEntry(null);
          }}
          title={serverCopy(detailEntry.name)}
          description={
            cleanupRisk(detailEntry) === "locked"
              ? uiText("Protected and excluded from cleanup")
              : uiText("Review paths and actions")
          }
        >
          <div className="usage-clean-detail">
            <p>{serverCopy(detailEntry.reason ?? "")}</p>
            <p>{detailEntry.path}</p>
            {detailEntry.childPaths?.map((path) => (
              <p key={path}>{path}</p>
            ))}
            <p>{detailEntry.modifiedAt ?? detailEntry.lastModified}</p>
            <p>
              {detailEntry.bytes == null ? uiText("Unmeasured") : formatBytes(detailEntry.bytes)}
            </p>
          </div>
        </UsageDetailsSheet>
      ) : null}
      {!apple ? (
        <CleanupDetails
          data={data}
          disabled={controlsDisabled || !allowed}
          onSettings={onSettings}
          onSelect={(id) => setSelection(new Set([id]))}
          windows={windows}
        />
      ) : null}
      <p className={styles.scope}>
        {uiText(
          hostCopy(
            "Bounded allowlist scan; protected data is never selected. Trash does not free disk space.",
            windows,
          ),
        )}
      </p>
      {!allowed ? (
        <p className={styles.scope}>{uiText("This connection has view-only storage access")}</p>
      ) : null}
    </div>
  );
}
