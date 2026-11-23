import { InfoIcon } from "lucide-react";
import { useUiText } from "~/i18n/useUiText";
import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { useServerConfigs } from "../../state/entities";
import { Button, InlineButton } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";

export function CursorUsageHint() {
  const uiText = useUiText();
  const { copyToClipboard, isCopied } = useCopyToClipboard();
  // The Keychain setting is read on macOS servers only; elsewhere Cursor's auth file is used.
  const keychainSetting = [...useServerConfigs().values()].some(
    (config) => config?.environment.platform.os === "darwin",
  );
  return (
    <div
      data-usage-card
      className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"
    >
      <InfoIcon className="size-4 text-primary" aria-hidden />
      <span className="flex-1">
        {uiText("Cursor quota is unavailable · Sign in to Cursor CLI on its environment")}
        {keychainSetting ? (
          <span> · {uiText("Enable Read Cursor account usage in Settings → Providers.")}</span>
        ) : null}
      </span>
      <Popover>
        <PopoverTrigger render={<InlineButton />}>{uiText("Sign in")}</PopoverTrigger>
        <PopoverPopup className="max-w-sm">
          <p className="mb-3 text-xs">
            {uiText(
              "Run this command in your own terminal, then refresh usage. T3 will not run a login command for you.",
            )}
          </p>
          <code className="mb-3 block rounded-lg bg-muted p-2 text-xs">agent login</code>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              copyToClipboard("agent login", undefined);
            }}
          >
            {uiText(isCopied ? "Copied" : "Copy command")}
          </Button>
        </PopoverPopup>
      </Popover>
    </div>
  );
}
