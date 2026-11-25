// @effect-diagnostics nodeBuiltinImport:off - disposable fixture folders stand in for a Windows profile.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { describe, expect, it } from "vite-plus/test";
import { cleanupRoots, scanCleanup } from "./storageMole.ts";
import type { WindowsCleanupRoots } from "./storageMoleWindows.ts";
import { makeWindowsStorageWorker } from "./storageWindows.ts";

const GIB = 1024 ** 3;
// The allowlist is made of Windows profile paths; elsewhere they don't exist.
const windowsHost = HostProcess.Platform.defaultValue() === "win32";

async function fixture() {
  const dir = await NodeFSP.realpath(
    await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "nebula-clean-")),
  );
  const home = NodePath.join(dir, "home");
  const roots: WindowsCleanupRoots = {
    home,
    localAppData: NodePath.join(home, "AppData", "Local"),
    downloads: NodePath.join(home, "Downloads"),
    temp: NodePath.join(dir, "temp"),
    windowsDir: NodePath.join(dir, "Windows"),
  };
  const write = async (p: string) => {
    await NodeFSP.mkdir(NodePath.dirname(p), { recursive: true });
    await NodeFSP.writeFile(p, "fixture".repeat(10_000));
  };
  await write(NodePath.join(roots.localAppData, "demo-updater", "installer.exe"));
  await write(NodePath.join(roots.localAppData, "pnpm", "store", "v10", "index"));
  await write(NodePath.join(roots.downloads, "setup.msi"));
  const recycled: string[] = [];
  const worker = makeWindowsStorageWorker({
    roots,
    statfs: async () => ({ bavail: 100 * GIB, bsize: 1, blocks: 200 * GIB }),
    recycle: async (p) => {
      recycled.push(p);
      await NodeFSP.rm(p, { recursive: true });
    },
  });
  const base = NodePath.join(dir, ".nebula");
  const root = NodePath.parse(dir).root;
  const volumes = [{ id: "c", name: "C:", path: root, freeBytes: 100 * GIB, reserveGiB: 40 }];
  const scan = async () => (await scanCleanup(cleanupRoots(roots), volumes)).entries;
  // Mirrors StorageManagement: each step gets a candidate from a fresh scan.
  const run = async (input: Record<string, unknown>, id?: string) =>
    worker.call({
      ...input,
      base,
      ...(id ? { cleanupCandidate: (await scan()).find((entry) => entry.id === id) } : {}),
    }) as Promise<Record<string, unknown>>;
  return { roots, scan, run, recycled };
}

describe.skipIf(!windowsHost)("Windows storage cleanup", () => {
  it("deletes a rebuildable updater cache, recycles an installer, and only lists shared stores", async () => {
    const { roots, scan, run, recycled } = await fixture();
    const entries = await scan();
    const updater = entries.find((entry) => entry.name === "demo 更新安装包")!;
    const installer = entries.find((entry) => entry.name === "setup.msi")!;
    expect(updater).toMatchObject({ destination: "delete-rebuildable", canRelease: true });
    expect(installer).toMatchObject({ destination: "trash", canRelease: true });
    expect(entries.find((entry) => entry.path.endsWith("store"))).toMatchObject({ locked: true });

    for (const entry of [updater, installer]) {
      const plan = await run({ action: "cleanup-plan" }, entry.id);
      await run({ action: "queue", planId: plan.id }, entry.id);
      const done = await run({ action: "execute", planId: plan.id }, entry.id);
      expect(done.phase).toBe(entry === updater ? "completed" : "trashed");
    }
    await expect(NodeFSP.stat(updater.path)).rejects.toThrow();
    expect(recycled).toEqual([installer.path]);
    await expect(
      NodeFSP.stat(NodePath.join(roots.localAppData, "pnpm", "store")),
    ).resolves.toBeDefined();
  });

  it("keeps a folder whose file is open or whose contents changed after the preview", async () => {
    const { roots, run, scan } = await fixture();
    const updater = (await scan()).find((entry) => entry.name === "demo 更新安装包")!;
    const plan = await run({ action: "cleanup-plan" }, updater.id);
    const handle = await NodeFSP.open(NodePath.join(updater.path, "installer.exe"), "r");
    try {
      const busy = await run({ action: "execute", planId: plan.id }, updater.id);
      expect(busy).toMatchObject({ phase: "failed", error: expect.stringContaining("占用") });
    } finally {
      await handle.close();
    }
    const changed = await run({ action: "cleanup-plan" }, updater.id);
    await NodeFSP.writeFile(
      NodePath.join(roots.localAppData, "demo-updater", "new.exe"),
      "x".repeat(10_000),
    );
    await expect(run({ action: "queue", planId: changed.id }, updater.id)).rejects.toThrow("预览");
    await expect(NodeFSP.stat(updater.path)).resolves.toBeDefined();
  });

  it("refuses archive actions it can't perform on Windows", async () => {
    const { run } = await fixture();
    await expect(run({ action: "plan", objectId: "x" })).rejects.toThrow("Windows");
  });
});
