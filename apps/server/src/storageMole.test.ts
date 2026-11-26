// @effect-diagnostics nodeBuiltinImport:off - only disposable read-only scan fixtures; no deletion calls.
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeOS from "node:os";
import { expect, it } from "vite-plus/test";
import {
  assertVolumeBudget,
  cleanupRoots,
  cleanupStagingDir,
  scanCleanup,
  inspectCleanupTree,
  type CleanupRoots,
} from "./storageMole.ts";
import * as DateTime from "effect/DateTime";
import * as HostProcess from "@t3tools/shared/HostProcess";
const GIB = 1024 ** 3;
const now = () => DateTime.toEpochMillis(DateTime.nowUnsafe());
async function fixture() {
  const dir = await NodeFSP.realpath(
    await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "c60-scan-")),
  );
  const roots: CleanupRoots = {
    home: NodePath.join(dir, "home"),
    applications: NodePath.join(dir, "Applications"),
    staging: NodePath.join(dir, "staging"),
    activeSource: NodePath.join(dir, "staging/current/source"),
    systemCaches: NodePath.join(dir, "system-cache"),
  };
  return { dir, roots };
}
async function file(p: string, age = 20) {
  await NodeFSP.mkdir(NodePath.dirname(p), { recursive: true });
  await NodeFSP.writeFile(p, "fixture");
  const epoch = (now() - age * 86400_000) / 1000;
  await NodeFSP.utimes(p, epoch, epoch);
}
// These scan the macOS locations; a Windows host scans storageMoleWindows' list instead.
const windowsHost = HostProcess.Platform.defaultValue() === "win32";
const volume = (p: string, free = 50) => ({
  id: p,
  name: p,
  path: p,
  freeBytes: free * GIB,
  reserveGiB: 40,
});

it("rejects links, hard links, changed descendants and incomplete scan budgets", async () => {
  const { dir } = await fixture();
  const root = NodePath.join(dir, "tree");
  await file(NodePath.join(root, "data"));
  const before = await inspectCleanupTree(root, now() + 10000);
  await file(NodePath.join(root, "changed"), 0);
  expect((await inspectCleanupTree(root, now() + 10000)).fingerprint).not.toBe(before.fingerprint);
  await expect(inspectCleanupTree(root, now() - 1)).rejects.toThrow("预算");
  await expect(inspectCleanupTree(root, now() + 10000, 1)).rejects.toThrow("过大");
  const linked = NodePath.join(dir, "link");
  // A folder link on Windows is a junction, which needs no elevation; elsewhere this is a symlink.
  await NodeFSP.symlink(root, linked, "junction");
  await expect(inspectCleanupTree(linked, now() + 10000)).rejects.toThrow("链接");
  await NodeFSP.link(NodePath.join(root, "data"), NodePath.join(root, "hard"));
  await expect(inspectCleanupTree(root, now() + 10000)).rejects.toThrow("链接");
});
it.skipIf(windowsHost)(
  "offers only allowlisted old caches by default and locks rollback generations and source trees",
  async () => {
    const { roots, dir } = await fixture();
    await file(NodePath.join(roots.home, "Library/Caches/Homebrew/old.zip"));
    await file(NodePath.join(roots.home, "Library/Caches/Homebrew/recent.zip"), 0);
    await file(NodePath.join(roots.home, "Library/Caches/unknown/data"));
    await file(NodePath.join(roots.home, "Downloads/archive.dmg"));
    await file(NodePath.join(roots.home, "Downloads/customer.png"));
    for (const version of [1, 2, 3]) {
      const app = NodePath.join(roots.applications, `T3 Code (Alpha).before-C${version}.app`);
      await file(NodePath.join(app, "payload"));
      await NodeFSP.utimes(app, version * 86400, version * 86400);
    }
    for (const version of [1, 2, 3])
      await file(NodePath.join(roots.staging, `c${version}.tar.zst`), 30 - version);
    await file(NodePath.join(roots.staging, "old-candidate/source/code.ts"));
    const phases: string[] = [];
    const result = await scanCleanup(roots, [volume(dir)], (p) => phases.push(p.phase));
    expect(result.entries.find((e) => e.name === "Homebrew 下载缓存")).toMatchObject({
      path: NodePath.join(roots.home, "Library/Caches/Homebrew"),
      risk: "caution",
      locked: false,
      destination: "delete-rebuildable",
      rebuildable: true,
    });
    expect(result.entries.some((e) => ["old.zip", "recent.zip"].includes(e.name))).toBe(false);
    expect(result.entries.find((e) => e.name === "Homebrew 下载缓存")?.childPaths).toHaveLength(2);
    expect(result.entries.find((e) => e.name === "unknown")?.locked).toBe(true);
    expect(result.entries.find((e) => e.name === "customer.png")?.locked).toBe(true);
    expect(result.entries.find((e) => e.name === "archive.dmg")).toMatchObject({
      locked: false,
      destination: "trash",
      rebuildable: false,
    });
    const rollback = result.entries.filter((e) => e.category === "rollback-apps");
    expect(rollback.filter((e) => e.locked).map((e) => e.name)).toEqual([
      "T3 Code (Alpha).before-C3.app",
      "T3 Code (Alpha).before-C2.app",
    ]);
    expect(result.entries.filter((e) => e.category === "cold-backups" && e.locked)).toHaveLength(2);
    expect(result.entries.find((e) => e.name === "old-candidate")?.locked).toBe(true);
    expect(phases[0]).toBe("scanning");
    expect(phases.at(-1)).toBe("completed");
  },
);
it("enforces every volume without crediting predicted deletion or trash bytes", () => {
  expect(() => assertVolumeBudget([])).toThrow();
  expect(() => assertVolumeBudget([volume("/", 41), volume("/external", 39)])).toThrow();
  expect(() => assertVolumeBudget([volume("/", 41)], { "/": 2 * GIB })).toThrow();
  expect(() => assertVolumeBudget([{ ...volume("/", 41), reserveGiB: 45 }])).toThrow();
  expect(() => assertVolumeBudget([{ ...volume("/", 39), reserveGiB: 1 }])).toThrow();
  expect(() => assertVolumeBudget([volume("/", 40), volume("/external", 40)])).not.toThrow();
});

