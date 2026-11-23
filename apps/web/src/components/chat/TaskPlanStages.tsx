import { useId, useState, type ReactNode } from "react";
import { ChevronRightIcon } from "lucide-react";

import { useUiText } from "~/i18n/useUiText";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { middleTruncateFilename } from "./commandPresentation";
import { formatStepDuration } from "./TaskProgressSteps";
import { trailFailureKind } from "./taskTrailFailures";
import type { Milestone } from "./taskMilestones";
import type { TrailActivity, TrailTool } from "./taskTrailModel";

type UiText = ReturnType<typeof useUiText>;

export interface GroupedOperationBucket {
  readonly kind: TrailTool;
  readonly items: readonly TrailActivity[];
}

const TOOL_KIND_LABELS: Record<TrailTool, string> = {
  search: "Search",
  read: "Read",
  write: "Write.",
  command: "Command",
  image: "Image",
  delegate: "Delegate",
};

/** Merge operations of the same tool kind in first-seen order for V9 compact tool chips (e.g. 搜索 ×4). */
function groupStageOperations(
  operations: readonly TrailActivity[],
): readonly GroupedOperationBucket[] {
  const buckets: Array<{ kind: TrailTool; items: TrailActivity[] }> = [];
  const byKind = new Map<TrailTool, { kind: TrailTool; items: TrailActivity[] }>();
  for (const operation of operations) {
    const existing = byKind.get(operation.kind);
    if (existing) {
      existing.items.push(operation);
    } else {
      const bucket = { kind: operation.kind, items: [operation] };
      byKind.set(operation.kind, bucket);
      buckets.push(bucket);
    }
  }
  return buckets;
}

/** "Completed · 4 stages · Took 6m 00s", shared by the finished capsule and its history row. */
export function completedTitle(count: number, durationMs: number | undefined, uiText: UiText) {
  return [
    uiText(count === 1 ? "Completed · {count} stage" : "Completed · {count} stages", { count }),
    ...(durationMs === undefined
      ? []
      : [uiText("Took {duration}", { duration: formatStepDuration(durationMs) })]),
  ].join(" · ");
}

function operationSummary(milestone: Milestone, uiText: UiText): string {
  const count = milestone.operations.length;
  if (count === 0) return "";
  return [
    uiText(count === 1 ? "{count} operation" : "{count} operations", { count }),
    ...(milestone.retries > 0
      ? [
          uiText(milestone.retries === 1 ? "{count} retry" : "{count} retries", {
            count: milestone.retries,
          }),
        ]
      : []),
  ].join(" · ");
}

function stageSummary(milestone: Milestone, uiText: UiText) {
  const operations = operationSummary(milestone, uiText);
  switch (milestone.status) {
    case "need":
      return { text: uiText("Needs confirmation"), tone: "need" };
    case "problem":
      return { text: [uiText("Problem"), operations].filter(Boolean).join(" · "), tone: "problem" };
    case "run":
      return { text: [uiText("In progress"), operations].filter(Boolean).join(" · "), tone: "run" };
    case "done":
      return { text: operations || uiText("Completed"), tone: "done" };
    default:
      return { text: uiText("Not started"), tone: "todo" };
  }
}

function StageMark({ status }: { status: Milestone["status"] }) {
  return (
    <span className="plan-stage-mark" data-status={status} aria-hidden>
      {status === "done" ? (
        <svg viewBox="0 0 16 16">
          <path d="M3.6 8.4l3 3 5.8-6.2" />
        </svg>
      ) : null}
    </span>
  );
}

