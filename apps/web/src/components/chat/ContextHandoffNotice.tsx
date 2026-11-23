import { useUiText } from "../../i18n/useUiText";
import { ContextTokenDetails } from "./ContextTokenDetails";
import type { ThreadStructure } from "@t3tools/client-runtime/state/shell";
import { latestContextUsage } from "./contextUsage";
import type { EnvironmentId } from "@t3tools/contracts";
import { CommandId, MessageId, ThreadId } from "@t3tools/contracts";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Button } from "../ui/button";
import { Meter, MeterIndicator, MeterTrack } from "../ui/meter";
import { Popover, PopoverTrigger, PopoverPopup, PopoverTitle } from "../ui/popover";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { CircleAlertIcon } from "lucide-react";
import "./composerV9.css";
import { useProjectFileQuery } from "../files/projectFilesQueryState";
import { useThreadHandoffSummary, useThreadShell } from "../../state/entities";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { newMessageId, newThreadId } from "../../lib/utils";
import { useComposerDraftStore } from "../../composerDraftStore";
import {
  buildHandoffInstruction,
  contextRatio,
  continuationParameters,
  expectedHandoffPath,
  hasHandoffBudgetFailure,
  longConversationLevel,
  parseHandoffPath,
} from "./contextHandoff";

interface HandoffState {
  requestMessageId?: string;
  /** Exact file the instruction asked for; checked even when the reply line is malformed. */
  expectedPath?: string;
  nextThreadId?: string;
  /** Set only after the new thread received its first message, so a failed start can retry. */
  startedNextThreadId?: string;
  /** A persisted draft is ready, without starting a provider turn. */
  preparedNextThreadId?: string;
  /** Freeze the explicit scope across retries and reloads of one receiving thread. */
  continueInstructions?: string;
}
function readState(key: string): HandoffState {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? "{}");
    if (typeof value !== "object" || value === null) return {};
    const state = value as HandoffState;
    return {
      ...(typeof state.requestMessageId === "string"
        ? { requestMessageId: state.requestMessageId }
        : {}),
      ...(typeof state.expectedPath === "string" ? { expectedPath: state.expectedPath } : {}),
      ...(typeof state.nextThreadId === "string" ? { nextThreadId: state.nextThreadId } : {}),
      ...(typeof state.startedNextThreadId === "string"
        ? { startedNextThreadId: state.startedNextThreadId }
        : {}),
      ...(typeof state.preparedNextThreadId === "string"
        ? { preparedNextThreadId: state.preparedNextThreadId }
        : {}),
      ...(typeof state.continueInstructions === "string"
        ? { continueInstructions: state.continueInstructions }
        : {}),
    };
  } catch {
    return {};
  }
}

