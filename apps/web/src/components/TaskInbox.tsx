import { inboxLabel } from "~/i18n/inboxLabel";
import { uiText } from "../i18n";
import { useState } from "react";
import { useNowMinute } from "../hooks/useNowMinute";
import { useNavigate } from "@tanstack/react-router";
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { Check, ChevronLeft, ChevronRight, ExternalLink, FileText, Maximize2 } from "lucide-react";
import { focusTaskBoardItem, mutateTaskBoard, useTaskBoard } from "../taskBoard";
import {
  boardCurrentStep,
  boardEvidenceTarget,
  boardTaskKind,
  boardWaitDays,
  matchBoardTask,
  sortBoardTasks,
  type BoardTask,
} from "../taskBoard.logic";
import { useRightPanelStore } from "../rightPanelStore";
import { useProjects, useThreadShells } from "../state/entities";
import { shellEnvironment } from "../state/shell";
import { threadEnvironment } from "../state/threads";
import { useAtomCommand } from "../state/use-atom-command";
import { useAssetUrlState } from "../assets/assetUrls";
import { newMessageId } from "~/lib/utils";
import { openExpandedImagePreview } from "./chat/ExpandedImageDialog";
import { TaskBoardSnooze } from "./TaskBoardPanel";
import { Button } from "./ui/button";
import { toastManager } from "./ui/toast";

type Shell = ReturnType<typeof useThreadShells>[number];
// Read the clock only from event handlers.
const nowIso = () => new Date().toISOString();
const IMAGE = /\.(png|jpe?g|webp|gif|avif)$/i;
const VIDEO = /\.(mp4|mov|webm|m4v)$/i;

/** One plain sentence: what is being asked of the user, never the project's internal state. */
function inboxRequestText(task: BoardTask): string {
  const step = boardCurrentStep(task);
  const ask = task.judge?.trim();
  if (ask) return ask;
  const kind = boardTaskKind(task);
  if (kind === "unlock" || kind === "blocked")
    return task.blocked?.trim()
      ? uiText("Needs your attention: {count}", { count: task.blocked.trim() })
      : uiText("A blocked task needs your attention");
  if (!step) return uiText("Review this project");
  if (kind === "review") return uiText("Review “{name}”", { name: step.name });
  if (kind === "decide") return uiText("Decide on “{name}”", { name: step.name });
  return uiText("Take action on “{name}”", { name: step.name });
}
function inboxNeedsUser(task: BoardTask) {
  return task.state === "user" || task.state === "blocked";
}

function EvidencePreview({
  environmentId,
  threadId,
  path,
  name,
  routeThreadKey,
}: {
  environmentId: EnvironmentId;
  threadId: ScopedThreadRef["threadId"];
  path: string;
  name: string;
  routeThreadKey: string;
}) {
  const video = VIDEO.test(path);
  const resource = { _tag: "media-file" as const, threadId, path };
  const asset = useAssetUrlState(environmentId, resource);
  const src = asset._tag === "Success" ? asset.url : null;
  const expand = () => {
    if (!src) return;
    openExpandedImagePreview(routeThreadKey, {
      index: 0,
      images: [
        {
          src,
          name,
          ...(video ? { type: "video" as const, autoPlay: true } : {}),
          actionsSource: {
            kind: video ? "video" : "image",
            name,
            src,
            asset: { environmentId, resource },
          },
        },
      ],
    });
  };
  return (
    <div className="mt-3">
      <button
        type="button"
        aria-label={uiText("View {name} full screen", { name })}
        onClick={expand}
        disabled={!src}
        className="relative block aspect-video w-full overflow-hidden rounded-lg border bg-muted outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-wait"
      >
        {src ? (
          video ? (
            <video src={src} muted preload="metadata" className="size-full object-contain" />
          ) : (
            <img src={src} alt={name} className="size-full object-contain" />
          )
        ) : (
          <span className="grid size-full place-items-center text-xs text-muted-foreground">
            {asset._tag === "Failure"
              ? uiText("Preview unavailable. Open the file in the project folder.")
              : uiText("Loading preview…")}
          </span>
        )}
      </button>
      <Button
        size="sm"
        variant="outline"
        className="mt-1.5 w-full"
        disabled={!src}
        onClick={expand}
      >
        <Maximize2 />
        {video ? uiText("View video full screen") : uiText("View image full screen")}
      </Button>
      <p className="mt-1 truncate text-3xs text-muted-foreground">{name}</p>
    </div>
  );
}