function GroupedToolChips({
  groups,
  onOpenFile,
  uiText,
}: {
  readonly groups: readonly GroupedOperationBucket[];
  readonly onOpenFile?: ((path: string) => void) | undefined;
  readonly uiText: UiText;
}) {
  return (
    <div className="plan-step-sub">
      {groups.map((group) => {
        const kindLabel = uiText(TOOL_KIND_LABELS[group.kind]);
        const tag = group.items.length > 1 ? `${kindLabel} ×${group.items.length}` : kindLabel;
        const separator = group.kind === "search" ? " / " : " · ";
        return (
          <div className="plan-tool-chip" key={group.kind} data-tool-kind={group.kind}>
            <span className="plan-tool-tag">{tag}</span>
            <span className="plan-tool-items">
              {group.items.map((activity, idx) => {
                const failure = trailFailureKind(activity);
                const display = activity.path
                  ? middleTruncateFilename(activity.path)
                  : (activity.command ?? activity.program ?? activity.label);
                return (
                  <span
                    key={activity.id}
                    className="task-command-row plan-tool-item"
                    data-status={activity.status}
                    data-failure={failure ?? undefined}
                    data-activity-id={activity.id}
                  >
                    {idx > 0 ? (
                      <span className="plan-tool-sep" aria-hidden>
                        {separator}
                      </span>
                    ) : null}
                    {activity.path ? (
                      <Tooltip>
                        <TooltipTrigger
                          render={<button type="button" />}
                          className="plan-tool-file"
                          onClick={() => onOpenFile?.(activity.path!)}
                        >
                          {display}
                        </TooltipTrigger>
                        <TooltipPopup>{activity.path}</TooltipPopup>
                      </Tooltip>
                    ) : (
                      <span>{display}</span>
                    )}
                  </span>
                );
              })}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * The milestone list. Operations stay out of sight: a stage shows one summary line, and a click
 * opens its grouped tool chips, which mount on first open and then stays so closing can animate.
 */
export function TaskPlanStages({
  milestones,
  currentIndex,
  openId,
  onToggle,
  extras,
  onOpenFile,
  label,
  liveFallback = false,
}: {
  readonly milestones: readonly Milestone[];
  readonly currentIndex: number;
  readonly openId: string | null;
  readonly onToggle: (id: string) => void;
  readonly extras?: (milestone: Milestone) => ReactNode;
  readonly onOpenFile?: ((path: string) => void) | undefined;
  readonly label: string;
  readonly liveFallback?: boolean;
}) {
  const uiText = useUiText();
  const idPrefix = useId();
  const [mounted, setMounted] = useState<ReadonlySet<string>>(() => new Set());
  if (openId !== null && !mounted.has(openId)) setMounted(new Set(mounted).add(openId));
  return (
    <ol className="plan-stages" aria-label={label}>
      {milestones.map((milestone, index) => {
        const summary = stageSummary(milestone, uiText);
        const groups = groupStageOperations(milestone.operations);
        const extra = extras?.(milestone) ?? null;
        const hasDetail = milestone.operations.length > 0 || extra !== null;
        const open = openId === milestone.id;
        const detailId = `${idPrefix}-${index}`;
        const badgeText = liveFallback
          ? milestone.status === "run"
            ? uiText("In progress")
            : milestone.operations.length > 1
              ? uiText("{count} calls folded", { count: milestone.operations.length })
              : milestone.operations.length === 1
                ? uiText("{count} item", { count: 1 })
                : uiText("Completed")
          : groups.length > 0
            ? `${uiText(groups.length === 1 ? "{count} item" : "{count} items", { count: groups.length })} ${open ? "▴" : "▾"}`
            : milestone.status === "need"
              ? uiText("Needs confirmation")
              : milestone.status === "problem"
                ? uiText("Problem")
                : milestone.status === "run"
                  ? uiText("In progress")
                  : milestone.status === "todo"
                    ? uiText("Not started")
                    : uiText("Completed");
        const content = (
          <>
            <StageMark status={milestone.status} />
            <span className="plan-stage-name">{milestone.name}</span>
            <span className="plan-stage-summary" data-tone={summary.tone}>
              {summary.text}
            </span>
            <span className="plan-stage-badge" data-tone={milestone.status}>
              {badgeText}
            </span>
            {hasDetail ? <ChevronRightIcon className="plan-stage-chevron" aria-hidden /> : null}
          </>
        );
        return (
          <li
            key={milestone.id}
            className="plan-stage"
            data-status={milestone.status}
            data-open={open}
            data-current={index === currentIndex}
            data-stage-id={milestone.id}
          >
            {hasDetail ? (
              <button
                type="button"
                className="plan-stage-row"
                aria-expanded={open}
                aria-controls={detailId}
                aria-current={index === currentIndex ? "step" : undefined}
                onClick={() => onToggle(milestone.id)}
              >
                {content}
              </button>
            ) : (
              <div
                className="plan-stage-row"
                aria-current={index === currentIndex ? "step" : undefined}
              >
                {content}
              </div>
            )}
            {hasDetail ? (
              <div id={detailId} className="plan-detail" inert={!open}>
                <div className="plan-detail-clip">
                  {mounted.has(milestone.id) ? (
                    <div className="plan-detail-body">
                      {groups.length > 0 ? (
                        <div className="plan-operations" data-stage-operations={milestone.id}>
                          <GroupedToolChips
                            groups={groups}
                            onOpenFile={onOpenFile}
                            uiText={uiText}
                          />
                        </div>
                      ) : null}
                      {extra}
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
