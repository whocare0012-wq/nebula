import { readUiLocale } from "~/i18n";
import { chineseDuration } from "~/i18n/conversationLabel";
import { useUiText } from "~/i18n/useUiText";
import { useId, useState } from "react";
import { ChevronDownIcon, ChevronRightIcon, CheckIcon } from "lucide-react";

import type { TaskProgressSnapshot } from "../../taskProgress";

import { cn } from "~/lib/utils";
import { Tooltip, TooltipTrigger, TooltipPopup } from "../ui/tooltip";

export const taskProgressStateLabels: Record<TaskProgressSnapshot["state"], string> = {
  loading: "Loading steps…",
  empty: "No plan reported",
  running: "In progress",
  waiting: "Waiting",
  approval: "Waiting for approval",
  input: "Waiting for your answer",
  stopped: "Stopped",
  failed: "Needs attention",
  complete: "Plan complete",
  incomplete: "Steps unfinished",
  queued: "Queued",
};

export function progressTone(progress: TaskProgressSnapshot) {
  if (progress.stale) return "text-muted-foreground";
  switch (progress.state) {
    case "approval":
    case "input":
      return "text-warning";
    case "failed":
      return "text-destructive";
    case "complete":
      return "text-success";
    case "running":
      return "text-primary";
    default:
      return "text-muted-foreground";
  }
}

function shortStepDuration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

export function formatStepDuration(ms: number): string {
  const value = shortStepDuration(ms);
  return readUiLocale() === "zh-CN" ? chineseDuration(value) : value;
}

export function TaskProgressSteps({
  progress,
  compact = false,
  defaultExpanded = true,
}: {
  progress: TaskProgressSnapshot;
  compact?: boolean;
  defaultExpanded?: boolean;
}) {
  const uiText = useUiText();
  const [expanded, setExpanded] = useState(defaultExpanded);
  const listId = useId();
  const current = progress.steps.findIndex((step) => step.status === "running");
  const next = progress.steps.findIndex((step) => step.status === "pending");
  const anchor = current >= 0 ? current : Math.max(0, next);
  const start = compact ? Math.max(0, Math.min(anchor - 1, progress.steps.length - 5)) : 0;
  const shown = compact ? progress.steps.slice(start, start + 5) : progress.steps;
  const after = progress.total - start - shown.length;
  const tone = progressTone(progress);
  const label = uiText(
    progress.stale ? "Status may be out of date" : taskProgressStateLabels[progress.state],
  );
  return (
    <section
      aria-label={uiText("Task progress")}
      className={cn("min-w-0", compact ? "text-3xs" : "text-xs")}
    >
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={listId}
        onClick={() => setExpanded(!expanded)}
        className="flex w-full min-w-0 items-center gap-1.5 rounded-sm py-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        {expanded ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />}
        <span className="font-medium">{uiText("Task steps")}</span>
        <span className="ml-auto tabular-nums text-muted-foreground">
          {progress.total > 0
            ? uiText("{completed}/{total} completed", {
                completed: progress.completed,
                total: progress.total,
              })
            : null}
        </span>
      </button>
      <div className="flex justify-between gap-2 pb-2 pl-4.5">
        <span className={tone}>{label}</span>
        {progress.remaining > 0 ? (
          <span className="text-muted-foreground">
            {uiText("{count} remaining (including current)", { count: progress.remaining })}
          </span>
        ) : null}
      </div>
      <div id={listId} hidden={!expanded}>
        {shown.length === 0 ? (
          <p className="pl-4.5 text-muted-foreground">
            {uiText(
              progress.state === "loading"
                ? "Waiting for task details."
                : "No steps reported for this turn.",
            )}
          </p>
        ) : (
          <ol aria-label={uiText("Reported task steps")}>
            {start > 0 ? (
              <li className="pb-2 pl-4.5 text-muted-foreground">
                {uiText("{count} earlier steps", { count: start })}
              </li>
            ) : null}
            {shown.map((step) => {
              const running = step.status === "running";
              const text = (
                <p
                  dir="auto"
                  className={cn(
                    "wrap-anywhere leading-relaxed",
                    compact && "line-clamp-2",
                    running ? "font-medium text-foreground" : "text-muted-foreground",
                  )}
                >
                  {step.text}
                </p>
              );
              return (
                <li
                  key={step.id}
                  className="flex min-w-0 gap-2 pb-3 last:pb-1"
                  aria-current={running ? "step" : undefined}
                >
                  <span
                    className={cn(
                      "flex size-3.5 shrink-0 items-center justify-center",
                      running ? tone : "text-muted-foreground",
                    )}
                  >
                    {step.status === "completed" ? (
                      <CheckIcon size={12} />
                    ) : (
                      <span className="size-1.5 rounded-full bg-current" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    {compact ? (
                      <Tooltip>
                        <TooltipTrigger render={text} />
                        <TooltipPopup side="right">{step.text}</TooltipPopup>
                      </Tooltip>
                    ) : (
                      text
                    )}
                    <p
                      className={cn(
                        compact ? "sr-only" : "mt-0.5 text-3xs",
                        running ? tone : "text-muted-foreground",
                      )}
                    >
                      {step.status === "completed"
                        ? uiText("Completed")
                        : running
                          ? label
                          : uiText("Not started")}
                    </p>
                  </div>
                </li>
              );
            })}
            {after > 0 ? (
              <li className="pl-5.5 text-muted-foreground">
                {uiText("{count} later steps", { count: after })}
              </li>
            ) : null}
          </ol>
        )}
        {!compact && progress.state === "incomplete" ? (
          <p className="mt-2 text-muted-foreground">
            {uiText("This turn ended with unfinished steps.")}
          </p>
        ) : null}
      </div>
    </section>
  );
}