export function TaskInbox({ threadRef }: { threadRef: ScopedThreadRef }) {
  const { data, focus, threadRequests } = useTaskBoard();
  const [tab, setTab] = useState<"reply" | "later">("reply");
  const [writing, setWriting] = useState(false);
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const threads = useThreadShells();
  const projects = useProjects();
  const openInEditor = useAtomCommand(shellEnvironment.openInEditor, { reportFailure: false });
  const startTurn = useAtomCommand(threadEnvironment.startTurn, { reportFailure: false });
  const nowMinute = useNowMinute();
  const now = Date.parse(`${nowMinute}Z`);
  const tasks = sortBoardTasks(data?.tasks ?? []).filter(inboxNeedsUser);
  const replyTasks = tasks.filter((task) => !task.snoozed);
  const laterTasks = tasks.filter((task) => task.snoozed);
  const selected = focus ? (tasks.find((task) => task.folder === focus.folder) ?? null) : null;
  const routeThreadKey = scopedThreadKey(threadRef);

  const projectsByKey = new Map(projects.map((p) => [`${p.environmentId}:${p.id}`, p] as const));
  const linkedThreadsByFolder = new Map<string, Shell[]>();
  for (const task of tasks) {
    const matched = threads
      .filter(
        (thread) =>
          task.sessions.includes(thread.id) ||
          matchBoardTask(
            [task],
            thread.worktreePath ??
              projectsByKey.get(`${thread.environmentId}:${thread.projectId}`)?.workspaceRoot,
          ) !== null,
      )
      .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    linkedThreadsByFolder.set(task.folder, matched);
  }
  const linkedThreads = (task: BoardTask): Shell[] => linkedThreadsByFolder.get(task.folder) ?? [];
  const goTo = (ref: ScopedThreadRef) => {
    useRightPanelStore.getState().open(ref, "tasks");
    void navigate({ to: "/$environmentId/$threadId", params: ref });
  };
  const select = (task: BoardTask) => {
    setWriting(false);
    setText("");
    setError(null);
    const source = linkedThreads(task)[0];
    const elsewhere = source && source.id !== threadRef.threadId;
    focusTaskBoardItem(task.folder, elsewhere ? threadRef : (focus?.returnTo ?? null));
    // Answering happens beside the conversation that asked, so the chat follows the item.
    if (elsewhere) goTo(scopeThreadRef(source.environmentId, source.id));
  };
  const back = () => {
    setWriting(false);
    setText("");
    setError(null);
    focusTaskBoardItem(null);
  };
  const openProjectFolder = async (task: BoardTask) => {
    const result = await openInEditor({
      environmentId: threadRef.environmentId,
      input: { cwd: task.folder, editor: "file-manager" },
    });
    if (result._tag === "Failure")
      setError(uiText("Couldn’t open project folder: {folder}", { folder: task.folder }));
  };
  const send = async (thread: Shell, message: string) => {
    const result = await startTurn({
      environmentId: thread.environmentId,
      input: {
        threadId: thread.id,
        message: { messageId: newMessageId(), role: "user", text: message, attachments: [] },
        modelSelection: thread.modelSelection,
        runtimeMode: thread.runtimeMode,
        interactionMode: thread.interactionMode,
        // A busy conversation gets the reply after its current run instead of an interruption.
        dispatchMode: "queue",
        createdAt: nowIso(),
      },
    });
    return result._tag === "Success";
  };
  const answer = async (
    task: BoardTask,
    action: "approve" | "reject" | "toggle" | "note",
    reply: string,
  ) => {
    const step = boardCurrentStep(task);
    const thread = linkedThreads(task)[0] ?? null;
    if (pending) return;
    if (action === "reject" && !reply.trim()) {
      setError(uiText("Describe what you want the agent to change."));
      return;
    }
    if (action !== "note" && !step) {
      setError(uiText("There’s no pending step. Refresh and try again."));
      return;
    }
    setPending(true);
    setError(null);
    try {
      if ((action === "approve" || action === "reject") && step) {
        await mutateTaskBoard("review", {
          folder: task.folder,
          step: step.id,
          decision: action,
          ...(action === "reject" ? { reason: reply.trim() } : {}),
        });
      } else if (action === "toggle" && step) {
        await mutateTaskBoard("toggle", { folder: task.folder, step: step.id });
      }
      const label = uiText("[{title}{step}]", {
        title: task.title,
        step: step ? ` · ${step.name}` : "",
      });
      const message =
        action === "approve"
          ? uiText("{label}This version works. Please continue.{note}", {
              label,
              note: reply.trim()
                ? uiText("\nAdditional notes: {count}", { count: reply.trim() })
                : "",
            })
          : action === "reject"
            ? uiText("{label}Please make these changes:\n{total}", { label, total: reply.trim() })
            : action === "toggle"
              ? uiText("{label}I’m done on my end.{note}", {
                  label,
                  note: reply.trim()
                    ? uiText("\nAdditional notes: {count}", { count: reply.trim() })
                    : "",
                })
              : `${label}${reply.trim() || uiText("I’ve taken care of it. Please continue.")}`;
      if (thread) {
        const delivered = await send(thread, message);
        toastManager.add(
          delivered
            ? {
                type: "success",
                title: uiText("Sent to “{title}”", { title: thread.title }),
                description: uiText("The agent will continue."),
              }
            : {
                type: "warning",
                title:
                  action === "note"
                    ? uiText("Message wasn’t sent")
                    : uiText("Saved to the task. The message wasn’t sent."),
                description: uiText("Open the conversation to tell the agent directly."),
              },
        );
        if (!delivered && action === "note") {
          setPending(false);
          return;
        }
      } else {
        toastManager.add({
          type: action === "note" ? "warning" : "success",
          title:
            action === "note"
              ? uiText("This project has no linked conversation.")
              : uiText("Saved to the task"),
          description:
            action === "note"
              ? uiText("Open the project folder first, then mark the task complete.")
              : uiText("This project has no linked conversation"),
        });
        if (action === "note") {
          void openProjectFolder(task);
          setPending(false);
          return;
        }
      }
      back();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
    setPending(false);
  };

  if (selected) {
    const step = boardCurrentStep(selected);
    const kind = boardTaskKind(selected);
    const linked = linkedThreads(selected);
    const source = linked[0] ?? null;
    const returnThread = focus?.returnTo
      ? threads.find(
          (thread) =>
            thread.id === focus.returnTo!.threadId &&
            thread.environmentId === focus.returnTo!.environmentId,
        )
      : undefined;
    const evidence = (step?.evidence ?? []).map((item) => ({
      item,
      target: boardEvidenceTarget(selected.folder, item),
    }));
    const days = boardWaitDays(selected, now);
    const unlock = kind === "unlock" || kind === "blocked";
    return (
      <div className="px-3.5 pb-4">
        <div className="flex items-center justify-between gap-2 pt-2">
          <button
            type="button"
            onClick={back}
            className="inline-flex items-center gap-0.5 rounded-md py-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="size-3.5" />
            {uiText("Back to to-do list")}
          </button>
          {returnThread && returnThread.id !== threadRef.threadId ? (
            <button
              type="button"
              onClick={() => {
                back();
                goTo(scopeThreadRef(returnThread.environmentId, returnThread.id));
              }}
              className="min-w-0 truncate rounded-md py-1 text-xs text-primary hover:underline"
            >
              {uiText("Back to “")}
              {returnThread.title}」
            </button>
          ) : null}
        </div>
        <h2 className="mt-2 break-words text-base leading-snug font-semibold">
          {inboxRequestText(selected)}
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {selected.title}
          {days
            ? days === 1
              ? uiText(" · Waiting {days} day", { days })
              : uiText(" · Waiting {days} days", { days })
            : ""}
        </p>
        {evidence.map(({ item, target }) =>
          target?.kind === "file" && (IMAGE.test(item) || VIDEO.test(item)) ? (
            <EvidencePreview
              key={item}
              environmentId={(source ?? threadRef).environmentId}
              threadId={source?.id ?? threadRef.threadId}
              path={target.value}
              name={item.split("/").at(-1) || item}
              routeThreadKey={routeThreadKey}
            />
          ) : target ? (
            <Button
              key={item}
              size="sm"
              variant="outline"
              className="mt-2 w-full justify-start"
              onClick={() =>
                target.kind === "url"
                  ? window.open(target.value, "_blank", "noopener")
                  : useRightPanelStore.getState().openFile(threadRef, target.value)
              }
            >
              <FileText />
              <span className="truncate">{item.split("/").at(-1) || item}</span>
            </Button>
          ) : null,
        )}
        {selected.next ? (
          <p className="mt-3 rounded-md bg-muted px-2.5 py-2 text-xs leading-relaxed text-muted-foreground">
            {uiText("Current situation:")}
            {selected.next}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="mt-2 text-xs text-destructive">
            {error}
          </p>
        ) : null}
        <div className="mt-3 space-y-2">
          {writing || kind === "decide" ? (
            <textarea
              aria-label={kind === "review" ? uiText("Feedback") : uiText("Message to the agent")}
              placeholder={
                kind === "review"
                  ? uiText("Example: The opening is slow. Shorten the first 10 seconds.")
                  : kind === "decide"
                    ? uiText("Add your decision for the agent (optional)")
                    : uiText("Add a note for the agent (optional)")
              }
              value={text}
              onChange={(event) => setText(event.target.value)}
              className="block h-20 w-full resize-none rounded-lg border bg-background px-2.5 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            />
          ) : null}
          {unlock ? (
            <>
              <Button
                className="w-full"
                disabled={pending}
                onClick={() =>
                  source
                    ? goTo(scopeThreadRef(source.environmentId, source.id))
                    : void openProjectFolder(selected)
                }
              >
                <ExternalLink />
                {source ? uiText("Open conversation") : uiText("Open project folder")}
              </Button>
              <Button
                variant="outline"
                className="w-full"
                disabled={pending}
                onClick={() => void answer(selected, "note", text)}
              >
                {uiText("Tell the agent I’m done")}
              </Button>
            </>
          ) : kind === "review" ? (
            writing ? (
              <div className="flex gap-2">
                <Button
                  className="flex-1"
                  disabled={pending || !text.trim()}
                  onClick={() => void answer(selected, "reject", text)}
                >
                  {uiText("Send feedback")}
                </Button>
                <Button variant="outline" disabled={pending} onClick={() => setWriting(false)}>
                  {uiText("Cancel")}
                </Button>
              </div>
            ) : (
              <>
                <Button
                  className="w-full"
                  disabled={pending}
                  onClick={() => void answer(selected, "approve", "")}
                >
                  <Check />
                  {uiText("Approve and continue")}
                </Button>
                <Button
                  variant="outline"
                  className="w-full"
                  disabled={pending}
                  onClick={() => setWriting(true)}
                >
                  {uiText("Describe what needs to change.")}
                </Button>
              </>
            )
          ) : kind === "decide" ? (
            <Button
              className="w-full"
              disabled={pending}
              onClick={() => void answer(selected, "approve", text)}
            >
              <Check />
              {uiText("I’ve decided")}
            </Button>
          ) : (
            <>
              <Button
                className="w-full"
                disabled={pending}
                onClick={() => void answer(selected, "toggle", text)}
              >
                <Check />
                {uiText("I’m done")}
              </Button>
              {!writing ? (
                <Button
                  variant="outline"
                  className="w-full"
                  disabled={pending}
                  onClick={() => setWriting(true)}
                >
                  {uiText("Add a note")}
                </Button>
              ) : null}
            </>
          )}
          <div className="flex justify-end">
            <TaskBoardSnooze task={selected} environmentId={threadRef.environmentId} />
          </div>
        </div>
        <p className="mt-3 text-3xs leading-relaxed text-muted-foreground">
          {source
            ? uiText(
                "Your reply will be sent to “{title}” for this item only. The project will stay open.",
                { title: source.title },
              )
            : uiText(
                "This project has no linked conversation. Replies are saved on the task. Link a conversation in All projects.",
              )}
        </p>
      </div>
    );
  }

  const list = tab === "reply" ? replyTasks : laterTasks;
  const requests = tab === "reply" ? threadRequests : [];
  const replyCount =
    replyTasks.length + threadRequests.filter((request) => request.reason !== "有新结果").length;
  return (
    <div className="pb-3">
      <div className="flex items-center gap-4 border-b px-3.5 pt-2 text-xs">
        {(
          [
            ["reply", uiText("Awaiting reply ({replyCount})", { replyCount })],
            ["later", uiText("Later ({count})", { count: laterTasks.length })],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-pressed={tab === id}
            onClick={() => setTab(id)}
            className={`-mb-px border-b-2 pb-2 ${tab === id ? "border-foreground font-semibold text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            {label}
          </button>
        ))}
      </div>
      {list.length === 0 && requests.length === 0 ? (
        <div className="px-6 py-10 text-center text-xs text-muted-foreground">
          <div className="mx-auto mb-3 grid size-10 place-items-center rounded-xl bg-success/10 text-success-foreground">
            <Check className="size-5" />
          </div>
          <p className="text-sm font-medium text-foreground">
            {tab === "reply" ? uiText("You’re all caught up") : uiText("Nothing deferred")}
          </p>
          <p className="mt-1">
            {tab === "reply"
              ? uiText("New items that need your attention will appear here.")
              : uiText("Items you defer with Remind me later appear here.")}
          </p>
        </div>
      ) : null}
      <ul>
        {list.map((task) => {
          const days = boardWaitDays(task, now);
          return (
            <li key={task.folder} className="border-b last:border-b-0">
              <button
                type="button"
                data-task-folder={task.folder}
                onClick={() => select(task)}
                className="flex w-full items-start gap-2 px-3.5 py-3 text-left outline-none hover:bg-accent focus-visible:bg-accent"
              >
                <span className="min-w-0 flex-1">
                  <span className="block break-words text-sm leading-snug font-medium">
                    {inboxRequestText(task)}
                  </span>
                  <span className="mt-1 block truncate text-xs text-muted-foreground">
                    {task.title}
                    {task.state === "blocked" ? uiText(" · Blocked") : ""}
                    {days
                      ? days === 1
                        ? uiText(" · Waiting {days} day", { days })
                        : uiText(" · Waiting {days} days", { days })
                      : ""}
                  </span>
                </span>
                <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              </button>
            </li>
          );
        })}
        {requests.map((request) => (
          <li key={request.key} className="flex items-start gap-1 border-b last:border-b-0">
            <button
              type="button"
              onClick={() => goTo(request.ref)}
              className="min-w-0 flex-1 px-3.5 py-3 text-left outline-none hover:bg-accent focus-visible:bg-accent"
            >
              <span className="block break-words text-sm leading-snug font-medium">
                {uiText("Task request: {reason} · {title}", {
                  reason: inboxLabel(request.reason),
                  title: request.title,
                })}
              </span>
              <span className="mt-1 block truncate text-xs text-muted-foreground">
                {request.place}
              </span>
            </button>
            {request.dismiss ? (
              <Button
                size="xs"
                variant="ghost"
                className="mt-2.5 mr-2"
                onClick={() => request.dismiss?.()}
              >
                {request.dismissLabel}
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
