import { ProviderDriverKind, ProviderInstanceId, type ModelSelection } from "@t3tools/contracts";
import { useState } from "react";
import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import "~/index.css";

import { render } from "../../../test/render";
import { deriveProviderInstanceEntries } from "../../providerInstances";
import { ProviderModelPicker } from "./ProviderModelPicker";

const REMEMBERED_ACCOUNTS_KEY = "t3code:model-picker:accounts:v1";
const NOW = Date.parse("2026-11-05T12:00:00Z");

// Both windows match, so whichever window the picker prefers shows the same remaining share.
const limits = (usedPercent: number) => ({
  checkedAt: new Date(NOW).toISOString(),
  windows: (["session", "weekly"] as const).map((kind) => ({
    id: kind,
    kind,
    label: kind === "session" ? "5h" : "Week",
    usedPercent,
    resetsAt: new Date(NOW + 86_400_000).toISOString(),
  })),
});

const provider = (id: string, driver: string, displayName: string, usedPercent?: number) => ({
  instanceId: ProviderInstanceId.make(id),
  driver: ProviderDriverKind.make(driver),
  displayName,
  enabled: true,
  installed: true,
  version: null,
  status: "ready" as const,
  auth: { status: "authenticated" as const },
  checkedAt: "2026-01-01T00:00:00.000Z",
  models: [],
  slashCommands: [],
  skills: [],
  ...(usedPercent === undefined ? {} : { usageLimits: limits(usedPercent) }),
});

it("shows several accounts of one provider as one tab with an account row", async () => {
  localStorage.removeItem(REMEMBERED_ACCOUNTS_KEY);
  // Quota counts as current only next to the time it was checked.
  vi.setSystemTime(NOW);
  await using _restore = {
    async [Symbol.asyncDispose]() {
      vi.useRealTimers();
      localStorage.removeItem(REMEMBERED_ACCOUNTS_KEY);
    },
  };
  const entries = deriveProviderInstanceEntries([
    provider("codex", "codex", "ChatGPT - home", 28),
    provider("claudeAgent", "claudeAgent", "Claude"),
    provider("codex_work", "codex", "ChatGPT - work", 90),
  ]);
  const gpt = [{ slug: "gpt-a", name: "GPT A" }];
  const options = new Map([
    [ProviderInstanceId.make("codex"), gpt],
    [ProviderInstanceId.make("codex_work"), gpt],
    [ProviderInstanceId.make("claudeAgent"), [{ slug: "sonnet", name: "Sonnet" }]],
  ]);
  const picks: Array<ModelSelection> = [];

  function Picker() {
    const [selection, setSelection] = useState<ModelSelection>({
      instanceId: ProviderInstanceId.make("claudeAgent"),
      model: "sonnet",
    });
    return (
      <ProviderModelPicker
        environmentId={null}
        activeInstanceId={selection.instanceId}
        model={selection.model}
        lockedProvider={null}
        instanceEntries={entries}
        modelOptionsByInstance={options}
        triggerAriaLabel="Choose model"
        onInstanceModelChange={(instanceId, model) => {
          picks.push({ instanceId, model });
          setSelection({ instanceId, model });
        }}
      />
    );
  }

  await using screen = await render(<Picker />);
  await screen.getByRole("button", { name: "Choose model" }).click();
  const providers = page.getByRole("toolbar", { name: "Providers" });
  await expect.element(providers.getByRole("button", { name: "Codex", exact: true })).toBeVisible();
  await expect
    .element(providers.getByRole("button", { name: "ChatGPT - work", exact: true }))
    .not.toBeInTheDocument();
  await expect.element(page.getByRole("toolbar", { name: "Accounts" })).not.toBeInTheDocument();

  // "All" lists the provider's models once, not once per account.
  await providers.getByRole("button", { name: "All", exact: true }).click();
  expect(page.getByRole("option", { name: /GPT A/ }).elements()).toHaveLength(1);

  await providers.getByRole("button", { name: "Codex", exact: true }).click();
  const accounts = page.getByRole("toolbar", { name: "Accounts" });
  const home = accounts.getByRole("button", { name: "ChatGPT - home, 72% left", exact: true });
  const work = accounts.getByRole("button", { name: "ChatGPT - work, 10% left", exact: true });
  await expect.element(home).toHaveAttribute("aria-pressed", "true");
  await work.click();
  await expect.element(work).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("option", { name: /GPT A/ }).click();
  expect(picks.at(-1)).toEqual({ instanceId: "codex_work", model: "gpt-a" });
  expect(JSON.parse(localStorage.getItem(REMEMBERED_ACCOUNTS_KEY) ?? "{}")).toEqual({
    codex: "codex_work",
  });
});
