import { uiText } from "../../i18n";
import { commandHadNoMatches } from "@t3tools/shared/toolOutput";
import { commandPresentation, commandTestResult } from "./commandPresentation";
import type { EnvironmentThreadShell, ThreadStructure } from "@t3tools/client-runtime/state/shell";
import {
  deriveProviderSubagentStatus,
  deriveThreadActivityRun,
} from "@t3tools/client-runtime/state/thread-execution";
import type { OrchestrationV2PlanStep } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { taskProgressSnapshot, type TaskProgressSnapshot } from "../../taskProgress";

export type TrailTool = "read" | "write" | "command" | "image" | "search" | "delegate";
export interface TrailActivity {
  id: string;
  kind: TrailTool;
  label: string;
  path?: string;
  program?: string;
  command?: string;
  status?: "completed" | "running" | "failed" | "stopped" | "waiting" | "no_matches";
}
export interface TrailDetails {
  activities: Record<string, TrailActivity[]>;
  fileCount?: number;
  durationMs?: number;
  choices: string[];
}
const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const field = (value: unknown, keys: string[]) => {
  const object = record(value);
  for (const key of keys) if (typeof object?.[key] === "string") return object[key];
  return undefined;
};

function commandActivity(
  base: Pick<TrailActivity, "id" | "status">,
  command: string,
  title: string | undefined | null,
  output: unknown,
  exitCode: unknown,
  failed: unknown,
  outputOmitted = false,
): TrailActivity {
  const outputRecord = record(output);
  const code = exitCode ?? outputRecord?.exitCode ?? outputRecord?.exit_code;
  const failure =
    failed ||
    outputRecord?.outputIndicatesFailure ||
    outputRecord?.isError ||
    outputRecord?.is_error;

  const noMatches = commandHadNoMatches({
    input: command,
    exitCode: code,
    output:
      outputRecord && typeof outputRecord.stderr === "string"
        ? field(output, ["output", "stdout", "text"])
        : output,
    stderr: outputRecord?.stderr,
    outputOmitted,
    outputIndicatesFailure: failure,
  });
  const status = noMatches
    ? "no_matches"
    : (typeof code === "number" && code !== 0) || failure
      ? "failed"
      : (base.status ?? "running");
  const presentation = commandPresentation(command, title);
  const outputText =
    typeof output === "string"
      ? output
      : (field(output, ["output", "stdout", "text"]) ?? JSON.stringify(output));
  return {
    ...base,
    status,
    kind: "command",
    command,
    ...presentation,
    label: commandTestResult(presentation.label, status, outputText),
  };
}

