import { serverCopy } from "~/i18n/serverCopy";
import { uiText } from "../../i18n";
import { UsageDetailsSheet } from "./UsageDetailsSheet";
import { cleanupRisk } from "./cleanupModel";
import { useTheme } from "../../hooks/useTheme";
import { CleanupDashboard, CleanupHistory } from "./CleanupDashboard";
import { UsageCount } from "./UsageMotion";
import { HardDriveIcon, LockKeyholeIcon, FolderArchiveIcon, ArrowRightIcon } from "lucide-react";
import type { StorageActionInput, StorageInspection, StorageOperation } from "@t3tools/contracts";
import { useId, useRef, useState } from "react";
import { Button } from "../ui/button";
import { formatBytes } from "../../lib/formatBytes";
import {
  cleanupSuggestionGroups,
  selectedSafeBytes,
  GIB,
  selectedCleanupEntry,
  volumeGauge,
} from "./cleanupModel";
import { type StorageEntry } from "./storageInventoryModel";
import { CleanupDetails } from "./CleanupDetails";
import { CleanupRecords } from "./CleanupRecords";
import { hostCopy } from "./hostCopy";
import styles from "./cleanupOverview.module.css";

const groups = [
  { id: "safe", label: "Verified generated files" },
  { id: "review", label: "Needs your confirmation" },
  { id: "locked", label: "Protected / Unverified" },
] as const;

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
  onLogsPreview: () => void;
  completed: StorageOperation | undefined;
  previewPlan: StorageOperation | null;
}) {
  const { theme } = useTheme();
  const apple = theme === "apple";
  const selectionName = useId();
  const [diskPath, setDiskPath] = useState("/");
  const [detailEntry, setDetailEntry] = useState<StorageEntry | null>(null);
  const awaitingConfirmation = previewPlan?.phase === "planned";
  const controlsDisabled = busy || awaitingConfirmation;
  const [selection, setSelection] = useState<string | null | undefined>(undefined);
  const selected = selectedCleanupEntry(data.entries, selection);
  const suggestionsRef = useRef<HTMLElement>(null);
  const [reviewRequest, setReviewRequest] = useState(0);
  const suggestions = cleanupSuggestionGroups(data.entries);
  const releaseBytes = selectedSafeBytes(selected);
  const reviewBytes = suggestions
    .filter((g) => g.risk === "review")
    .reduce((sum, g) => sum + g.bytes, 0);
  const hasReview = suggestions.some((g) => g.risk === "review");
  const small = suggestions.filter((g) => g.small);
  const showSuggestions = () => {
    setReviewRequest((request) => request + 1);
    suggestionsRef.current?.scrollIntoView({ block: "start" });
  };
  const titleFor = (g: (typeof suggestions)[number]) =>
    g.entries.length === 1
      ? g.entries[0]!.name
      : `${g.category === "rollback-apps" ? uiText("Old T3 rollback apps") : g.category === "old-builds" ? uiText("Build staging") : uiText("Cold backups")} ×${g.entries.length}`;
  const renderSuggestion = (g: (typeof suggestions)[number]) =>
    apple ? (
      <div key={g.id}>
        {g.entries.map((entry) => (
          <div key={entry.id} className="usage-clean-row">
            <input
              type="checkbox"
              aria-label={uiText("Select {name}", { name: serverCopy(entry.name) })}
              checked={selected?.id === entry.id}
              disabled={g.risk === "locked" || controlsDisabled || !allowed}
              onChange={(event) => setSelection(event.target.checked ? entry.id : null)}
            />
            <button type="button" onClick={() => setDetailEntry(entry)}>
              <strong>{serverCopy(entry.name)}</strong>
              <small>
                {entry.destination === "trash"
                  ? uiText(hostCopy("Move to Trash · Space stays occupied", windows))
                  : entry.destination === "delete-rebuildable"
                    ? uiText("Delete rebuildable files")
                    : g.risk === "locked"
                      ? uiText("Keep in place")
                      : uiText("Free after verifying archive")}
              </small>
            </button>
            <span>{entry.bytes == null ? uiText("Not measured") : formatBytes(entry.bytes)}</span>
            <span className="usage-tag">
              {g.risk === "safe"
                ? uiText("Safe")
                : g.risk === "review"
                  ? uiText("Confirmation needed")
                  : uiText("Protected")}
            </span>
          </div>
        ))}
      </div>
    ) : (
      <div key={g.id} className={styles.entry} data-risk={g.risk}>
        <div className={styles.entryChoice}>
          <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted">
            {g.risk === "locked" ? (
              <LockKeyholeIcon className="size-4" />
            ) : (
              <FolderArchiveIcon className="size-4" />
            )}
          </span>
          <strong className={styles.entryName}>{titleFor(g)}</strong>
          <span className="rounded-full bg-muted px-2 py-0.5 text-3xs">
            {g.risk === "safe"
              ? uiText("Safe")
              : g.risk === "review"
                ? uiText("Review.")
                : uiText("Protected")}
          </span>
          <span className={styles.entryBytes}>
            {g.incomplete ? (g.bytes ? "≥ " : "") : ""}
            {g.bytes || !g.incomplete ? formatBytes(g.bytes) : uiText("Not measured.")}
          </span>
        </div>
        <p>
          {g.risk === "locked" ? uiText("Locked · ") : ""}
          {serverCopy(g.entries[0]!.reason)}
        </p>
        <p>
          {g.entries[0]!.destination === "trash"
            ? uiText(hostCopy("Move to Trash · no immediate space released", windows))
            : g.entries[0]!.destination === "delete-rebuildable"
              ? uiText("Delete · rebuildable")
              : ""}
        </p>
        <details
          className={styles.path}
          open={(g.entries.length > 1 && g.entries.some((e) => e.id === selected?.id)) || undefined}
        >
          <summary>{uiText("Paths and dates · review one item at a time")}</summary>
          {g.entries.map((entry) => (
            <div key={entry.id}>
              <label className={styles.entryChoice}>
                {g.entries.length > 1 ? (
                  <input
                    type="radio"
                    name={selectionName}
                    checked={selected?.id === entry.id}
                    disabled={g.risk === "locked" || controlsDisabled || !allowed}
                    onChange={() => setSelection(entry.id)}
                  />
                ) : null}
                <span className={styles.entryName}>{entry.path}</span>
                <span>
                  {entry.bytes == null ? uiText("Not measured.") : formatBytes(entry.bytes)}
                </span>
              </label>
              {entry.childPaths?.map((path) => (
                <span key={path}>{path}</span>
              ))}
              {entry.modifiedAt ? <span>{new Date(entry.modifiedAt).toLocaleString()}</span> : null}
            </div>
          ))}
        </details>
        {g.entries.length === 1 && g.risk !== "locked" ? (
          <label className={styles.entryChoice}>
            <input
              type="radio"
              name={selectionName}
              aria-label={`${uiText("Select")} ${g.entries[0]!.name}`}
              checked={selected?.id === g.entries[0]!.id}
              disabled={controlsDisabled || !allowed}
              onChange={() => setSelection(g.entries[0]!.id)}
            />
            <span>{uiText("Select for preview")}</span>
          </label>
        ) : null}
      </div>
    );
  const targets = data.volumes.filter((volume) => volume.internal === false);
  const target = targets.find((volume) => volume.id === volumeId);
  const action = apple ? (
    <div className="usage-clean-action">
      <span>
        {uiText("Selected")}{" "}
        <strong>{selected?.bytes == null ? "0" : (selected.bytes / GIB).toFixed(1)} GiB</strong>
        {selected && cleanupRisk(selected) === "review" ? uiText(" · Review required") : ""}
      </span>
      <button
        type="button"
        disabled={
          !allowed ||
          controlsDisabled ||
          scanning ||
          !selected ||
          (!selected.destination && !target)
        }
        onClick={() => {
          if (selected) onPreview(selected);
        }}
      >
        {busy
          ? uiText("Working…")
          : awaitingConfirmation
            ? uiText("Confirm the plan")
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
      <span className={styles.eyebrow}>{uiText("Selected safe space")}</span>
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
              "Only the selected safe object is counted; actual free space is measured after completion.",
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
          (selected !== undefined && !selected.destination && !target)
        }
        onClick={() =>
          selected ? onPreview(selected) : suggestions.length ? showSuggestions() : onScan()
        }
      >
        {awaitingConfirmation ? (
          uiText("Confirm the plan below")
        ) : busy ? (
          uiText("Processing…")
        ) : selected ? (
          <>
            {uiText("Preview cleanup")}
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
      <span className={styles.hint}>
        {selected
          ? `${uiText("Selected")} ${selected.name} · ${selected.bytes == null ? uiText("Not measured.") : formatBytes(selected.bytes)}`
          : uiText("Logs older than 30 days; confirm the exact list before cleanup.")}
      </span>
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
        <div>
          <h3>{uiText("Cleanup & organization")}</h3>
          <p>{uiText("Preview paths and destinations before confirming.")}</p>
        </div>
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
          onSelect={(id) => setSelection(id)}
          windows={windows}
        />
      ) : null}
      <section
        ref={suggestionsRef}
        className={styles.suggestions}
        aria-label={uiText("Cleanup suggestions")}
      >
        <div className={styles.listHeading}>
          <h4>{uiText("Cleanup suggestions")}</h4>
          <span>{uiText("Largest safe object ≥200 MB preselected; review each path.")}</span>
        </div>
        {[
          ...new Set([...data.volumes.map((v) => v.path), ...suggestions.map((g) => g.volumePath)]),
        ].map((path) => {
          const items = suggestions.filter((g) => g.volumePath === path && !g.small);
          if (!items.length) return null;
          return (
            <div key={path} className={styles.volumeGroup}>
              <h4>{data.volumes.find((v) => v.path === path)?.name ?? path}</h4>
              {groups.map((group) => {
                const objects = items.filter((g) => g.risk === group.id);
                if (!objects.length) return null;
                return (
                  <details
                    key={`${group.id}:${reviewRequest}`}
                    className={styles.group}
                    open={group.id !== "locked" || undefined}
                  >
                    <summary>
                      <span>{uiText(group.label)}</span>
                      <span>
                        {objects.length}{" "}
                        {uiText(objects.length === 1 ? "cleanup item" : "cleanup items")}
                      </span>
                    </summary>
                    <div className={styles.entries}>{objects.map(renderSuggestion)}</div>
                  </details>
                );
              })}
            </div>
          );
        })}
        {small.length ? (
          <details className={styles.group}>
            <summary>
              <span>
                {uiText("And")} {small.length}{" "}
                {uiText(small.length === 1 ? "small item (<50 MB)" : "small items (<50 MB)")}
              </span>
            </summary>
            <div className={styles.entries}>{small.map(renderSuggestion)}</div>
          </details>
        ) : null}
        {!suggestions.length ? <p>{uiText("No nonempty objects in this scan.")}</p> : null}
        {selected ? (
          <button
            className={styles.clear}
            type="button"
            disabled={controlsDisabled}
            onClick={() => setSelection(null)}
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
          onSelect={(id) => setSelection(id)}
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
