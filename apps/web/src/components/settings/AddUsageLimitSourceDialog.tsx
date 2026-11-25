import type {
  EnvironmentId,
  SecretReference,
  UnifiedSettings,
  UsageLimitSourceKind,
} from "@t3tools/contracts";
import { T, useGT, Var } from "gt-react";
import { useId, useState } from "react";

import { useUpdateEnvironmentSettings } from "../../hooks/useSettings";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { sourceIdFromUrl } from "./AddUsageLimitSourceDialog.logic";
import { SecretSourceInput, useSecretSources } from "./SecretSourceInput";
import { Label } from "../ui/label";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { useUiText } from "~/i18n/useUiText";

/** Send the management key once to server secret storage; settings retain only a redaction marker. */
export function AddUsageLimitSourceDialog({
  open,
  onOpenChange,
  environmentId,
  environmentLabel,
  sources,
  kind: mode = "cliproxy",
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
  readonly kind?: "cliproxy" | "http";
  readonly sources: UnifiedSettings["usageLimitSources"];
}) {
  const gt = useGT();
  const uiText = useUiText();
  const formId = useId();
  // The HTTP mode is chosen by the caller; a hub is either CLIProxyAPI or a Sub2API relay.
  const [hubKind, setHubKind] = useState<"cliproxy" | "sub2api">("cliproxy");
  const kind: UsageLimitSourceKind = mode === "http" ? "http" : hubKind;
  const sub2api = kind === "sub2api";
  const updateSettings = useUpdateEnvironmentSettings(environmentId);
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const secretSources = useSecretSources(environmentId);
  const [keyDraft, setKeyDraft] = useState<string | SecretReference>("");
  const [keyValid, setKeyValid] = useState(true);
  const managementKey = typeof keyDraft === "string" ? keyDraft.trim() : keyDraft;
  const trimmedUrl = url.trim();
  const http = kind === "http";
  const endpoint = URL.parse(trimmedUrl);
  const canSave =
    keyValid &&
    (http
      ? endpoint !== null &&
        /^https?:$/.test(endpoint.protocol) &&
        !endpoint.username &&
        !endpoint.password
      : trimmedUrl.length > 0 && managementKey !== "");

  const reset = () => {
    setHubKind("cliproxy");
    setLabel("");
    setUrl("");
    setKeyDraft("");
    setKeyValid(true);
  };

  const save = () => {
    if (!canSave) return;
    const id = sourceIdFromUrl(trimmedUrl, sources, kind);
    updateSettings({
      usageLimitSources: {
        [id]: {
          kind,
          ...(label.trim() ? { label: label.trim() } : {}),
          url: trimmedUrl,
          managementKey,
          enabled: true,
        },
      },
    });
    reset();
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {http ? (
              <T>Add an HTTP quota source</T>
            ) : sub2api ? (
              uiText("Add a Sub2API relay")
            ) : (
              <T>Add a CLIProxyAPI hub</T>
            )}
          </DialogTitle>
          <DialogDescription>
            {http ? (
              <T>
                Read quotas from an endpoint on <Var>{environmentLabel}</Var>.
              </T>
            ) : (
              <T>
                Show the quota of every account the hub pools, next to the providers on{" "}
                <Var>{environmentLabel}</Var>. The key stays on that server.
              </T>
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <form
            id={formId}
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              save();
            }}
          >
            {http ? null : (
              <ToggleGroup
                aria-label={uiText("Hub type")}
                variant="segmented"
                value={[hubKind]}
                onValueChange={(next) => {
                  const value = next[0];
                  if (value === "cliproxy" || value === "sub2api") setHubKind(value);
                }}
              >
                <Toggle value="cliproxy">CLIProxyAPI</Toggle>
                <Toggle value="sub2api">Sub2API</Toggle>
              </ToggleGroup>
            )}
            <div className="grid gap-1.5">
              <Label htmlFor="usage-source-url">
                {http ? <T>Endpoint URL</T> : <T>Hub URL</T>}
              </Label>
              <Input
                id="usage-source-url"
                placeholder={
                  sub2api ? "https://relay.example.com" : "https://hub.example.ts.net:8318"
                }
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                autoFocus
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="usage-source-key">
                {http ? (
                  <T>Bearer token (optional)</T>
                ) : sub2api ? (
                  uiText("Admin API key")
                ) : (
                  <T>Management key</T>
                )}
              </Label>
              <SecretSourceInput
                id="usage-source-key"
                aria-label={
                  http
                    ? gt("Bearer token (optional)")
                    : sub2api
                      ? uiText("Admin API key")
                      : gt("Management key")
                }
                value={keyDraft}
                sources={secretSources}
                environmentId={environmentId}
                onChange={(event) => setKeyDraft(event.target.value)}
                onSecretChange={(secret) => setKeyDraft(secret ?? "")}
                onValidityChange={setKeyValid}
              />
              {sub2api ? (
                <p className="text-xs text-muted-foreground">
                  {uiText(
                    "In the Sub2API admin panel, open Settings and copy the admin API key. It reads the 5-hour and weekly usage of the Claude accounts the relay uses.",
                  )}
                </p>
              ) : null}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="usage-source-label">
                <T>Label (optional)</T>
              </Label>
              <Input
                id="usage-source-label"
                placeholder={gt("Defaults to the hub's host name")}
                value={label}
                onChange={(event) => setLabel(event.target.value)}
              />
            </div>
          </form>
        </DialogPanel>
        <DialogFooter variant="bare">
          <Button
            variant="outline"
            onClick={() => {
              reset();
              onOpenChange(false);
            }}
          >
            <T>Cancel</T>
          </Button>
          <Button type="submit" form={formId} disabled={!canSave}>
            {http ? <T>Add source</T> : <T>Add hub</T>}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
