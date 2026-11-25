import { uiText } from "~/i18n";
import { Switch } from "../ui/switch";

import type { EnvironmentId, UnifiedSettings } from "@t3tools/contracts";
import { T, useGT, Var } from "gt-react";
import { PlusIcon } from "lucide-react";
import { useState } from "react";

import { useUpdateEnvironmentSettings } from "../../hooks/useSettings";
import { useServerConfigs } from "../../state/entities";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";
import { AddUsageLimitSourceDialog } from "./AddUsageLimitSourceDialog";
import { useSearchableSetting } from "./settingsSearch";
import { SettingsRow, SettingsSection } from "./settingsLayout";

const CLI_PROXY_NAME = "CLI Proxy";

export function UsageProviderSettings({
  environmentId,
  environmentLabel,
  sources,
  cursorKeychainUsageEnabled,
  readOnly,
}: {
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
  readonly sources: UnifiedSettings["usageLimitSources"];
  readonly readOnly: boolean;
  readonly cursorKeychainUsageEnabled: boolean;
}) {
  const gt = useGT();
  const searchableSetting = useSearchableSetting();
  const updateSettings = useUpdateEnvironmentSettings(environmentId);
  const [adding, setAdding] = useState<"cliproxy" | "http" | null>(null);
  // Only macOS servers read this setting; elsewhere Cursor usage comes from its auth file.
  const keychainSetting =
    useServerConfigs().get(environmentId)?.environment.platform.os === "darwin";
  const entries = Object.entries(sources);

  return (
    <>
      <SettingsSection
        {...searchableSetting("usage-providers")}
        headerAction={
          !readOnly ? (
            <div className="flex gap-2">
              <Button size="xs" variant="outline" onClick={() => setAdding("cliproxy")}>
                <PlusIcon className="size-3" aria-hidden />
                <T>Add hub</T>
              </Button>
              <Button size="xs" variant="outline" onClick={() => setAdding("http")}>
                <PlusIcon className="size-3" aria-hidden />
                <T>Add HTTP source</T>
              </Button>
            </div>
          ) : null
        }
      >
        {keychainSetting ? (
          <SettingsRow
            title={uiText("Read Cursor account usage")}
            description={uiText(
              "Uses your existing Cursor CLI sign-in from the macOS Keychain to show usage and monthly limits. macOS may ask for permission.",
            )}
            control={
              <Switch
                checked={cursorKeychainUsageEnabled}
                disabled={readOnly}
                onCheckedChange={(enabled) =>
                  updateSettings({ cursorKeychainUsageEnabled: enabled })
                }
                aria-label={uiText("Read Cursor account usage")}
              />
            }
          />
        ) : null}
        {entries.length === 0 ? (
          <SettingsRow title={gt("No usage sources configured.")} />
        ) : (
          entries.map(([id, source]) => {
            const kindLabel =
              source.kind === "http"
                ? gt("HTTP quota source")
                : source.kind === "sub2api"
                  ? "Sub2API"
                  : CLI_PROXY_NAME;
            const label = source.label?.trim() || source.url;
            return (
              <SettingsRow
                key={id}
                title={label}
                description={
                  <span className="break-all">
                    {source.enabled ? kindLabel : gt("{name} · Disabled", { name: kindLabel })}
                    {label !== source.url ? ` · ${source.url}` : ""}
                  </span>
                }
                control={
                  !readOnly ? (
                    <RemoveUsageProviderButton
                      label={label}
                      onConfirm={() => updateSettings({ usageLimitSources: { [id]: null } })}
                    />
                  ) : null
                }
              />
            );
          })
        )}
      </SettingsSection>
      {adding && !readOnly ? (
        <AddUsageLimitSourceDialog
          open
          kind={adding}
          onOpenChange={(open) => {
            if (!open) setAdding(null);
          }}
          environmentId={environmentId}
          environmentLabel={environmentLabel}
          sources={sources}
        />
      ) : null}
    </>
  );
}

function RemoveUsageProviderButton({
  label,
  onConfirm,
}: {
  readonly label: string;
  readonly onConfirm: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="xs" variant="ghost" onClick={() => setOpen(true)}>
        <T>Remove</T>
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>
              <T>
                Remove <Var>{label}</Var>?
              </T>
            </AlertDialogTitle>
            <AlertDialogDescription>
              <T>The saved connection and its credentials are removed from this environment.</T>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>
              <T>Cancel</T>
            </AlertDialogClose>
            <Button
              variant={"destructive"}
              onClick={() => {
                setOpen(false);
                onConfirm();
              }}
            >
              <T>Remove</T>
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </>
  );
}