export function trailActivity(item: ThreadStructure["turnItems"][number]): TrailActivity[] {
  const status =
    item.status === "failed"
      ? ("failed" as const)
      : item.status === "completed"
        ? ("completed" as const)
        : item.status === "cancelled" || item.status === "interrupted"
          ? ("stopped" as const)
          : item.status === "pending" || item.status === "waiting" || item.status === "idle"
            ? ("waiting" as const)
            : ("running" as const);
  const base = { id: item.id, status };
  switch (item.type) {
    case "file_change":
      return [{ ...base, kind: "write", label: uiText("Write."), path: item.fileName }];
    case "command_execution": {
      return [
        commandActivity(
          base,
          item.input,
          item.title,
          item.output,
          item.exitCode,
          item.outputIndicatesFailure,
          item.outputOmitted,
        ),
      ];
    }
    case "file_search":
      return [
        {
          ...base,
          kind: "search",
          label: uiText("Search for {query}", {
            query: item.pattern ?? item.title ?? uiText("File"),
          }),
        },
      ];
    case "web_search":
      return [
        {
          ...base,
          kind: "search",
          label: uiText("Search for {query}", {
            query: item.patterns?.join(" · ") ?? item.title ?? uiText("Web page"),
          }),
        },
      ];
    case "subagent":
      return [
        {
          ...base,
          kind: "delegate",
          label: uiText("Delegate {driver}", { driver: item.title ?? item.driver }),
        },
      ];
    case "dynamic_tool": {
      const name = item.toolName?.toLowerCase().replace(/^running\s+/, "") ?? "";
      if (
        /(^|[_.])(bash|shell|exec_command|shell_command|run_command|run_terminal_command)$/.test(
          name,
        )
      ) {
        const command = field(item.input, ["command", "cmd", "command_line", "CommandLine"]);
        if (command)
          return [
            commandActivity(
              base,
              command,
              field(item.input, ["description", "Description"]) ?? item.title,
              item.output,
              record(item)?.exitCode,
              record(item)?.outputIndicatesFailure,
              item.outputOmitted,
            ),
          ];
      }
      const path = field(item.input, ["file_path", "path", "Path", "filename", "file"]);
      if (
        /(^|[_./])(read|read_file|view_image|open_file)$/.test(name) &&
        (path || item.viewedImagePath)
      ) {
        return [
          { ...base, kind: "read", label: uiText("Read"), path: path ?? item.viewedImagePath! },
        ];
      }
      if (/(write_file|edit_file|write|edit)$/.test(name) && path) {
        return [{ ...base, kind: "write", label: uiText("Write."), path }];
      }
      if (/imagegen|generate_image|image_gen/.test(name)) {
        const outputPath = field(item.output, ["path", "file_path", "output_path"]);
        return [
          {
            ...base,
            kind: "image",
            label: uiText("Generate image"),
            ...(outputPath ? { path: outputPath } : {}),
          },
        ];
      }
      if (/(^|[_.])(invoke_subagent|delegate_task|spawn_agent)$/.test(name)) {
        const role =
          field(item.input, ["Role", "role", "title", "TypeName"]) ?? item.title ?? uiText("Agent");
        return [
          { ...base, kind: "delegate", label: uiText("Delegate {driver}", { driver: role }) },
        ];
      }
      if (/(^|[_.])(search_web|web_search|grep_search|find_by_name)$/.test(name)) {
        const query =
          field(item.input, ["query", "Query", "Pattern", "pattern"]) ??
          item.title ??
          uiText("Search");
        return [{ ...base, kind: "search", label: uiText("Search for {query}", { query }) }];
      }
      const summary =
        field(item.input, ["toolSummary", "description", "Description"]) ?? item.title;
      if (summary) {
        return [{ ...base, kind: "command", label: summary }];
      }
      return [];
    }
    default:
      return [];
  }
}

