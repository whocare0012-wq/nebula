import { uiText } from "./i18n";
export type BoardLevel = "none" | "self" | "review" | "user";
export type BoardKind = "decide" | "review" | "do" | "unlock" | "blocked";
export interface BoardStep {
  id: string;
  name: string;
  who: "user" | "agent";
  done: boolean;
  note?: string;
  level?: BoardLevel;
  required?: BoardLevel;
  pending_review?: boolean;
  evidence?: string[];
  done_by?: string;
  done_at?: string;
  legacy?: boolean;
  kind?: BoardKind | null;
  judge?: string | null;
}
export interface BoardTask {
  folder: string;
  title: string;
  state: "user" | "blocked" | "agent" | "done";
  kind?: BoardKind | null;
  judge?: string | null;
  current_id?: string | null;
  type_label?: string;
  state_since?: string;
  notify_key: string;
  snoozed: boolean;
  stale: boolean;
  age_days: number | null;
  steps: BoardStep[];
  missing: string[];
  next: string;
  blocked: string;
  sessions: string[];
  done_count: number;
  total: number;
}
export interface BoardCounts {
  active: number;
  user: number;
  blocked: number;
  agent: number;
  stale: number;
  done_week: number;
  badge: number;
  review?: number;
  unread?: number;
  suggestions?: number;
}
export interface BoardData {
  tasks: BoardTask[];
  counts: BoardCounts;
  current?: BoardTask | null;
}
export const boardStateLabel = {
  get user() {
    return uiText("Waiting for you");
  },
  get blocked() {
    return uiText("Blocked.");
  },
  get agent() {
    return uiText("Agent working");
  },
  get done() {
    return uiText("Completed");
  },
};
function isBoardTaskPath(folder: string, cwd: string | null | undefined) {
  const normalize = (value: string) => value.replace(/\/+/g, "/").replace(/\/$/, "");
  const root = (value: string) =>
    !value || /^(?:\/(?:Users|home)(?:\/[^/]+(?:\/Documents)?)?|~(?:\/Documents)?)$/.test(value);
  const base = normalize(folder);
  const path = normalize(cwd ?? "");
  return !root(base) && !root(path) && (path === base || path.startsWith(base + "/"));
}
export function matchBoardTask(
  tasks: readonly BoardTask[],
  cwd: string | null | undefined,
  threadId?: string,
) {
  return (
    tasks.find((task) => threadId !== undefined && task.sessions.includes(threadId)) ??
    tasks
      .filter((task) => isBoardTaskPath(task.folder, cwd))
      .sort((a, b) => b.folder.length - a.folder.length)[0] ??
    null
  );
}
export function canPresentBoardTask(
  task: BoardTask,
  now: Date,
  seen: Record<string, number>,
  last: Record<string, number>,
  busy: boolean,
) {
  return (
    !busy &&
    now.getHours() >= 9 &&
    now.getHours() < 23 &&
    !task.snoozed &&
    !task.stale &&
    (task.state === "user" || task.state === "blocked") &&
    seen[task.notify_key] === undefined &&
    (last[task.folder] === undefined || now.getTime() - last[task.folder]! >= 4 * 3600000)
  );
}
export function boardTaskMatchesFilter(task: BoardTask, filter: string, now: number) {
  if (filter === "active") return task.state !== "done";
  if (filter === "stale") return task.stale && !task.snoozed;
  if (filter === "done_week")
    return (
      task.state === "done" &&
      !!task.state_since &&
      Date.parse(task.state_since) >= now - 7 * 86400000
    );
  return task.state === filter && !task.snoozed;
}

export interface BoardDelivery {
  seen: Record<string, number>;
  last: Record<string, number>;
  summary: string;
}
export function readBoardDelivery(raw: string | null): BoardDelivery {
  try {
    const value = JSON.parse(raw ?? "null") as BoardDelivery | null;
    if (
      value &&
      typeof value.seen === "object" &&
      value.seen &&
      !Array.isArray(value.seen) &&
      typeof value.last === "object" &&
      value.last &&
      !Array.isArray(value.last) &&
      typeof value.summary === "string" &&
      Object.values(value.seen).every(Number.isFinite) &&
      Object.values(value.last).every(Number.isFinite)
    )
      return value;
  } catch {
    /* An invalid local delivery record must not disable future reminders. */
  }
  return { seen: {}, last: {}, summary: "" };
}
export function boardSummaryDay(now: Date) {
  return `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
}
export function shouldPresentBoardSummary(now: Date, lastDay: string) {
  return (
    now.getHours() * 60 + now.getMinutes() >= 570 &&
    now.getHours() < 23 &&
    lastDay !== boardSummaryDay(now)
  );
}

export function boardCurrentStep(task: BoardTask) {
  return (
    task.steps.find((step) => step.id === task.current_id) ??
    task.steps.find((step) => !step.done) ??
    null
  );
}
export function boardTaskKind(task: BoardTask): BoardKind {
  if (task.state === "blocked") return "unlock";
  return task.kind ?? (boardCurrentStep(task)?.pending_review ? "review" : "do");
}
export function boardTaskHeading(task: BoardTask) {
  const current = boardCurrentStep(task);
  return (
    task.judge?.trim() ||
    task.blocked?.trim() ||
    (current ? uiText("Your action: {name}", { name: current.name }) : uiText("All steps passed"))
  );
}
export function boardWaitDays(task: BoardTask, now: number) {
  const since = Date.parse(task.state_since ?? "");
  return Number.isFinite(since) ? Math.max(0, Math.floor((now - since) / 86400000)) : null;
}
export function boardTaskGroup(task: BoardTask) {
  if (task.state === "blocked") return "blocked";
  if (task.state === "agent") return "agent";
  if (task.state === "done") return "done";
  return ["decide", "review"].includes(boardTaskKind(task)) ? "judge" : "do";
}
export function sortBoardTasks(tasks: readonly BoardTask[]) {
  const since = (task: BoardTask) => {
    const value = Date.parse(task.state_since ?? "");
    return Number.isFinite(value) ? value : Infinity;
  };
  return [...tasks].sort((a, b) => since(a) - since(b));
}
export function boardProgress(task: BoardTask) {
  const step = boardCurrentStep(task);
  const currentIndex = step ? task.steps.indexOf(step) : -1;
  const nextGate =
    currentIndex < 0
      ? -1
      : task.steps.findIndex((s, i) => i > currentIndex && s.required === "user");
  return { currentIndex, nextGateDistance: nextGate < 0 ? null : nextGate - currentIndex };
}
export function boardLevelRank(step: BoardStep) {
  return step.legacy && step.done
    ? 3
    : ["none", "self", "review", "user"].indexOf(step.level ?? (step.done ? "user" : "none"));
}
export function boardApprovalsToday(tasks: readonly BoardTask[], now: Date) {
  const steps = tasks.flatMap((task) => task.steps);
  if (!steps.some((step) => step.done_by && step.done_at)) return null;
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return steps.filter(
    (step) => step.done && step.done_by === "user" && step.done_at?.slice(0, 10) === today,
  ).length;
}
export function boardEvidenceTarget(
  folder: string,
  evidence: string,
): { kind: "url"; value: string } | { kind: "file"; value: string } | null {
  const value = evidence.trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return { kind: "url", value };
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return null;
  return { kind: "file", value: value.startsWith("/") ? value : `${folder}/${value}` };
}
