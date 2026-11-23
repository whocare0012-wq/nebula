import { useUiText } from "~/i18n/useUiText";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import "./composerV9.css";

function V9PlusIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

/** V9 circular "+" attachment button; opens the composer's file picker (ComposerAttachInput). */
export function ComposerAttachButton({
  onOpenPicker,
  disabled = false,
}: {
  readonly onOpenPicker: () => void;
  readonly disabled?: boolean;
}) {
  const uiText = useUiText();
  const ariaLabel = uiText("Add attachment");
  const tooltipLabel = uiText("Upload file or image");

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            data-v9-sf-btn="attach"
            data-composer-attach-btn="true"
            disabled={disabled}
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => {
              if (!disabled) onOpenPicker();
            }}
            aria-label={ariaLabel}
          />
        }
      >
        <V9PlusIcon />
      </TooltipTrigger>
      <TooltipPopup side="top">{tooltipLabel}</TooltipPopup>
    </Tooltip>
  );
}
