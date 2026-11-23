import { uiText } from "./i18n";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { create } from "zustand";
import type { BoardData } from "./taskBoard.logic";
const TASK_BOARD_ORIGIN = "http://127.0.0.1:8765";
export const TASK_BOARD_START_COMMAND =
  "launchctl kickstart -k gui/$(id -u)/com.xiaoxin.task-board";
interface BoardState {
  reveal: { folder: string | null; revision: number } | null;
  data: BoardData | null;
  error: string | null;
  cwd: string | null;
  loading: boolean;
  dataCwd: string | null;
  entry: { threadKey: string; revision: number } | null;
  /** The inbox item being answered; survives the switch to its source conversation. */
  focus: { folder: string; returnTo: ScopedThreadRef | null } | null;
  /** Conversation-level requests (approvals, questions, failures) published by the sidebar. */
  threadRequests: readonly InboxThreadRequest[];
}
export interface InboxThreadRequest {
  readonly key: string;
  readonly ref: ScopedThreadRef;
  readonly title: string;
  readonly reason: string;
  readonly place: string;
  readonly dismissLabel: string | null;
  readonly dismiss: (() => void) | null;
}
export const useTaskBoard = create<BoardState>(() => ({
  reveal: null,
  data: null,
  error: null,
  cwd: null,
  loading: true,
  dataCwd: null,
  entry: null,
  focus: null,
  threadRequests: [],
}));
export function focusTaskBoardItem(folder: string | null, returnTo: ScopedThreadRef | null = null) {
  useTaskBoard.setState({ focus: folder === null ? null : { folder, returnTo } });
}
let controller: AbortController | null = null;
let refreshing: Promise<void> | null = null;
let generation = 0;
export function refreshTaskBoard(): Promise<void> {
  if (refreshing) return refreshing;
  const revision = generation;
  const cwd = useTaskBoard.getState().cwd;
  controller = new AbortController();
  const timeout = setTimeout(() => controller?.abort(), 5000);
  refreshing = (async () => {
    try {
      const response = await fetch(
        `${TASK_BOARD_ORIGIN}/api/tasks${cwd ? "?cwd=" + encodeURIComponent(cwd) : ""}`,
        { signal: controller!.signal, credentials: "omit", cache: "no-store" },
      );
      if (!response.ok) throw new Error(uiText("Task board service unavailable"));
      const raw = (await response.json()) as BoardData;
      const data: BoardData = {
        tasks: raw.tasks,
        counts: raw.counts,
        ...(raw.current !== undefined ? { current: raw.current } : {}),
      };
      if (!Array.isArray(data.tasks) || !data.counts)
        throw new Error(uiText("Invalid task board data"));
      if (revision !== generation) return;
      const previous = useTaskBoard.getState();
      const unchanged = JSON.stringify(previous.data) === JSON.stringify(data);
      if (!unchanged || previous.error || previous.loading || previous.dataCwd !== cwd)
        useTaskBoard.setState({
          data: unchanged ? previous.data : data,
          error: null,
          loading: false,
          dataCwd: cwd,
        });
    } catch {
      if (
        revision === generation &&
        (useTaskBoard.getState().error !== uiText("Task board service is offline") ||
          useTaskBoard.getState().loading)
      )
        useTaskBoard.setState({ error: uiText("Task board service is offline"), loading: false });
    } finally {
      clearTimeout(timeout);
      refreshing = null;
      controller = null;
    }
  })();
  return refreshing;
}
export async function setTaskBoardCwd(cwd: string | null) {
  if (useTaskBoard.getState().cwd === cwd) return;
  generation++;
  useTaskBoard.setState({ cwd });
  controller?.abort();
  await refreshing;
  await refreshTaskBoard();
}
export function startTaskBoardPolling() {
  let timer: ReturnType<typeof setInterval> | undefined;
  const configure = () => {
    clearInterval(timer);
    if (document.visibilityState !== "visible") {
      generation++;
      controller?.abort();
      return;
    }
    if (document.hasFocus()) void refreshTaskBoard();
    timer = setInterval(() => void refreshTaskBoard(), document.hasFocus() ? 30000 : 120000);
  };
  void refreshTaskBoard();
  configure();
  document.addEventListener("visibilitychange", configure);
  window.addEventListener("focus", configure);
  window.addEventListener("blur", configure);
  return () => {
    clearInterval(timer);
    document.removeEventListener("visibilitychange", configure);
    window.removeEventListener("focus", configure);
    window.removeEventListener("blur", configure);
    generation++;
    controller?.abort();
  };
}
export async function mutateTaskBoard(
  action: "toggle" | "snooze" | "review" | "link",
  body: {
    folder: string;
    session?: string;
    action?: "link" | "unlink";
    source?: "manual" | "auto" | "agent";
    title?: string;
    step?: string;
    until?: string;
    decision?: "approve" | "reject";
    reason?: string;
    target?: string;
  },
) {
  if (
    action === "review" &&
    (!body.step || !body.decision || (body.decision === "reject" && !body.reason?.trim()))
  )
    throw new Error(uiText("Add a reason for requesting changes"));
  const response = await fetch(`${TASK_BOARD_ORIGIN}/api/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "omit",
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(uiText("Changes weren’t saved. Refresh and try again."));
  generation++;
  controller?.abort();
  await refreshing;
  await refreshTaskBoard();
  if (useTaskBoard.getState().error)
    throw new Error(uiText("Submitted. Refresh to verify the status before trying again."));
}

export function requestTaskBoardCurrent(ref: ScopedThreadRef) {
  useTaskBoard.setState((state) => ({
    entry: { threadKey: scopedThreadKey(ref), revision: (state.entry?.revision ?? 0) + 1 },
  }));
}

export function requestTaskBoardCard(folder: string | null = null) {
  useTaskBoard.setState((state) => ({
    reveal: { folder, revision: (state.reveal?.revision ?? 0) + 1 },
  }));
}