/** Keyed by environment/thread in ChatView so in-flight state cannot leak across navigation. */
export function ContextHandoffNotice({
  environmentId,
  thread,
  projection,
  cwd,
  enabled,
  disabled,
  onCompact,
  compactDisabled = false,
  disconnected = false,
}: {
  environmentId: EnvironmentId;
  thread: EnvironmentThreadShell;
  projection: ThreadStructure;
  cwd: string;
  enabled: boolean;
  disabled: boolean;
  onCompact?: (() => void) | undefined;
  compactDisabled?: boolean;
  /** Per-turn throughput now lives in the session statistics under the composer. */
  showThroughput?: boolean;
  disconnected?: boolean;
}) {
  const uiText = useUiText();
  const key = `t3-context-handoff:${environmentId}:${thread.id}`;
  const [state, setState] = useState(() => readState(key));
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(`${key}:dismissed`) === "true";
    } catch {
      return false;
    }
  });
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [continueInstructions, setContinueInstructions] = useState(
    state.continueInstructions ?? "",
  );
  const navigate = useNavigate();
  const { pendingSubtasks, nextThreadId } = useThreadHandoffSummary(
    scopeThreadRef(environmentId, thread.id),
  );
  const [pendingNavigationId, setPendingNavigationId] = useState<ThreadId | null>(null);
  const pendingNavigationShell = useThreadShell(
    pendingNavigationId === null ? null : scopeThreadRef(environmentId, pendingNavigationId),
  );
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Navigate only after the live shell arrives, since a command receipt can precede it.
  useEffect(() => {
    if (pendingNavigationId === null || pendingNavigationShell === null) return;
    void navigate({
      to: "/$environmentId/$threadId",
      params: { environmentId, threadId: pendingNavigationId },
    });
  }, [environmentId, navigate, pendingNavigationId, pendingNavigationShell]);
  const create = useAtomCommand(threadEnvironment.create, { reportFailure: false });
  const start = useAtomCommand(threadEnvironment.startTurn, { reportFailure: false });
  const settle = useAtomCommand(threadEnvironment.settle, { reportFailure: false });
  const save = (next: HandoffState) => {
    setState(next);
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      /* In-memory flow still works when storage is unavailable. */
    }
  };
  const nextThread = nextThreadId === null ? null : { id: nextThreadId };
  // Promote-to-steer cancels the queued run and injects the message into the active one,
  // so the message's own runId is authoritative when present.
  const requestRunId =
    state.requestMessageId === undefined
      ? null
      : (projection.messages.find((message) => message.id === state.requestMessageId)?.runId ??
        null);
  const pendingRun =
    state.requestMessageId === undefined
      ? null
      : (projection.runs.find((run) => requestRunId !== null && run.id === requestRunId) ??
        projection.runs.find((run) => run.userMessageId === state.requestMessageId));
  const active = projection.runs.some((run) =>
    ["preparing", "starting", "running", "waiting", "queued"].includes(run.status),
  );
  const budgetBlocked = !active && hasHandoffBudgetFailure(projection);
  const pending =
    !budgetBlocked &&
    state.requestMessageId !== undefined &&
    (!pendingRun ||
      !["completed", "interrupted", "failed", "cancelled", "rolled_back"].includes(
        pendingRun.status,
      ));
  const lastAssistant = projection.messages
    .toReversed()
    .find(
      (message) =>
        message.role === "assistant" &&
        (state.requestMessageId === undefined || message.runId === pendingRun?.id),
    );
  const settledReply =
    thread.lineage.relationshipToParent !== "subagent" &&
    ((enabled && !dismissed) || state.requestMessageId !== undefined) &&
    !active &&
    !pending;
  const requested = state.requestMessageId !== undefined;
  const replyPath =
    settledReply && lastAssistant && !lastAssistant.streaming
      ? parseHandoffPath(lastAssistant.text, { strict: !requested })
      : null;
  // After a request the client-chosen file is authoritative; the reply line is only a
  // fallback for an agent that wrote somewhere else.
  const expectedPath = settledReply && requested ? (state.expectedPath ?? null) : null;
  const expectedFile = useProjectFileQuery(environmentId, cwd, expectedPath, expectedPath !== null);
  const expectedFound =
    expectedPath !== null &&
    expectedFile.data !== null &&
    expectedFile.error === null &&
    !expectedFile.isPending;
  const fallbackPath =
    replyPath !== null && replyPath !== expectedPath && !expectedFound ? replyPath : null;
  const replyFile = useProjectFileQuery(environmentId, cwd, fallbackPath, fallbackPath !== null);
  const replyFound =
    fallbackPath !== null &&
    replyFile.data !== null &&
    replyFile.error === null &&
    !replyFile.isPending;
  const handoffPath = expectedFound
    ? expectedPath
    : replyFound
      ? fallbackPath
      : (expectedPath ?? replyPath);
  const file = {
    isPending:
      (expectedPath !== null && expectedFile.isPending) ||
      (fallbackPath !== null && replyFile.isPending),
    refresh: () => {
      expectedFile.refresh();
      replyFile.refresh();
    },
  };
  const ready = expectedFound || replyFound;
  const usage = latestContextUsage({ ...projection, thread });
  const ratio = contextRatio(usage);
  const turns = projection.runs.reduce((max, run) => Math.max(max, run.ordinal), 0);
  const level = longConversationLevel({
    enabled,
    dismissed,
    relationshipToParent: thread.lineage.relationshipToParent,
    items: thread.itemCount,
    turns,
    ratio,
    usedTokens: usage?.usedTokens ?? null,
  });
  const missing =
    !pending &&
    !active &&
    (state.requestMessageId !== undefined || handoffPath !== null) &&
    !ready &&
    !file.isPending;
  const openThread = (id: ThreadId) =>
    navigate({ to: "/$environmentId/$threadId", params: { environmentId, threadId: id } });
  const runAction = async (action: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : uiText("Could not prepare the handoff. Try again."),
      );
    }
    busyRef.current = false;
    setBusy(false);
  };
  const requireSuccess = (result: Awaited<ReturnType<typeof start>>) => {
    if (result._tag === "Failure") throw squashAtomCommandFailure(result);
  };
  const requestHandoff = () =>
    runAction(async () => {
      const messageId = newMessageId();
      const expectedPath = expectedHandoffPath(cwd, thread.id);
      requireSuccess(
        await start({
          environmentId,
          input: {
            threadId: thread.id,
            message: {
              messageId,
              role: "user",
              text: buildHandoffInstruction(expectedPath, pendingSubtasks),
              attachments: [],
            },
            modelSelection: thread.modelSelection,
            runtimeMode: thread.runtimeMode,
            interactionMode: thread.interactionMode,
            dispatchMode: "queue",
            createdAt: new Date().toISOString(),
          },
        }),
      );
      save({ requestMessageId: messageId, expectedPath });
    });
  const continueThread = (path: string | null) =>
    runAction(async () => {
      const id = state.nextThreadId ? ThreadId.make(state.nextThreadId) : newThreadId();
      const instructions = state.nextThreadId
        ? (state.continueInstructions ?? "")
        : continueInstructions.trim();
      const nextState = { ...state, nextThreadId: id, continueInstructions: instructions };
      save(nextState);
      const parameters = continuationParameters(thread, id, path, instructions);
      // Stable receipt IDs make retries after a lost response reuse the accepted operations.
      requireSuccess(
        await create({
          environmentId,
          input: {
            ...parameters.create,
            commandId: CommandId.make(`context-handoff:create:${id}`),
            createdAt: new Date().toISOString(),
          },
        }),
      );
      if (!parameters.shouldStart) {
        // Preparing context is not execution authorization. Only a later user send
        // may start the receiving agent. Never overwrite an edited receiving draft.
        const target = scopeThreadRef(environmentId, id);
        const drafts = useComposerDraftStore.getState();
        if (!drafts.getComposerDraft(target)?.prompt) drafts.setPrompt(target, parameters.prompt);
        save({ ...nextState, preparedNextThreadId: id });
        setPendingNavigationId(id);
        return;
      }
      requireSuccess(
        await start({
          environmentId,
          input: {
            threadId: id,
            commandId: CommandId.make(`context-handoff:start:${id}`),
            message: {
              messageId: MessageId.make(`context-handoff:message:${id}`),
              role: "user",
              text: parameters.prompt,
              attachments: [],
            },
            modelSelection: thread.modelSelection,
            runtimeMode: thread.runtimeMode,
            interactionMode: thread.interactionMode,
            createdAt: new Date().toISOString(),
          },
        }),
      );
      // The new thread already exists and has its first message; a rejected settle (for
      // example a delegated result woke the old thread) must not strand the user here.
      save({ ...nextState, startedNextThreadId: id });
      setPendingNavigationId(id);
      const settled = await settle({
        environmentId,
        input: { threadId: thread.id, commandId: CommandId.make(`context-handoff:settle:${id}`) },
      });
      if (settled._tag === "Failure")
        setError(
          uiText("Could not archive the old conversation. You can archive it from the sidebar."),
        );
    });
  if (thread.lineage.relationshipToParent === "subagent") return null;
  const continued =
    nextThread &&
    (state.startedNextThreadId === nextThread.id ||
      state.preparedNextThreadId === nextThread.id ||
      thread.settledOverride === "settled" ||
      state.nextThreadId === undefined);
  const compacting = projection.turnItems.some(
    (item) =>
      item.type === "compaction" &&
      ["pending", "running", "waiting"].includes(item.status) &&
      projection.runs.some(
        (run) =>
          run.id === item.runId &&
          ["preparing", "starting", "running", "waiting"].includes(run.status),
      ),
  );
  if (
    level === null &&
    !state.requestMessageId &&
    !handoffPath &&
    !budgetBlocked &&
    !continued &&
    !(enabled && usage !== null)
  )
    return null;
  const clampedRatio = ratio === null ? null : Math.max(0, Math.min(1, ratio));
  const percent = clampedRatio === null ? null : Math.round(clampedRatio * 100);
  const isStatusAlert = budgetBlocked || Boolean(error);
  const isSpecialStatus = isStatusAlert || continued || pending || ready || compacting;
  const accessibleLabel = budgetBlocked
    ? uiText("Recover from a full context window")
    : error
      ? uiText("Handoff failed · Retry")
      : continued
        ? uiText("Handoff complete")
        : pending
          ? uiText("Preparing handoff")
          : ready
            ? uiText("Handoff ready")
            : compacting
              ? uiText("Compacting")
              : percent !== null
                ? uiText("Context usage {percent}%", { percent })
                : uiText("Conversation details");
  const compactLabel = isSpecialStatus
    ? accessibleLabel
    : percent !== null
      ? `${percent}%`
      : accessibleLabel;
  const ctxTone = isStatusAlert
    ? "bad"
    : level === "strong" || (clampedRatio !== null && clampedRatio >= 0.8)
      ? "warn"
      : "normal";
  const description = budgetBlocked
    ? uiText(
        "Compact the context or move to a new conversation. The original history stays available.",
      )
    : compacting
      ? uiText("Compacting context. Your draft and history stay available.")
      : pending
        ? pendingRun?.status === "queued"
          ? uiText("Handoff queued until the current turn finishes.")
          : uiText("Preparing the handoff. You can open a new conversation when it is ready.")
        : ready
          ? uiText(
              "Handoff ready. A new draft is prepared by default. Enter instructions to continue work.",
            )
          : missing
            ? uiText(
                "Handoff file unavailable. Try again or open a draft with a link to the original conversation.",
              )
            : continued
              ? state.preparedNextThreadId === nextThread?.id
                ? uiText("Handoff draft ready. Send instructions when you are ready to start.")
                : uiText("Handoff complete. The original conversation is still here.")
              : level !== null
                ? ratio !== null && ratio >= 0.6
                  ? uiText("Context usage is high. You can still continue.")
                  : uiText(
                      "You can prepare a handoff to continue this long conversation in a new thread.",
                    )
                : "";
  return (
    <Popover
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
      }}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={<button type="button" />}
              aria-label={accessibleLabel}
              style={
                {
                  "--apple-context-progress": `${(clampedRatio ?? 0) * 100}%`,
                } as CSSProperties
              }
              data-v9-ctx-pill={isSpecialStatus ? "status" : "compact"}
              data-v9-ctx-tone={ctxTone}
              data-context-handoff={
                budgetBlocked
                  ? "blocked"
                  : compacting
                    ? "compacting"
                    : continued
                      ? "continued"
                      : ready
                        ? "ready"
                        : pending
                          ? "pending"
                          : (level ?? "normal")
              }
            />
          }
        >
          {isStatusAlert ? (
            <CircleAlertIcon aria-hidden="true" data-v9-ctx-alert-icon="" />
          ) : (
            <span data-v9-ctx-ring="" aria-hidden="true" />
          )}
          <span data-v9-ctx-pct="">{compactLabel}</span>
        </TooltipTrigger>
        <TooltipPopup side="top">{accessibleLabel}</TooltipPopup>
      </Tooltip>
      <PopoverPopup side="top" align="start" width="md">
        <div className="space-y-3 text-xs leading-relaxed" data-context-details>
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <PopoverTitle>{uiText("Context window")}</PopoverTitle>
              <span className="text-sm font-medium tabular-nums">
                {ratio === null ? uiText("Not reported") : `${Math.round(ratio * 100)}%`}
              </span>
            </div>
            {ratio !== null ? (
              <Meter
                aria-label={uiText("Context usage")}
                value={Math.round(Math.min(1, Math.max(0, ratio)) * 100)}
              >
                <MeterTrack>
                  <MeterIndicator
                    tone={budgetBlocked ? "destructive" : ratio >= 0.8 ? "warning" : "default"}
                  />
                </MeterTrack>
              </Meter>
            ) : null}
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-muted-foreground">
              {description ? <p>{description}</p> : null}
              {usage?.usedTokens != null ? (
                <span className="tabular-nums whitespace-nowrap">
                  {uiText("About {count} tokens", {
                    count: [
                      `${Math.round(usage.usedTokens / 1000)}k`,
                      usage.maxTokens ? `${Math.round(usage.maxTokens / 1000)}k` : null,
                    ]
                      .filter(Boolean)
                      .join(" / "),
                  })}
                </span>
              ) : null}
            </div>
            {usage ? <ContextTokenDetails usage={usage} /> : null}
            {disconnected ? (
              <p className="text-warning">{uiText("Disconnected. Context data may be stale.")}</p>
            ) : null}
          </div>
          {pendingSubtasks > 0 ? (
            <p className="text-muted-foreground">
              {uiText(
                pendingSubtasks === 1
                  ? "{count} subtask is running. Its result will appear here."
                  : "{count} subtasks are running. Their results will appear here.",
                { count: pendingSubtasks },
              )}
            </p>
          ) : null}
          {continued ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                void openThread(nextThread.id);
              }}
            >
              {uiText("Open the continuation")}
            </Button>
          ) : (
            <div className="flex flex-wrap gap-2">
              {!pending ? (
                <label className="w-full space-y-1">
                  <span>{uiText("Instructions after handoff (optional)")}</span>
                  <textarea
                    rows={2}
                    className="w-full rounded-md border bg-background p-2 text-foreground"
                    value={continueInstructions}
                    disabled={busy || disabled || active || state.nextThreadId !== undefined}
                    placeholder={uiText(
                      "Leave blank to prepare a draft. To start work, enter the tasks to continue.",
                    )}
                    onChange={(event) => setContinueInstructions(event.currentTarget.value)}
                  />
                </label>
              ) : null}
              {!pending &&
                (ready ? (
                  <Button
                    variant="ghost"
                    size="xs"
                    disabled={busy || disabled || active}
                    onClick={() => {
                      void continueThread(handoffPath);
                    }}
                  >
                    {continueInstructions.trim()
                      ? uiText("Hand off and continue with instructions")
                      : uiText("Prepare a handoff draft")}
                  </Button>
                ) : budgetBlocked ? (
                  <>
                    {onCompact ? (
                      <Button
                        variant="ghost"
                        size="xs"
                        disabled={busy || disabled || compactDisabled}
                        onClick={onCompact}
                      >
                        {uiText("Compact this conversation")}
                      </Button>
                    ) : null}
                    <Button
                      variant="ghost"
                      size="xs"
                      disabled={busy || disabled || active}
                      onClick={() => {
                        void continueThread(null);
                      }}
                    >
                      {continueInstructions.trim()
                        ? uiText("Hand off and continue with instructions")
                        : uiText("Prepare a draft with conversation history")}
                    </Button>
                  </>
                ) : missing ? (
                  <>
                    <Button
                      variant="ghost"
                      size="xs"
                      disabled={busy || disabled}
                      onClick={() => {
                        file.refresh();
                        void requestHandoff();
                      }}
                    >
                      {uiText("Retry handoff")}
                    </Button>
                    <Button
                      variant="ghost"
                      size="xs"
                      disabled={busy || disabled || active}
                      onClick={() => {
                        void continueThread(null);
                      }}
                    >
                      {continueInstructions.trim()
                        ? uiText("Hand off and continue with instructions")
                        : uiText("Prepare a draft with conversation history")}
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="ghost"
                    size="xs"
                    disabled={busy || disabled}
                    onClick={() => {
                      void requestHandoff();
                    }}
                  >
                    {uiText("Hand off to a new conversation")}
                  </Button>
                ))}

              {!budgetBlocked && !pending && !ready && !missing && onCompact ? (
                <Button
                  size="xs"
                  variant="outline"
                  disabled={busy || disabled || compactDisabled || compacting}
                  onClick={onCompact}
                >
                  {uiText("Compact this conversation")}
                </Button>
              ) : null}
            </div>
          )}
          {error ? (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          ) : null}
          <div className="border-t border-border pt-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">
                {uiText("See session statistics below the composer for rounds, times, and tokens.")}
              </span>
              {!state.requestMessageId && !handoffPath && enabled ? (
                <Button
                  size="xs"
                  variant="ghost-muted"
                  onClick={() => {
                    setDismissed(!dismissed);
                    try {
                      localStorage.setItem(`${key}:dismissed`, String(!dismissed));
                    } catch {
                      /* In-memory preference remains available. */
                    }
                  }}
                >
                  {dismissed
                    ? uiText("Restore context reminders")
                    : uiText("Mute context reminders")}
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      </PopoverPopup>
    </Popover>
  );
}
