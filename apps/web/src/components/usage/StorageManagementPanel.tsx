import { serverCopy } from "~/i18n/serverCopy";
import type { DiskSpaceReport } from "@t3tools/contracts";
import { storagePresentation } from "./storagePresentation";
import { useTheme } from "../../hooks/useTheme";
import { UsageDetailsSheet } from "./UsageDetailsSheet";
import { useUiText } from "~/i18n/useUiText";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useState, useEffect, useRef } from "react";
import { useAtomValue, useAtomRefresh } from "@effect/atom-react";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Option from "effect/Option";
import type { EnvironmentId, StorageActionInput, StorageOperation } from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";

import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { formatBytes } from "../../lib/formatBytes";
import { Button } from "../ui/button";
import { Tabs, TabsList, TabsPanel, TabsTab } from "../ui/tabs";
import {
  filterStorageEntries,
  storageReleaseEstimate,
  type StorageEntry,
  type StorageTab,
} from "./storageInventoryModel";

import { latestCleanupScan, runCleanupBatch, type CleanupBatchItem } from "./cleanupModel";
import { CleanupOverview } from "./CleanupOverview";
import { hostCopy } from "./hostCopy";

const phaseLabel: Record<string, string> = {
  trashed: "Moved to Trash",
  planned: "Awaiting confirmation",
  queued: "Queued",
  started: "Started",
  archiving: "Archiving",
  verifying: "Verifying",
  verified_source_kept: "Archived; original kept",
  retirement_intent: "Preparing release",
  releasing: "Releasing",
  "cleaning-logs": "Releasing",
  restoring: "Restoring",
  completed: "Completed",
  cancelled: "Cancelled",
  failed: "Failed",
  locked: "Needs inspection",
  source_restored: "Original path restored",
};
const activePhases = new Set([
  "queued",
  "started",
  "archiving",
  "verifying",
  "retirement_intent",
  "releasing",
  "restoring",
  "cleaning-logs",
]);
const tabs: ReadonlyArray<{ id: StorageTab; label: string }> = [
  { id: "candidates", label: "Review items" },
  { id: "backups", label: "Backups" },
  { id: "protected", label: "Protected data" },
  { id: "history", label: "Archives and activity" },
];
const kindLabels: Record<string, string> = {
  scratch: "Workspace total",
  workspace: "Project directory",
  dependencies: "Dependencies",
  builds: "Build outputs",
  cache: "AI tool cache",
  logs: "Logs",
  backups: "Backup",
  protected: "Conversation history",
  database: "Chat database",
  attachments: "Attachments",
};