export function taskTrailDetails(
  progress: TaskProgressSnapshot,
  projection: ThreadStructure | null,
): TrailDetails {
  const result: TrailDetails = { activities: {}, choices: [] };
  if (!projection || progress.planId === undefined) return result;
  const plan = projection.plans.find((entry) => entry.id === progress.planId);
  if (!plan) return result;
  const items = projection.turnItems.filter(
    (item) => item.runId === plan.runId && (plan.runId !== null || item.nodeId === plan.nodeId),
  );
  const observedEnd = items.reduce(
    (latest, item) =>
      Math.max(
        latest,
        item.startedAt ? DateTime.toEpochMillis(item.startedAt) + 1 : 0,
        item.completedAt ? DateTime.toEpochMillis(item.completedAt) + 1 : 0,
      ),
    0,
  );
  const history = items
    .filter((item) => item.type === "todo_list" && item.planId === plan.id)
    .toSorted((a, b) => a.ordinal - b.ordinal);
  for (const step of progress.steps) {
    const windows: { start: number; end: number }[] = [];
    for (let index = 0; index < history.length; index++) {
      const snapshot = history[index]!;
      if (snapshot.type !== "todo_list") continue;
      const prior = snapshot.steps.find(
        (entry) => entry.id === step.id && entry.text === step.text,
      );
      if (prior?.status !== "running" || !prior.durationAnchorAt) continue;
      const start = Date.parse(prior.durationAnchorAt);
      const next = history
        .slice(index + 1)
        .find(
          (entry) =>
            entry.type === "todo_list" &&
            entry.steps.find((candidate) => candidate.id === step.id)?.status !== "running",
        );
      const end =
        next?.type === "todo_list"
          ? DateTime.toEpochMillis(next.updatedAt)
          : step.status === "running"
            ? observedEnd
            : Number.NaN;
      if (Number.isFinite(start) && Number.isFinite(end) && end >= start)
        windows.push({ start, end });
    }
    if (step.status === "running" && step.durationAnchorAt && windows.length === 0) {
      const start = Date.parse(step.durationAnchorAt);
      const end = observedEnd;
      if (Number.isFinite(start) && end >= start) windows.push({ start, end });
    }
    if (windows.length === 0) continue;
    result.activities[step.id] = items.flatMap((item) => {
      if (!item.startedAt) return [];
      const time = DateTime.toEpochMillis(item.startedAt);
      return windows.some(({ start, end }) => time >= start && time < end)
        ? trailActivity(item)
        : [];
    });
  }
  const files = new Set(
    items.flatMap((item) =>
      item.status === "completed"
        ? trailActivity(item)
            .filter((entry) => entry.kind === "write" || entry.kind === "image")
            .flatMap((entry) => (entry.path ? [entry.path] : []))
        : [],
    ),
  );
  if (files.size > 0) result.fileCount = files.size;
  if (progress.steps.length > 0 && progress.steps.every((step) => step.durationMs !== undefined)) {
    result.durationMs = progress.steps.reduce((total, step) => total + (step.durationMs ?? 0), 0);
  }
  for (const item of items) {
    if (item.type !== "user_input_request") continue;
    const request = projection.runtimeRequests.find((entry) => entry.id === item.requestId);
    if (request?.status !== "resolved" || !request.answers) continue;
    for (const question of item.questions) {
      const answer = request.answers[question.id];
      const values = typeof answer === "string" ? [answer] : Array.isArray(answer) ? answer : [];
      for (const option of question.options)
        if (values.includes(option.value ?? option.label)) result.choices.push(option.label);
    }
  }
  return result;
}

function activityStepTitle(activity: TrailActivity): string {
  if (activity.path) {
    const base = activity.path.split(/[\\/]/).at(-1) || activity.path;
    return `${activity.label} ${base}`;
  }
  return activity.label;
}

/**
 * Fallback step snapshot for providers (such as Antigravity/ACP) that execute tool calls without
 * emitting an explicit `todo_list` plan. Keeps the floating TaskPlanCapsule informative instead of
 * leaving the user staring at "Thinking".
 */
