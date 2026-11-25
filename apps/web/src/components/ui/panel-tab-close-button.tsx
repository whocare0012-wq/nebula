import { X } from "lucide-react";
import type { ReactNode } from "react";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { isMacPlatform } from "~/lib/utils";

interface PanelTabCloseButtonProps {
  children: ReactNode;
  label: string;
  onClick: () => void;
  tooltip?: string;
}

export function PanelTabCloseButton({
  children,
  label,
  onClick,
  tooltip,
}: PanelTabCloseButtonProps) {
  // macOS swaps the tab icon for the close mark; Windows and Linux close from the tab's far end.
  const trailing = !isMacPlatform(navigator.platform);
  const button = trailing ? (
    <button
      type="button"
      className="cursor-pointer order-last flex size-4 shrink-0 items-center justify-center rounded-sm opacity-0 hover:bg-muted focus-visible:opacity-100 group-hover/tab:opacity-100 group-data-[active-tab=true]/tab:opacity-100"
      aria-label={label}
      onClick={onClick}
    >
      <X className="size-3" />
    </button>
  ) : (
    <button
      type="button"
      className="cursor-pointer group/close relative flex size-4 shrink-0 items-center justify-center rounded-sm hover:bg-muted"
      aria-label={label}
      onClick={onClick}
    >
      <span className="relative flex size-3 items-center justify-center group-hover/tab:hidden group-focus-visible/close:hidden">
        {children}
      </span>
      <X className="hidden size-3 group-hover/tab:block group-focus-visible/close:block" />
    </button>
  );
  const control = tooltip ? (
    <Tooltip>
      <TooltipTrigger render={button} />
      <TooltipPopup>{tooltip}</TooltipPopup>
    </Tooltip>
  ) : (
    button
  );

  if (!trailing) return control;

  return (
    <>
      <span className="relative flex size-4 shrink-0 items-center justify-center">{children}</span>
      {control}
    </>
  );
}
