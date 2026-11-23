import type { ScopedThreadRef } from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import {
  AlarmClockIcon,
  ArchiveIcon,
  CheckIcon,
  EllipsisIcon,
  MailIcon,
  SquareIcon,
  Trash2Icon,
  Undo2Icon,
} from "lucide-react";
import { type MouseEvent as ReactMouseEvent, type ReactNode, useState } from "react";
import { useClientSettings } from "../../hooks/useSettings";
import { useThreadActions } from "../../hooks/useThreadActions";
import { uiText } from "../../i18n";
import { useUiText } from "../../i18n/useUiText";
import { cn } from "../../lib/utils";
import { readLocalApi } from "../../localApi";
import { threadEnvironment } from "../../state/threads";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import { pickSnoozePreset, resolveSnoozePresets } from "../Sidebar.snooze";
import { Menu, MenuItem, MenuItemDetail, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/**
 * V12 hover actions for the "needs my attention" and "working" lists: finish, stop or open a
 * thread without visiting it first. `finished` rows are cleared by `onDone` (seen / acknowledged).
 */
export type InboxQuickMode = "finished" | "needs-you" | "running" | "done";

function reportFailure(title: string, result: AtomCommandResult<unknown, unknown>) {
  if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return;
  const error = squashAtomCommandFailure(result);
  toastManager.add(
    stackedThreadToast({
      type: "error",
      title,
      description: error instanceof Error ? error.message : uiText("An error occurred."),
    }),
  );
}

export function InboxQuickActions(props: {
  mode: InboxQuickMode;
  threadRef: ScopedThreadRef;
  title: string;
  doneLabel?: string | undefined;
  onDone?: (() => void) | undefined;
  onRestore?: (() => void) | undefined;
  onOpen: () => void;
}) {
  const text = useUiText();
  const { mode, threadRef } = props;
  const { archiveThread, confirmAndDeleteThread, markThreadUnread, snoozeThread } =
    useThreadActions();
  const confirmArchive = useClientSettings((settings) => settings.confirmThreadArchive);
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  const interruptTurn = useOrchestrationCommand(threadEnvironment.interruptTurn, {
    reportFailure: false,
  });
  const [menuOpen, setMenuOpen] = useState(false);
  const presets = menuOpen
    ? // oxlint-disable-next-line react/purity -- Presets are resolved only while the menu is open, so each opening reads a fresh time.
      resolveSnoozePresets(new Date(), timestampFormat, threadRef.environmentId)
    : [];

  const stop = (event: ReactMouseEvent) => {
    event.stopPropagation();
    void (async () => {
      const result = await interruptTurn({
        environmentId: threadRef.environmentId,
        input: { threadId: threadRef.threadId },
      });
      if (result._tag === "Failure") reportFailure(text("Failed to stop thread"), result);
    })();
  };
  const archive = () => {
    void (async () => {
      if (confirmArchive) {
        const api = readLocalApi();
        if (!api) return;
        const confirmed = await api.dialogs.confirm(
          text("Archive thread “{title}”?", { title: props.title }),
        );
        if (!confirmed) return;
      }
      const result = await archiveThread(threadRef);
      if (result._tag === "Failure") reportFailure(text("Failed to archive thread"), result);
    })();
  };
  const snooze = (presetId: string) => {
    const picked = pickSnoozePreset(presets, presetId, timestampFormat, threadRef.environmentId);
    if (!picked) return;
    void (async () => {
      const result = await snoozeThread(threadRef, picked.snoozedUntil);
      if (result._tag === "Failure") reportFailure(text("Failed to snooze thread"), result);
    })();
  };
  const remove = () => {
    void (async () => {
      const result = await confirmAndDeleteThread(threadRef);
      if (result._tag === "Failure") reportFailure(text("Failed to delete thread"), result);
    })();
  };

  const iconButton = (
    key: string,
    label: string,
    icon: ReactNode,
    onClick: (event: ReactMouseEvent) => void,
    tone?: "done" | "stop",
  ) => (
    <Tooltip key={key}>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={label}
            data-inbox-quick-action={key}
            onClick={(event) => {
              event.stopPropagation();
              onClick(event);
            }}
            className={cn(
              "inline-flex size-5.5 shrink-0 cursor-pointer items-center justify-center rounded-md text-sidebar-muted-foreground outline-none transition-colors hover:bg-foreground/8 hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
              tone === "done" && "hover:bg-success/12 hover:text-success-foreground",
              tone === "stop" &&
                "text-destructive-foreground/80 hover:bg-destructive/10 hover:text-destructive-foreground",
            )}
          />
        }
      >
        {icon}
      </TooltipTrigger>
      <TooltipPopup side="top">{label}</TooltipPopup>
    </Tooltip>
  );

  return (
    <span
      data-inbox-quick-actions={mode}
      className={cn(
        // V14: sits in the space the title line gives up on hover (see WorkbenchInbox), never over text.
        "pointer-events-none absolute top-1.5 right-1.5 flex h-5 items-center gap-px opacity-0 transition-opacity motion-reduce:transition-none",
        "group-hover/inbox-row:pointer-events-auto group-hover/inbox-row:opacity-100 has-[:focus-visible]:pointer-events-auto has-[:focus-visible]:opacity-100",
        menuOpen && "pointer-events-auto opacity-100",
      )}
    >
      {mode === "running" ? (
        iconButton(
          "stop",
          text("Stop"),
          <SquareIcon className="size-3 fill-current" />,
          stop,
          "stop",
        )
      ) : mode === "needs-you" ? (
        <button
          type="button"
          data-inbox-quick-action="open"
          onClick={(event) => {
            event.stopPropagation();
            props.onOpen();
          }}
          className="inline-flex h-5.5 shrink-0 cursor-pointer items-center rounded-md px-1.5 text-xs font-medium text-warning-foreground outline-none hover:bg-warning/12 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          {text("Handle")}
        </button>
      ) : mode === "done" ? (
        props.onRestore ? (
          iconButton("restore", text("Restore"), <Undo2Icon className="size-3.5" />, () =>
            props.onRestore?.(),
          )
        ) : null
      ) : props.onDone ? (
        iconButton(
          "done",
          props.doneLabel ?? text("Mark done"),
          <CheckIcon className="size-3.5" />,
          () => props.onDone?.(),
          "done",
        )
      ) : null}
      {mode === "finished" || mode === "done"
        ? iconButton("archive", text("Archive"), <ArchiveIcon className="size-3.5" />, archive)
        : null}
      <Menu open={menuOpen} onOpenChange={setMenuOpen}>
        <Tooltip>
          <TooltipTrigger
            render={
              <MenuTrigger
                render={
                  <button
                    type="button"
                    aria-label={text("More")}
                    data-inbox-quick-action="more"
                    onClick={(event) => event.stopPropagation()}
                    className="inline-flex size-5.5 shrink-0 cursor-pointer items-center justify-center rounded-md text-sidebar-muted-foreground outline-none transition-colors hover:bg-foreground/8 hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  />
                }
              />
            }
          >
            <EllipsisIcon className="size-3.5" />
          </TooltipTrigger>
          <TooltipPopup side="top">{text("More")}</TooltipPopup>
        </Tooltip>
        <MenuPopup side="bottom" align="end">
          {presets.map((preset) => (
            <MenuItem key={preset.id} onClick={() => snooze(preset.id)}>
              <AlarmClockIcon />
              {text(preset.label)}
              <MenuItemDetail>{preset.whenLabel}</MenuItemDetail>
            </MenuItem>
          ))}
          {presets.length > 0 ? <MenuSeparator /> : null}
          <MenuItem onClick={() => markThreadUnread(threadRef)}>
            <MailIcon />
            {text("Mark unread")}
          </MenuItem>
          {mode !== "running" ? (
            <MenuItem onClick={archive}>
              <ArchiveIcon />
              {text("Archive")}
            </MenuItem>
          ) : null}
          <MenuSeparator />
          <MenuItem variant="destructive" onClick={remove}>
            <Trash2Icon />
            {text("Delete…")}
          </MenuItem>
        </MenuPopup>
      </Menu>
    </span>
  );
}