export function liveActivityTrailSnapshot(
  projection: ThreadStructure | null,
  shell: EnvironmentThreadShell | null,
  connected = true,
): { readonly progress: TaskProgressSnapshot; readonly details: TrailDetails } | null {
  if (!projection) return null;
  const explicit = taskProgressSnapshot(projection, shell, connected);
  if (explicit.total > 0) return null;

  const activity = deriveThreadActivityRun(projection);
  const shellRun = shell?.latestRun;
  const runId =
    shell?.runtime?.activeRunId ??
    (shellRun?.status !== "queued" ? shellRun?.runId : undefined) ??
    activity?.runId ??
    null;
  const run = projection.runs.find((candidate) => candidate.id === runId);
  if (runId !== null && !run) return null;
  if (run?.status === "rolled_back") return null;
  const status =
    runId === null
      ? deriveProviderSubagentStatus(projection)?.status
      : shellRun?.runId === runId
        ? shellRun.status
        : run?.status;
  const nativeRoot =
    runId === null && status !== undefined
      ? projection.nodes.findLast((node) => node.kind === "root_turn" && node.runId === null)
      : undefined;
  if (runId === null && (!nativeRoot || nativeRoot.status === "rolled_back")) return null;

  const isLive =
    status === "running" ||
    status === "waiting" ||
    status === "starting" ||
    status === "preparing" ||
    shell?.hasPendingApprovals === true ||
    shell?.hasPendingUserInput === true ||
    shell?.blockedOnThreadWait === true;

  const items = projection.turnItems
    .filter(
      (item) =>
        item.runId === runId &&
        (runId !== null ||
          item.nodeId === nativeRoot?.id ||
          projection.nodes.some(
            (node) => node.id === item.nodeId && node.rootNodeId === nativeRoot?.id,
          )),
    )
    .toSorted((a, b) => a.ordinal - b.ordinal);

  const collected = items.flatMap((item) => trailActivity(item));
  if (collected.length === 0) return null;
  if (!isLive && collected.length < 2) return null;

  // Group consecutive operations into high-level semantic phases instead of exposing
  // raw repetitive grep/search calls as fake multi-stage plan steps.
  type SemanticPhase = "explore" | "edit" | "verify" | "delegate";
  const phaseOf = (act: TrailActivity): SemanticPhase => {
    if (act.kind === "delegate") return "delegate";
    if (act.kind === "write" || act.kind === "image") return "edit";
    if (act.kind === "search" || act.kind === "read") return "explore";
    if (
      act.command &&
      /^\s*(?:cd\s+\S+\s*&&\s*)?(?:rg|grep|git\s+grep|fd|find|ls|cat|head|tail|sed)\b/.test(
        act.command,
      )
    ) {
      return "explore";
    }
    return "verify";
  };

  const groups: { phase: SemanticPhase; items: TrailActivity[] }[] = [];
  for (const act of collected) {
    const phase = phaseOf(act);
    const prev = groups.at(-1);
    if (prev && prev.phase === phase) {
      prev.items.push(act);
    } else {
      groups.push({ phase, items: [act] });
    }
  }
  const visibleGroups = groups.length > 6 ? groups.slice(-6) : groups;
  const activitiesByStep: Record<string, TrailActivity[]> = {};
  const steps: OrchestrationV2PlanStep[] = visibleGroups.map((group, index) => {
    const id = `live-step-${index}`;
    activitiesByStep[id] = group.items;
    const latest = group.items.at(-1)!;
    const anyRunning = group.items.some(
      (entry) => entry.status === "running" || entry.status === "waiting",
    );
    const stepStatus: OrchestrationV2PlanStep["status"] =
      anyRunning || (isLive && index === visibleGroups.length - 1 && status === "running")
        ? "running"
        : "completed";
    const title =
      group.phase === "explore" && group.items.length > 1
        ? uiText("Inspect & search workspace ({count})", { count: group.items.length })
        : group.phase === "edit" && group.items.length > 1
          ? uiText("Update {count} files", { count: group.items.length })
          : activityStepTitle(latest);
    return {
      id,
      text: title,
      status: stepStatus,
    };
  });

  const completed = steps.filter((step) => step.status === "completed").length;
  let state: TaskProgressSnapshot["state"];
  if (status === "failed") state = "failed";
  else if (status === "cancelled" || status === "interrupted") state = "stopped";
  else if (shell?.hasPendingApprovals) state = "approval";
  else if (shell?.hasPendingUserInput) state = "input";
  else if (shell?.blockedOnThreadWait || status === "waiting") state = "waiting";
  else if (status === "queued" || status === "preparing" || status === "starting") state = "queued";
  else if (completed === steps.length) state = "complete";
  else if (status === "running") state = "running";
  else state = "incomplete";

  const files = new Set(
    collected
      .filter(
        (entry) =>
          entry.status === "completed" && (entry.kind === "write" || entry.kind === "image"),
      )
      .flatMap((entry) => (entry.path ? [entry.path] : [])),
  );
  let durationMs: number | undefined;
  if (run?.startedAt && run.completedAt) {
    const elapsed = DateTime.toEpochMillis(run.completedAt) - DateTime.toEpochMillis(run.startedAt);
    if (Number.isFinite(elapsed) && elapsed >= 0) durationMs = elapsed;
  }

  return {
    progress: {
      steps,
      completed,
      total: steps.length,
      remaining: steps.length - completed,
      state,
      stale: !connected,
    },
    details: {
      activities: activitiesByStep,
      ...(files.size > 0 ? { fileCount: files.size } : {}),
      ...(durationMs !== undefined ? { durationMs } : {}),
      choices: [],
    },
  };
}
