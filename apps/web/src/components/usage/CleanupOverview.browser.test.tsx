import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import "~/index.css";
import { render } from "../../../test/render";
import { CleanupOverview } from "./CleanupOverview";
import type { StorageEntry } from "./storageInventoryModel";

const MB = 1_000_000;
const entry = (name: string, options: Partial<StorageEntry>): StorageEntry => ({
  id: name,
  name,
  path: `C:/Users/me/Downloads/${name}`,
  kind: "installers",
  category: "installers",
  reason: "Review",
  bytes: 100 * MB,
  canRelease: true,
  canArchive: false,
  destination: "trash",
  risk: "caution",
  volumePath: "C:\\",
  ...options,
});

it("folds results into one row per kind and previews one or several selected items", async () => {
  const onPreview = vi.fn();
  const onPreviewBatch = vi.fn();
  const installers = Array.from({ length: 12 }, (_, i) => entry(`setup-${i}.exe`, {}));
  await using _screen = await render(
    <CleanupOverview
      windows
      data={{
        checkedAt: "2026-11-25T00:00:00Z",
        entries: [
          ...installers,
          entry("npm cache", {
            category: "developer-cache",
            kind: "cache",
            destination: "delete-rebuildable",
            rebuildable: true,
            bytes: 800 * MB,
          }),
          entry("tiny cache", {
            category: "developer-cache",
            kind: "cache",
            destination: "delete-rebuildable",
            rebuildable: true,
            bytes: 4_000,
          }),
          entry("pnpm store", { category: "developer-cache", locked: true, bytes: null }),
        ],
        archives: [],
        operations: [],
        volumes: [{ id: "c", name: "C:", path: "C:\\", freeBytes: 1e11, totalBytes: 5e11 }],
      }}
      allowed
      busy={false}
      scanning={false}
      volumeId=""
      onVolumeChange={() => {}}
      onScan={() => {}}
      onPreview={onPreview}
      onPreviewBatch={onPreviewBatch}
      onLogsPreview={() => {}}
      completed={undefined}
      previewPlan={null}
    />,
    { router: false },
  );
  const groups = [...document.querySelectorAll("details[data-risk]")] as HTMLDetailsElement[];
  expect(groups.map((g) => g.querySelector("summary")!.textContent)).toEqual([
    expect.stringContaining("12"),
    expect.stringContaining("npm cache"),
    expect.stringContaining("Protected · list only"),
  ]);
  expect(groups.every((g) => !g.open)).toBe(true);
  expect(document.body.textContent).not.toContain("tiny cache");

  groups[0]!.open = true;
  await expect.element(page.getByText("setup-7.exe")).toBeVisible();
  expect(page.getByText("setup-11.exe").query()).toBeNull();
  await page.getByRole("button", { name: "Show 4 more" }).click();
  await page.getByRole("checkbox", { name: "Select setup-11.exe" }).click();
  await page.getByRole("button", { name: "Preview cleanup" }).click();
  expect(onPreview).toHaveBeenCalledWith(expect.objectContaining({ id: "setup-11.exe" }));

  // A group checkbox selects the whole group without toggling the row open.
  await page.getByRole("checkbox", { name: "Select all in npm cache" }).click();
  expect(groups[1]!.open).toBe(false);
  await page.getByRole("button", { name: "Preview cleanup (2 items)" }).click();
  expect(onPreviewBatch).toHaveBeenLastCalledWith([
    expect.objectContaining({ id: "setup-11.exe" }),
    expect.objectContaining({ id: "npm cache" }),
  ]);
  await page.getByRole("checkbox", { name: "Select all in Downloaded installers" }).click();
  await page.getByRole("button", { name: "Preview cleanup (13 items)" }).click();
  expect(onPreviewBatch.mock.lastCall?.[0]).toHaveLength(13);
  expect(onPreview).toHaveBeenCalledOnce();
});
