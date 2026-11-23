import type { OrchestrationV2PlanStep } from "@t3tools/contracts";
import type { TrailActivity } from "./taskTrailModel";
import { trailFailureKind } from "./taskTrailFailures";

const MAX_MILESTONES = 6;

export type MilestoneStatus = "todo" | "run" | "need" | "problem" | "done";

export interface Milestone {
  readonly id: string;
  readonly name: string;
  readonly status: MilestoneStatus;
  readonly stepIds: readonly string[];
  readonly completedSteps: number;
  readonly operations: readonly TrailActivity[];
  /** Failures that cost something and were followed by a success of the same kind of work. */
  readonly retries: number;
  /** Failures that cost something and were never followed by a success. */
  readonly unresolved: number;
}

/**
 * Sizes of consecutive groups for `total` plan items: one each up to six, then
 * k = min(6, ceil(n / 2)) groups with the remainder given to the earliest groups.
 */
export function milestoneGroupSizes(total: number): number[] {
  if (total <= 0) return [];
  if (total <= MAX_MILESTONES) return Array.from({ length: total }, () => 1);
  const groups = Math.min(MAX_MILESTONES, Math.ceil(total / 2));
  const base = Math.floor(total / groups);
  const extra = total % groups;
  return Array.from({ length: groups }, (_, index) => base + (index < extra ? 1 : 0));
}

function workKey(activity: TrailActivity): string {
  const subject =
    activity.path ??
    activity.program ??
    activity.command?.trim().split(/\s+/).slice(0, 2).join(" ") ??
    activity.label;
  return `${activity.kind}:${subject}`;
}

/**
 * A real failure (see `trailFailureKind`) counts as a retry when the same kind of work later
 * succeeded in the milestone, and as unresolved otherwise. Probes that found nothing count as
 * neither.
 */
export function countRetries(operations: readonly TrailActivity[]) {
  let retries = 0;
  let unresolved = 0;
  operations.forEach((activity, index) => {
    if (trailFailureKind(activity) !== "failed") return;
    const key = workKey(activity);
    const recovered = operations
      .slice(index + 1)
      .some((later) => workKey(later) === key && later.status === "completed");
    if (recovered) retries++;
    else unresolved++;
  });
  return { retries, unresolved };
}

export interface MilestoneInput {
  readonly steps: readonly OrchestrationV2PlanStep[];
  readonly activities: Readonly<Record<string, readonly TrailActivity[]>>;
  /** The step that is waiting on the user, when there is one. */
  readonly waitingStepId?: string | undefined;
}

export function deriveMilestones({
  steps,
  activities,
  waitingStepId,
}: MilestoneInput): Milestone[] {
  let offset = 0;
  return milestoneGroupSizes(steps.length).map((size, index) => {
    const group = steps.slice(offset, offset + size);
    offset += size;
    const completedSteps = group.filter((step) => step.status === "completed").length;
    const operations = group.flatMap((step) => activities[step.id] ?? []);
    const { retries, unresolved } = countRetries(operations);
    const finished = completedSteps === group.length;
    const status: MilestoneStatus = finished
      ? "done"
      : group.some((step) => step.id === waitingStepId)
        ? "need"
        : unresolved > 0
          ? "problem"
          : group.some((step) => step.status === "running") || completedSteps > 0
            ? "run"
            : "todo";
    const lead = group.find((step) => step.status !== "completed") ?? group.at(-1)!;
    return {
      id: `milestone-${index}`,
      name: lead.text,
      status,
      stepIds: group.map((step) => step.id),
      completedSteps,
      operations,
      retries,
      unresolved,
    };
  });
}

/** The milestone that holds attention: a wait first, then trouble, then the one running. */
export function currentMilestoneIndex(milestones: readonly Milestone[]): number {
  const rank = (status: MilestoneStatus) =>
    status === "need"
      ? 0
      : status === "problem"
        ? 1
        : status === "run"
          ? 2
          : status === "todo"
            ? 3
            : 4;
  let best = -1;
  milestones.forEach((milestone, index) => {
    if (milestone.status === "done") return;
    if (best < 0 || rank(milestone.status) < rank(milestones[best]!.status)) best = index;
  });
  return best;
}

export type CapsuleMode = "idle" | "run" | "need" | "problem" | "done";

/** Priority is fixed: waiting on you, then trouble, then work in flight. */
export function capsuleMode(
  milestones: readonly Milestone[],
  options: {
    readonly waiting: boolean;
    readonly complete: boolean;
    readonly failed?: boolean;
  },
): CapsuleMode {
  if (options.waiting) return "need";
  if (options.complete && milestones.length > 0) return "done";
  if (options.failed || milestones.some((milestone) => milestone.status === "problem")) {
    return "problem";
  }
  return milestones.some((milestone) => milestone.status === "run") ? "run" : "idle";
}