it.skipIf(windowsHost)(
  "keeps explicit C59 and C62 rollback anchors despite changed dates and reports locked sizes",
  async () => {
    const { roots, dir } = await fixture();
    for (const version of [48, 55, 59, 62]) {
      const app = NodePath.join(roots.applications, `T3 Code (Alpha).before-C${version}.app`);
      await file(NodePath.join(app, "payload"));
      await NodeFSP.utimes(app, (100 - version) * 86400, (100 - version) * 86400);
    }
    const result = await scanCleanup(roots, [volume(dir)]);
    for (const version of [59, 62])
      expect(result.entries.find((e) => e.name.includes(`C${version}.app`))).toMatchObject({
        locked: true,
        canRelease: false,
        risk: "confirm",
      });
    expect(result.entries.find((e) => e.name.includes("C62.app"))?.bytes).toBeGreaterThan(0);
  },
);

it.skipIf(windowsHost)(
  "unlocks only a sealed superseded candidate with matching installed receipts and keeps the current chain",
  async () => {
    const { roots, dir } = await fixture();
    const generation = NodePath.join(roots.staging, "c41-old");
    const app = NodePath.join(generation, "candidate/T3.app");
    const oldAsar = NodePath.join(app, "Contents/Resources/app.asar");
    await file(oldAsar);
    const currentAsar = NodePath.join(
      roots.applications,
      "T3 Code (Alpha).app/Contents/Resources/app.asar",
    );
    await file(currentAsar);
    await NodeFSP.writeFile(currentAsar, "current release");
    const sha = async (p: string) =>
      NodeCrypto.createHash("sha256")
        .update(await NodeFSP.readFile(p))
        .digest("hex");
    const json = async (p: string, data: object) => {
      await file(p);
      await NodeFSP.writeFile(p, JSON.stringify(data));
    };
    await json(NodePath.join(generation, "candidate.json"), {
      candidate: app,
      candidateAsar: await sha(oldAsar),
      signatureVerified: true,
      allPackedMembersVerified: 5,
    });
    const evidence = NodePath.join(roots.home, ".t3/scratch/task");
    await json(NodePath.join(evidence, "c41-install/installation.json"), {
      installed: true,
      actualAsar: await sha(oldAsar),
      backupLocation: NodePath.join(generation, "installation"),
      rollbackApp: NodePath.join(roots.applications, "T3 Code (Alpha).before-C41.app"),
    });
    await json(NodePath.join(evidence, "c59-install/installation.json"), {
      installed: true,
      status: "installed_verified",
      actualAsar: await sha(currentAsar),
      rollbackApp: NodePath.join(roots.applications, "T3 Code (Alpha).before-C59.app"),
    });
    await file(NodePath.join(generation, "tmp/data"));
    const scan = () => scanCleanup(roots, [volume(dir)]);
    const first = await scan();
    expect(
      first.entries.find((e) => e.path === NodePath.join(generation, "candidate")),
    ).toMatchObject({ locked: false, risk: "confirm", destination: "trash" });
    expect(
      first.entries.find((e) => e.path === NodePath.join(generation, "candidate"))?.cleanupEvidence,
    ).toHaveLength(3);
    expect(first.entries.find((e) => e.name === "tmp")?.locked).toBe(true);
    await NodeFSP.writeFile(oldAsar, "changed candidate");
    expect((await scan()).entries.find((e) => e.name === "candidate")?.locked).toBe(true);
    await NodeFSP.writeFile(oldAsar, "fixture");
    await file(NodePath.join(generation, "installation/cold-backup.tar.zst"));
    expect((await scan()).entries.find((e) => e.name === "candidate")?.locked).toBe(true);
  },
);

it("has no staging directory unless T3_CLEANUP_STAGING_DIR names an absolute one", () => {
  expect(cleanupStagingDir({})).toBe("");
  expect(cleanupStagingDir({ T3_CLEANUP_STAGING_DIR: "  " })).toBe("");
  expect(cleanupStagingDir({ T3_CLEANUP_STAGING_DIR: "relative/dir" })).toBe("");
  expect(cleanupStagingDir({ T3_CLEANUP_STAGING_DIR: "/tmp/t3-staging/../t3-staging" })).toBe(
    NodePath.resolve("/tmp/t3-staging"),
  );
  // The default roots carry no author-specific location.
  expect(cleanupRoots().staging).toBe(cleanupStagingDir());
});
it.skipIf(windowsHost)(
  "scans without a staging directory and offers no staging-based cleanup",
  async () => {
    const { roots, dir } = await fixture();
    await file(NodePath.join(roots.home, "Library/Caches/Homebrew/old.zip"));
    const result = await scanCleanup({ ...roots, staging: "" }, [volume(dir)]);
    expect(result.entries.some((entry) => entry.name === "Homebrew 下载缓存")).toBe(true);
    expect(result.entries.some((entry) => /c\d+\.tar\.zst|old-candidate/.test(entry.path))).toBe(
      false,
    );
  },
);