export function StorageManagementPanel({
  diskReport,
  refreshTick = 0,
  environmentId,
  onOperationFinished,
  windows = false,
}: {
  windows?: boolean;
  diskReport?: DiskSpaceReport | null;
  refreshTick?: number;
  environmentId: EnvironmentId;
  onOperationFinished: () => void;
}) {
  const uiText = useUiText();
  const [objectId, setObjectId] = useState<string | undefined>();
  const [tab, setTab] = useState<StorageTab>("candidates");
  const [volumePath, setVolumePath] = useState("");
  const [volumeId, setVolumeId] = useState("");
  const { theme } = useTheme();
  const [plan, setPlan] = useState<StorageOperation | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [batch, setBatch] = useState<{
    readonly items: ReadonlyArray<CleanupBatchItem>;
    readonly stage: "confirm" | "running" | "done";
  } | null>(null);
  const stopBatch = useRef(false);
  const [filter, setFilter] = useState("");
  const [submittedId, setSubmittedId] = useState<string | null>(null);
  const [scanRequest, setScanRequest] = useState<number | undefined>();
  const [measureSizes, setMeasureSizes] = useState(false);
  const atom = serverEnvironment.inspectStorage({
    environmentId,
    input: {
      ...(objectId ? { objectId } : {}),
      measureSizes,
      ...(scanRequest !== undefined ? { scanRequest } : {}),
    },
  });
  const result = useAtomValue(atom);
  const data = Option.getOrNull(AsyncResult.value(result));
  const refresh = useAtomRefresh(atom);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Invalidate inventory on an explicit page refresh without remounting its cards.
  useEffect(() => {
    if (refreshTick > 0) refresh();
  }, [refreshTick, refresh]);
  const allowed = useAtomValue(serverEnvironment.manageStorage.permissionAtom(environmentId));
  const run = useAtomCommand(serverEnvironment.manageStorage, { reportFailure: false });
  const statusAtom = serverEnvironment.inspectStorage({
    environmentId,
    input: { statusOnly: true },
  });
  const statusResult = useAtomValue(statusAtom);
  const statusData = Option.getOrNull(AsyncResult.value(statusResult));
  const refreshStatus = useAtomRefresh(statusAtom);
  const operations = statusData?.operations ?? data?.operations ?? [];
  const [statusUnknown, setStatusUnknown] = useState(false);
  const [submissionBaseline, setSubmissionBaseline] = useState<typeof statusData>(null);
  const missingSubmission =
    submittedId !== null &&
    statusData !== null &&
    statusData !== submissionBaseline &&
    !statusResult.waiting &&
    !operations.some((op) => op.id === submittedId);
  const unknownSubmission = statusUnknown || missingSubmission;
  const submitted =
    !unknownSubmission &&
    submittedId !== null &&
    !operations.some((op) => op.id === submittedId && op.phase !== "planned");
  const running =
    submitted || batch?.stage === "running" || operations.some((op) => activePhases.has(op.phase));
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- A submission has one bounded acknowledgement deadline, independent of status polls.
  useEffect(() => {
    if (!submitted || !submittedId) return;
    const timer = window.setTimeout(() => {
      setStatusUnknown(true);
    }, 30_000);
    return () => window.clearTimeout(timer);
  }, [submitted, submittedId]);
  const scanState = latestCleanupScan(data?.scan, statusData?.scan);
  const scanning = scanState?.phase === "scanning";
  const finishedKey = operations
    .filter((op) => !activePhases.has(op.phase) && op.phase !== "planned")
    .map((op) => op.id + op.phase)
    .join("|");
  const previousFinished = useRef<string | undefined>(undefined);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Refresh filesystem inventory after a remote operation completes.
  useEffect(() => {
    if (previousFinished.current !== undefined && previousFinished.current !== finishedKey) {
      refresh();
      onOperationFinished();
    }
    previousFinished.current = finishedKey;
  }, [finishedKey, refresh, onOperationFinished, previousFinished]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Poll only while a remote filesystem operation is active.
  useEffect(() => {
    if (!running && !scanning) return;
    let timer: number | undefined;
    const syncVisibility = () => {
      window.clearInterval(timer);
      timer = undefined;
      if (document.visibilityState === "visible") {
        refreshStatus();
        timer = window.setInterval(refreshStatus, 3000);
      }
    };
    syncVisibility();
    document.addEventListener("visibilitychange", syncVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", syncVisibility);
    };
  }, [running, scanning, refreshStatus]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Read completed scan results after status polling observes completion.
  useEffect(() => {
    if (scanState?.phase === "completed") refresh();
  }, [scanState?.phase, refresh]);
  const act = async (input: StorageActionInput) => {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      const result = await run({ environmentId, input });
      if (result._tag === "Success") {
        if (
          input.action === "plan" ||
          input.action === "restore-plan" ||
          input.action === "logs-plan" ||
          input.action === "cleanup-plan"
        )
          setPlan(result.value);
        if (input.action === "execute") {
          setSubmissionBaseline(statusData);
          setStatusUnknown(false);
          setSubmittedId(result.value.id);
          setPlan(result.value);
        }
        if (input.action === "cancel") {
          setPlan(null);
          setSubmittedId(null);
        }
        if (input.action === "cleanup-settings") refresh();
        refreshStatus();
      } else {
        const message = String(squashAtomCommandFailure(result));
        setError(message);
        if (input.action === "execute" && /返回预览|重新预览|重新检查/.test(message)) setPlan(null);
      }
    } catch (cause) {
      setError(String(cause));
    }
    setPending(false);
  };
  const runBatch = async (entries: ReadonlyArray<StorageEntry>) => {
    if (pending) return;
    stopBatch.current = false;
    setPending(true);
    setError("");
    setBatch({ items: entries.map((entry) => ({ entry })), stage: "running" });
    const step = async (input: StorageActionInput) => {
      const result = await run({ environmentId, input });
      return result._tag === "Success"
        ? { id: result.value.id }
        : { error: String(squashAtomCommandFailure(result)) };
    };
    const items = await runCleanupBatch(
      entries,
      {
        plan: (objectId) => step({ action: "cleanup-plan", objectId }),
        execute: (planId) => step({ action: "execute", planId }),
        cancel: (planId) => step({ action: "cancel", planId }),
      },
      () => stopBatch.current,
      (progress) => {
        setBatch({ items: progress, stage: "running" });
        refreshStatus();
      },
    );
    setBatch({ items, stage: "done" });
    setPending(false);
    refreshStatus();
  };
  const batchStatus = (item: CleanupBatchItem) => {
    if (item.error) return serverCopy(item.error);
    const op = item.planId
      ? operations.find((candidate) => candidate.id === item.planId)
      : undefined;
    if (op)
      return [
        uiText(hostCopy(phaseLabel[op.phase] ?? op.phase, windows)),
        op.error && serverCopy(op.error),
      ]
        .filter(Boolean)
        .join(" · ");
    if (item.planId) return uiText("Queued");
    if (batch?.stage === "confirm")
      return item.entry.destination === "trash"
        ? uiText(hostCopy("Move to Trash", windows))
        : uiText("Delete");
    return uiText(batch?.stage === "running" ? "Waiting" : "Cancelled");
  };
  const copyPath = async (path: string) => {
    try {
      await navigator.clipboard.writeText(path);
    } catch {
      setError(uiText("Could not copy the path. Select it in the details instead."));
    }
  };
  if (!data)
    return (
      <div className="space-y-2">
        <p role="status" className="text-sm text-muted-foreground">
          {uiText(
            result._tag === "Failure"
              ? "Storage inspection unavailable. No files were changed."
              : "Inspecting storage…",
          )}
        </p>
        <Button variant="outline" size="sm" onClick={refresh}>
          {uiText("Retry")}
        </Button>
      </div>
    );
  const entries = filterStorageEntries(data.entries, tab, volumePath, filter);
  const estimate = storageReleaseEstimate(
    data.entries.filter((entry) => !volumePath || entry.volumePath === volumePath),
  );
  const selectedVolume = data.volumes.find((volume) => volume.path === volumePath);
  const targets = data.volumes.filter((volume) => volume.internal !== true);
  const busy = pending || running;
  return (
    <section className="flex min-w-0 flex-col gap-4" aria-busy={pending || result.waiting}>
      <CleanupOverview
        data={storagePresentation(
          { ...data, operations, ...(scanState ? { scan: scanState } : {}) },
          theme === "apple" ? diskReport : undefined,
        )}
        previewPlan={plan}
        windows={windows}
        allowed={allowed}
        busy={busy || batch?.stage === "confirm"}
        scanning={result.waiting || scanning}
        volumeId={volumeId}
        onVolumeChange={setVolumeId}
        onScan={() => {
          setMeasureSizes(true);
          setScanRequest(Date.now());
        }}
        onPreview={(entry) =>
          void act(
            entry.destination
              ? { action: "cleanup-plan", objectId: entry.id }
              : { action: "plan", objectId: entry.id, volumeId, mode: "archive-and-release" },
          )
        }
        onPreviewBatch={(entries) =>
          setBatch({ items: entries.map((entry) => ({ entry })), stage: "confirm" })
        }
        onSettings={(input) => void act(input)}
        onLogsPreview={() => void act({ action: "logs-plan" })}
        completed={operations.find(
          (op) => op.id === submittedId && op.phase === "completed" && op.release,
        )}
      />
      {plan?.phase === "planned" ? (
        theme === "apple" ? (
          <UsageDetailsSheet
            open
            onOpenChange={(open) => {
              if (!open && !pending) void act({ action: "cancel", planId: plan.id });
            }}
            title={uiText("Confirm storage plan")}
            description={uiText("Review paths, destinations, and recovery before confirming.")}
          >
            <div
              className="space-y-3 rounded-lg border bg-muted/30 p-4"
              role="region"
              aria-label={uiText("Confirm storage plan")}
            >
              <h4 className="text-sm font-medium">{uiText("Confirm storage plan")}</h4>
              <p className="break-all text-xs">{plan.source ?? plan.destination}</p>
              {plan.cleanupDestination ? (
                <p className="break-all text-xs">
                  {plan.cleanupDestination === "trash"
                    ? uiText(hostCopy("Move to Trash (no immediate space released)", windows))
                    : uiText("Permanently delete rebuildable files")}{" "}
                  · {serverCopy(plan.destination ?? "")}
                </p>
              ) : null}
              {plan.archive ? <p className="break-all text-xs">{plan.archive}</p> : null}
              <p className="text-sm">
                {formatBytes(plan.sourceBytes)} ·{" "}
                {uiText(
                  plan.type === "mole-cleanup"
                    ? uiText("Review destination and recovery before confirming.")
                    : plan.type === "log-cleanup"
                      ? uiText("Verified log archive, then remove only the listed logs.")
                      : plan.type === "restore"
                        ? "Restore to a new directory; never overwrite."
                        : plan.release
                          ? "Release the source only after archive verification."
                          : "Archive a copy; keep the original.",
                )}
              </p>
              {plan.items ? (
                <details className="text-xs">
                  <summary className="cursor-pointer">
                    {uiText("Files in this plan")} · {plan.items.length}
                  </summary>
                  <ul className="mt-2 max-h-48 overflow-auto">
                    {plan.items.map((item) => (
                      <li key={item.path} className="break-all py-1">
                        {item.path} · {formatBytes(item.bytes)}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
              {plan.warnings?.map((warning) => (
                <p key={serverCopy(warning)} className="text-xs text-muted-foreground">
                  {serverCopy(warning)}
                </p>
              ))}
              <div className="flex gap-2">
                <Button
                  size="sm"
                  disabled={!allowed || busy}
                  onClick={() => void act({ action: "execute", planId: plan.id })}
                >
                  {uiText(
                    plan.type === "mole-cleanup"
                      ? uiText("Confirm cleanup")
                      : plan.type === "log-cleanup"
                        ? uiText("Confirm log cleanup")
                        : plan.type === "restore"
                          ? "Confirm restore"
                          : plan.release
                            ? "Confirm archive and release"
                            : "Confirm archive copy",
                  )}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() => void act({ action: "cancel", planId: plan.id })}
                >
                  {uiText("Cancel")}
                </Button>
              </div>
            </div>
          </UsageDetailsSheet>
        ) : (
          <div
            className="space-y-3 rounded-lg border bg-muted/30 p-4"
            role="region"
            aria-label={uiText("Confirm storage plan")}
          >
            <h4 className="text-sm font-medium">{uiText("Confirm storage plan")}</h4>
            <p className="break-all text-xs">{plan.source ?? plan.destination}</p>
            {plan.cleanupDestination ? (
              <p className="break-all text-xs">
                {plan.cleanupDestination === "trash"
                  ? uiText(hostCopy("Move to Trash (no immediate space released)", windows))
                  : uiText("Permanently delete rebuildable files")}{" "}
                · {serverCopy(plan.destination ?? "")}
              </p>
            ) : null}
            {plan.archive ? <p className="break-all text-xs">{plan.archive}</p> : null}
            <p className="text-sm">
              {formatBytes(plan.sourceBytes)} ·{" "}
              {uiText(
                plan.type === "mole-cleanup"
                  ? uiText("Review destination and recovery before confirming.")
                  : plan.type === "log-cleanup"
                    ? uiText("Verified log archive, then remove only the listed logs.")
                    : plan.type === "restore"
                      ? "Restore to a new directory; never overwrite."
                      : plan.release
                        ? "Release the source only after archive verification."
                        : "Archive a copy; keep the original.",
              )}
            </p>
            {plan.items ? (
              <details className="text-xs">
                <summary className="cursor-pointer">
                  {uiText("Files in this plan")} · {plan.items.length}
                </summary>
                <ul className="mt-2 max-h-48 overflow-auto">
                  {plan.items.map((item) => (
                    <li key={item.path} className="break-all py-1">
                      {item.path} · {formatBytes(item.bytes)}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
            {plan.warnings?.map((warning) => (
              <p key={serverCopy(warning)} className="text-xs text-muted-foreground">
                {serverCopy(warning)}
              </p>
            ))}
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={!allowed || busy}
                onClick={() => void act({ action: "execute", planId: plan.id })}
              >
                {uiText(
                  plan.type === "mole-cleanup"
                    ? uiText("Confirm cleanup")
                    : plan.type === "log-cleanup"
                      ? uiText("Confirm log cleanup")
                      : plan.type === "restore"
                        ? "Confirm restore"
                        : plan.release
                          ? "Confirm archive and release"
                          : "Confirm archive copy",
                )}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => void act({ action: "cancel", planId: plan.id })}
              >
                {uiText("Cancel")}
              </Button>
            </div>
          </div>
        )
      ) : null}
      {batch ? (
        <div
          className="space-y-3 rounded-lg border bg-muted/30 p-4"
          role="region"
          aria-label={uiText("Batch cleanup")}
        >
          <h4 className="text-sm font-medium">
            {uiText(
              batch.stage === "confirm"
                ? "Confirm batch cleanup"
                : batch.stage === "running"
                  ? "Cleaning up…"
                  : "Batch cleanup finished",
            )}
          </h4>
          <ul className="max-h-64 divide-y overflow-auto text-xs">
            {batch.items.map((item) => (
              <li key={item.entry.id} className="flex items-center gap-3 py-1.5">
                <span className="min-w-0 flex-1 truncate">{serverCopy(item.entry.name)}</span>
                <span
                  className={
                    item.error ? "min-w-0 text-destructive" : "shrink-0 text-muted-foreground"
                  }
                >
                  {batchStatus(item)}
                </span>
                <span className="shrink-0 tabular-nums">
                  {item.entry.bytes == null
                    ? uiText("Not measured")
                    : formatBytes(item.entry.bytes)}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            {uiText("{count} items", { count: batch.items.length })} ·{" "}
            {formatBytes(
              batch.items.reduce((sum, item) => sum + Math.max(0, item.entry.bytes ?? 0), 0),
            )}
            {" · "}
            {uiText(
              "Each item is checked again for open files and changes right before it runs; anything in use is skipped and kept.",
            )}
          </p>
          <div className="flex gap-2">
            {batch.stage === "confirm" ? (
              <>
                <Button
                  size="sm"
                  disabled={!allowed || busy}
                  onClick={() => void runBatch(batch.items.map((item) => item.entry))}
                >
                  {uiText("Clean up {count} items", { count: batch.items.length })}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setBatch(null)}>
                  {uiText("Cancel")}
                </Button>
              </>
            ) : batch.stage === "running" ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  stopBatch.current = true;
                }}
              >
                {uiText("Stop after current item")}
              </Button>
            ) : (
              <Button size="sm" variant="outline" onClick={() => setBatch(null)}>
                {uiText("Close")}
              </Button>
            )}
          </div>
        </div>
      ) : null}
      <details data-usage-card>
        <summary className="cursor-pointer text-sm text-foreground">
          {uiText("Cleanup history & directory details")}
        </summary>
        <div className="mt-4 flex min-w-0 flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="text-sm">
              <span className="sr-only">{uiText("Storage volume")}</span>
              <select
                aria-label={uiText("Storage volume")}
                value={volumePath}
                onChange={(event) => setVolumePath(event.target.value)}
                className="max-w-full rounded-md border bg-background px-2 py-1.5 text-sm"
              >
                <option value="">{uiText("All inspected volumes")}</option>
                {data.volumes.map((volume) => (
                  <option key={volume.id} value={volume.path}>
                    {volume.internal ? uiText("T3 data volume") : serverCopy(volume.name)}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={result.waiting || busy}
                onClick={() => {
                  if (!measureSizes) setMeasureSizes(true);
                  else refresh();
                }}
              >
                {uiText(measureSizes ? "Refresh sizes" : "Measure sizes")}
              </Button>
              <Link to="/settings/maintenance" className="self-center text-xs underline">
                {uiText("Cleanup rules and run")}
              </Link>
            </div>
          </div>
          {selectedVolume ? (
            <div className="space-y-2">
              <p className="text-sm tabular-nums">
                {uiText("Free space")}: {formatBytes(selectedVolume.freeBytes)}
                {selectedVolume.totalBytes ? ` / ${formatBytes(selectedVolume.totalBytes)}` : ""}
              </p>
              {selectedVolume.totalBytes ? (
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full bg-primary/60"
                    style={{
                      width: `${Math.max(0, Math.min(100, (1 - selectedVolume.freeBytes / selectedVolume.totalBytes) * 100))}%`,
                    }}
                  />
                </div>
              ) : null}
            </div>
          ) : null}
          <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs text-muted-foreground">
            <span>
              {uiText("Reviewed release candidates")}:{" "}
              <strong className="font-medium text-foreground">
                {estimate.count === 0
                  ? uiText("None verified")
                  : `${estimate.incomplete ? "≥ " : ""}${formatBytes(estimate.bytes)} · ${estimate.count}`}
              </strong>
            </span>
            <span>
              {uiText("Checked")}: {new Date(data.checkedAt).toLocaleTimeString()}
            </span>
          </div>
          <Tabs value={tab} onValueChange={(value) => setTab(value as StorageTab)}>
            <TabsList variant="underline" aria-label={uiText("Storage categories")}>
              {tabs.map((item) => (
                <TabsTab key={item.id} value={item.id}>
                  {uiText(item.label)}
                </TabsTab>
              ))}
            </TabsList>
            <TabsPanel value={tab}>
              {tab !== "history" ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <input
                      aria-label={uiText("Filter storage items")}
                      placeholder={uiText("Filter by name or path")}
                      value={filter}
                      onChange={(event) => setFilter(event.target.value)}
                      className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2 text-sm"
                    />
                    {objectId ? (
                      <Button variant="outline" size="sm" onClick={() => setObjectId(undefined)}>
                        {uiText("All directories")}
                      </Button>
                    ) : null}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {uiText(
                      tab === "protected"
                        ? "Chats, attachments, account settings and source files stay protected."
                        : tab === "backups"
                          ? "Age alone never makes a backup safe to remove. Active rollback references stay protected."
                          : "Workspace totals include their build and dependency rows. Sizes are not added together or treated as reclaimable space.",
                    )}
                  </p>
                  <div className="max-h-[32rem] overflow-y-auto">
                    {entries.map((item) => (
                      <div key={item.id} className="border-b py-3 last:border-b-0">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium">
                              {serverCopy(item.name)}
                            </div>
                            <span className="text-xs text-muted-foreground">
                              {uiText(kindLabels[item.kind] ?? "Directory")}
                              {item.modifiedAt
                                ? ` · ${new Date(item.modifiedAt).toLocaleDateString()}`
                                : ""}
                            </span>
                          </div>
                          <span className="shrink-0 text-sm tabular-nums">
                            {item.bytes == null ? uiText("Not measured") : formatBytes(item.bytes)}
                          </span>
                        </div>
                        <details className="mt-2 text-xs">
                          <summary className="cursor-pointer text-muted-foreground">
                            {uiText("Details and actions")}
                          </summary>
                          <p className="my-2 break-all select-text">{item.path}</p>
                          <p className="mb-2 text-muted-foreground">
                            {serverCopy(item.reason ?? "")}
                          </p>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              variant="ghost"
                              size="xs"
                              onClick={() => void copyPath(item.path)}
                            >
                              {uiText("Copy path")}
                            </Button>
                            {item.canExpand !== false && item.canArchive !== false ? (
                              <Button
                                variant="outline"
                                size="xs"
                                onClick={() => {
                                  setObjectId(item.id);
                                  setFilter("");
                                  setTab("candidates");
                                }}
                              >
                                {uiText("Inspect directory")}
                              </Button>
                            ) : null}
                            {item.canArchive !== false && tab !== "protected" ? (
                              <>
                                <Button
                                  variant="outline"
                                  size="xs"
                                  disabled={!allowed || busy || !volumeId}
                                  onClick={() =>
                                    void act({
                                      action: "plan",
                                      objectId: item.id,
                                      volumeId,
                                      mode: "archive-only",
                                    })
                                  }
                                >
                                  {uiText("Preview archive")}
                                </Button>
                                {item.canRelease ? (
                                  <Button
                                    variant="outline"
                                    size="xs"
                                    disabled={!allowed || busy || !volumeId}
                                    onClick={() =>
                                      void act({
                                        action: "plan",
                                        objectId: item.id,
                                        volumeId,
                                        mode: "archive-and-release",
                                      })
                                    }
                                  >
                                    {uiText("Preview archive and release")}
                                  </Button>
                                ) : null}
                              </>
                            ) : null}
                          </div>
                        </details>
                      </div>
                    ))}
                  </div>
                  {entries.length === 0 ? (
                    <p className="py-5 text-center text-sm text-muted-foreground">
                      {uiText("No matching items in this scan.")}
                    </p>
                  ) : null}
                  {data.truncated ? (
                    <p className="text-xs text-muted-foreground">
                      {uiText(
                        "Scan limit reached. Inspect an individual directory for more detail.",
                      )}
                    </p>
                  ) : null}
                </div>
              ) : (
                <div className="space-y-4">
                  <h4 className="text-sm font-medium">{uiText("Restorable archives")}</h4>
                  {data.archives
                    .filter((archive) => !volumePath || archive.path.startsWith(volumePath + "/"))
                    .map((archive) => (
                      <div key={archive.id} className="space-y-2 border-b py-3">
                        <p className="text-sm">
                          {archive.name} · {uiText(archive.online ? "Online" : "Offline")}
                        </p>
                        <p className="break-all text-xs text-muted-foreground">{archive.path}</p>
                        <Button
                          variant="outline"
                          size="xs"
                          disabled={!allowed || busy || !archive.online || !archive.restorable}
                          onClick={() =>
                            void act({
                              action: "restore-plan",
                              objectId: archive.id,
                              ...(volumeId ? { volumeId } : {}),
                            })
                          }
                        >
                          {uiText("Preview restore to new folder")}
                        </Button>
                      </div>
                    ))}
                  {data.archives.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      {uiText("No registered archives yet.")}
                    </p>
                  ) : null}
                  <h4 className="text-sm font-medium">{uiText("Activity")}</h4>
                  {operations.map((op) => (
                    <div key={op.id} className="space-y-2 border-b py-3 text-xs">
                      <p>
                        {uiText(hostCopy(phaseLabel[op.phase] ?? op.phase, windows))} ·{" "}
                        {new Date(op.createdAt).toLocaleString()}
                      </p>
                      <p className="break-all">{op.source ?? op.destination ?? op.archive}</p>
                      {op.held ? <p className="break-all">{op.held}</p> : null}
                      {op.error ? <p role="alert">{serverCopy(op.error)}</p> : null}
                      {op.freeAfter !== undefined && op.freeBefore !== undefined ? (
                        <p>
                          {uiText("Observed free-space change")}:{" "}
                          {op.freeAfter >= op.freeBefore ? "+" : "−"}
                          {formatBytes(Math.abs(op.freeAfter - op.freeBefore))} ·{" "}
                          {uiText("Includes other disk activity")}
                        </p>
                      ) : null}
                      {(op.phase === "locked" || (op.phase === "trashed" && !windows)) &&
                      op.type !== "log-cleanup" ? (
                        <Button
                          size="xs"
                          variant="outline"
                          disabled={!allowed || pending}
                          onClick={() => void act({ action: "reconcile", planId: op.id })}
                        >
                          {uiText("Inspect interrupted operation")}
                        </Button>
                      ) : null}
                      {activePhases.has(op.phase) ? (
                        <Button
                          size="xs"
                          variant="outline"
                          disabled={!allowed || pending}
                          onClick={() => void act({ action: "cancel", planId: op.id })}
                        >
                          {uiText("Stop after current step")}
                        </Button>
                      ) : null}
                    </div>
                  ))}
                  {operations.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      {uiText("No storage operations yet.")}
                    </p>
                  ) : null}
                </div>
              )}
            </TabsPanel>
          </Tabs>
          {!selectedVolume || selectedVolume.internal === true ? (
            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="outline"
                size="sm"
                disabled={!allowed || busy}
                onClick={() => {
                  setMeasureSizes(true);
                  setScanRequest(Date.now());
                }}
              >
                {uiText("Scan cleanup candidates")}
              </Button>
              <span className="text-xs text-muted-foreground">
                {uiText("Review each destination before confirming.")}
              </span>
            </div>
          ) : null}
          {data.entries.some((entry) => entry.canArchive) || data.archives.length ? (
            <label className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {uiText("Archive / restore destination")}
              <select
                value={volumeId}
                onChange={(event) => setVolumeId(event.target.value)}
                className="max-w-full rounded-md border bg-background px-2 py-1.5 text-foreground"
              >
                <option value="">{uiText("Choose an external APFS / HFS+ volume")}</option>
                {targets.map((volume) => (
                  <option key={volume.id} value={volume.id}>
                    {serverCopy(volume.name)} · {formatBytes(volume.freeBytes)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {!allowed ? (
            <p className="text-xs text-muted-foreground">
              {uiText("This connection has view-only storage access.")}
            </p>
          ) : null}
        </div>
      </details>
      {running ? (
        <p role="status" className="text-xs">
          {uiText("Storage operation in progress. See Archives and activity.")}
        </p>
      ) : null}
      {unknownSubmission ? (
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            refreshStatus();
            refresh();
          }}
        >
          {uiText("Status unknown · Refresh")}
        </Button>
      ) : null}
      {error ? (
        <p role="alert" className="break-all text-sm text-destructive">
          {serverCopy(error)}
        </p>
      ) : null}
    </section>
  );
}