export type InboxStatus = "running" | "needs-you" | "result" | "failed" | "done";

const STATUS_DOT: Record<InboxStatus, string> = {
  running: "bg-info",
  "needs-you": "bg-warning",
  result: "bg-warning",
  failed: "bg-destructive",
  done: "bg-success",
};

/**
 * V14: the row's status dot is a button. It lists the task states; the current one is checked.
 * "In progress" follows the agent and cannot be picked by hand, and a pending request has to be
 * answered before the task can be marked done.
 */
export function InboxStatusDot(props: {
  status: InboxStatus;
  threadRef: ScopedThreadRef;
  onMarkDone?: (() => void) | undefined;
  onMarkTodo?: (() => void) | undefined;
}) {
  const text = useUiText();
  const { snoozeThread } = useThreadActions();
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  const [open, setOpen] = useState(false);
  const presets = open
    ? // oxlint-disable-next-line react/purity -- Presets are resolved only while the menu is open, so each opening reads a fresh time.
      resolveSnoozePresets(new Date(), timestampFormat, props.threadRef.environmentId)
    : [];
  const snooze = (presetId: string) => {
    const picked = pickSnoozePreset(
      presets,
      presetId,
      timestampFormat,
      props.threadRef.environmentId,
    );
    if (!picked) return;
    void (async () => {
      const result = await snoozeThread(props.threadRef, picked.snoozedUntil);
      if (result._tag === "Failure") reportFailure(text("Failed to snooze thread"), result);
    })();
  };
  const current = props.status;
  const isTodo = current === "needs-you" || current === "result" || current === "failed";
  const mark = (on: boolean, afterDetail = false) => (
    <span
      aria-hidden
      className={cn(
        "inline-flex",
        afterDetail ? "ms-2" : "ms-auto",
        on ? "opacity-100" : "opacity-0",
      )}
    >
      <CheckIcon className="size-3.5" />
    </span>
  );
  return (
    <Menu open={open} onOpenChange={setOpen}>
      <MenuTrigger
        render={
          <button
            type="button"
            aria-label={text("Change task status")}
            data-inbox-status={current}
            onClick={(event) => event.stopPropagation()}
            className="group/status-dot absolute top-1.5 left-0.5 z-10 grid size-5 cursor-pointer place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          />
        }
      >
        <span
          aria-hidden
          className={cn(
            "size-1.5 rounded-full transition-[box-shadow,transform] group-hover/status-dot:scale-125 group-hover/status-dot:ring-3 group-hover/status-dot:ring-current/20",
            STATUS_DOT[current],
            current === "done"
              ? "text-success"
              : current === "running"
                ? "text-primary"
                : "text-warning",
          )}
        />
      </MenuTrigger>
      <MenuPopup side="bottom" align="start">
        <MenuItem disabled>
          <span aria-hidden className="size-2 rounded-full bg-info" />
          {text("In progress")}
          <MenuItemDetail>{text("Follows the agent")}</MenuItemDetail>
          {mark(current === "running", true)}
        </MenuItem>
        <MenuItem disabled={isTodo || !props.onMarkTodo} onClick={() => props.onMarkTodo?.()}>
          <span aria-hidden className="size-2 rounded-full bg-warning" />
          {text("Needs me")}
          {mark(isTodo)}
        </MenuItem>
        <MenuItem
          disabled={current === "done" || current === "needs-you" || !props.onMarkDone}
          onClick={() => props.onMarkDone?.()}
        >
          <span aria-hidden className="size-2 rounded-full bg-success" />
          {text("Done")}
          {current === "needs-you" ? (
            <MenuItemDetail>{text("Answer the request first")}</MenuItemDetail>
          ) : null}
          {mark(current === "done", current === "needs-you")}
        </MenuItem>
        {presets.length > 0 ? <MenuSeparator /> : null}
        {presets.map((preset) => (
          <MenuItem key={preset.id} onClick={() => snooze(preset.id)}>
            <AlarmClockIcon />
            {text("Remind me: {when}", { when: text(preset.label) })}
            <MenuItemDetail>{preset.whenLabel}</MenuItemDetail>
          </MenuItem>
        ))}
      </MenuPopup>
    </Menu>
  );
}
