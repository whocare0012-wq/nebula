// @effect-diagnostics nodeBuiltinImport:off - bounded read-only host filesystem inventory.
import * as DateTime from "effect/DateTime";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeOS from "node:os";
import * as NodeCrypto from "node:crypto";
import type { StorageInspection } from "@t3tools/contracts";

type Entry = StorageInspection["entries"][number];
export type CleanupRoots = {
  home: string;
  applications: string;
  staging: string;
  activeSource: string;
  systemCaches: string;
};
// Optional directory of old build generations and cold backups to inventory. Unset (the default
// for everyone but the maintainer's build machine) means no staging area: that part of the
// inventory is simply empty and the archive worker offers no staging-based cleanup.
export const cleanupStagingDir = (env: NodeJS.ProcessEnv = process.env): string => {
  const configured = env.T3_CLEANUP_STAGING_DIR?.trim();
  return configured && NodePath.isAbsolute(configured) ? NodePath.resolve(configured) : "";
};
export const cleanupRoots = (): CleanupRoots => ({
  home: NodeOS.homedir(),
  applications: "/Applications",
  staging: cleanupStagingDir(),
  activeSource: NodePath.resolve(import.meta.dirname, "../../.."),
  systemCaches: "/Library/Caches",
});
const cleanupId = (p: string) =>
  "cleanup-" + NodeCrypto.createHash("sha256").update(p).digest("hex");
const DAY = 86400_000;
const GIB = 1024 ** 3;
const inside = (p: string, root: string) => {
  const rel = NodePath.relative(root, p);
  return (
    rel !== "" && rel !== ".." && !rel.startsWith(".." + NodePath.sep) && !NodePath.isAbsolute(rel)
  );
};

export type ScanProgress = {
  phase: "scanning" | "completed";
  checked: number;
  total: number;
  current: string;
  truncated: boolean;
};
type Target = {
  path: string;
  category: string;
  rebuildable: boolean;
  locked: boolean;
  reason: string;
  risk: "safe" | "caution" | "confirm";
  name?: string;
  cleanupEvidence?: Entry["cleanupEvidence"];
};
const namesAt = async (p: string) => {
  try {
    return (await NodeFSP.readdir(p)).toSorted().slice(0, 240);
  } catch {
    return [];
  }
};

// Measurements fail closed on links, special files, hard links, mount boundaries or budgets.
export async function inspectCleanupTree(
  target: string,
  deadline: number,
  maxNodes = 20_000,
  allowLinks = false,
) {
  const root = await NodeFSP.lstat(target);
  if ((await NodeFSP.realpath(target)) !== target || root.isSymbolicLink())
    throw new Error("路径含链接");
  let bytes = 0,
    latest = root.mtimeMs,
    count = 0;
  const pending = [target];
  const childBytes = new Map<string, number>();
  const hash = NodeCrypto.createHash("sha256");
  while (pending.length) {
    if (DateTime.toEpochMillis(DateTime.nowUnsafe()) > deadline || ++count > maxNodes)
      throw new Error("扫描达到预算，保留原件");
    const p = pending.pop()!;
    const st = await NodeFSP.lstat(p);
    if (
      (!allowLinks && st.isSymbolicLink()) ||
      st.dev !== root.dev ||
      (!st.isFile() && !st.isDirectory() && !(allowLinks && st.isSymbolicLink())) ||
      (st.isFile() && st.nlink !== 1)
    )
      throw new Error("包含链接、跨卷或特殊文件，保留原件");
    if (process.getuid && st.uid !== process.getuid()) throw new Error("非当前用户所有，保留原件");
    latest = Math.max(latest, st.mtimeMs);
    bytes += st.blocks * 512;
    const child = NodePath.relative(target, p).split(NodePath.sep)[0];
    if (child) childBytes.set(child, (childBytes.get(child) ?? 0) + st.blocks * 512);
    hash.update(JSON.stringify([p, st.dev, st.ino, st.size, st.mtimeMs, st.ctimeMs]));
    if (st.isDirectory()) {
      const children = await NodeFSP.readdir(p);
      if (children.length + count > maxNodes) throw new Error("目录过大，保留原件");
      for (const name of children.toSorted()) pending.push(NodePath.join(p, name));
    }
  }
  return {
    bytes,
    latest,
    fingerprint: hash.digest("hex"),
    identity: [root.dev, root.ino],
    childPaths: [...childBytes]
      .filter(([, bytes]) => bytes > 0)
      .toSorted((a, b) => b[1] - a[1])
      .slice(0, 50)
      .map(([name]) => NodePath.join(target, name)),
  };
}

function rollbackGeneration(name: string) {
  return Number(name.match(/(?:before-|^)C(\d+)/i)?.[1] ?? 0);
}
async function readEvidence(path: string) {
  try {
    const st = await NodeFSP.lstat(path);
    if (
      !st.isFile() ||
      st.isSymbolicLink() ||
      st.size > 2_000_000 ||
      (await NodeFSP.realpath(path)) !== path
    )
      return undefined;
    const text = await NodeFSP.readFile(path, "utf8");
    const data: unknown = JSON.parse(text);
    if (!data || typeof data !== "object" || Array.isArray(data)) return undefined;
    return {
      path,
      sha256: NodeCrypto.createHash("sha256").update(text).digest("hex"),
      data: data as Record<string, unknown>,
    };
  } catch {
    return undefined;
  }
}
async function fileSha(path: string, deadline: number) {
  try {
    const before = await NodeFSP.lstat(path);
    if (!before.isFile() || (await NodeFSP.realpath(path)) !== path) return undefined;
    const hash = NodeCrypto.createHash("sha256");
    for await (const chunk of NodeFS.createReadStream(path)) {
      if (DateTime.toEpochMillis(DateTime.nowUnsafe()) > deadline) return undefined;
      hash.update(chunk);
    }
    const after = await NodeFSP.lstat(path);
    return before.ino === after.ino &&
      before.size === after.size &&
      before.mtimeMs === after.mtimeMs
      ? hash.digest("hex")
      : undefined;
  } catch {
    return undefined;
  }
}
async function installationReceipts(roots: CleanupRoots, deadline: number) {
  const receipts: Array<NonNullable<Awaited<ReturnType<typeof readEvidence>>>> = [];
  const scratch = NodePath.join(roots.home, ".t3/scratch");
  for (const name of (await namesAt(scratch)).reverse()) {
    if (DateTime.toEpochMillis(DateTime.nowUnsafe()) > deadline) break;
    const task = NodePath.join(scratch, name);
    for (const install of (await namesAt(task)).filter((n) => /^c\d+-install$/.test(n))) {
      const receipt = await readEvidence(NodePath.join(task, install, "installation.json"));
      if (receipt) receipts.push(receipt);
    }
  }
  return receipts;
}

async function targetsFor(roots: CleanupRoots, deadline: number): Promise<Target[]> {
  const targets: Target[] = [];
  const add = (
    p: string,
    category: string,
    rebuildable: boolean,
    locked = false,
    reason = "可重建缓存；执行前检查占用和内容变化",
    risk: Target["risk"] = rebuildable ? "safe" : "caution",
  ) => {
    const target: Target = { path: p, category, rebuildable, locked, reason, risk };
    targets.push(target);
    return target;
  };
  for (const [relative, name] of [
    [".npm/_cacache", "npm 下载缓存"],
    [".cache/pip", "pip 下载缓存"],
    ["Library/Caches/pip", "pip 下载缓存（Library）"],
    ["Library/Caches/Homebrew", "Homebrew 下载缓存"],
    ["Library/Caches/Yarn", "Yarn 下载缓存"],
    ["Library/Developer/Xcode/DerivedData", "Xcode DerivedData"],
  ] as const)
    add(NodePath.join(roots.home, relative), "developer-cache", true).name = name;
  // Content-addressed pnpm stores can back live hard links; never delete them by age.
  for (const relative of [
    "Library/pnpm/store",
    ".local/share/pnpm/store",
    "Library/Developer/CoreSimulator",
    ".Trash",
  ])
    add(
      NodePath.join(roots.home, relative),
      relative === ".Trash" ? "trash" : "developer-cache",
      false,
      true,
      "共享依赖、模拟器或废纸篓：仅展示，不自动移除",
    );
  for (const [relative, name] of [
    ["Library/Caches/Google/Chrome", "Chrome 浏览器缓存"],
    ["Library/Caches/com.apple.Safari", "Safari 浏览器缓存"],
    ["Library/Caches/Firefox", "Firefox 浏览器缓存"],
  ] as const)
    add(
      NodePath.join(roots.home, relative),
      "browser-cache",
      true,
      false,
      "仅浏览器缓存；运行或占用时拒绝，登录资料不纳入扫描",
    ).name = name;
  for (const relative of ["Library/Caches/ms-playwright", ".cache/huggingface"])
    add(
      NodePath.join(roots.home, relative),
      "developer-cache",
      false,
      true,
      "模型及浏览器运行依赖，需核对正在使用的任务",
    );
  const known = new Set([
    "Google",
    "com.apple.Safari",
    "Firefox",
    "pip",
    "Homebrew",
    "Yarn",
    "ms-playwright",
  ]);
  for (const name of await namesAt(NodePath.join(roots.home, "Library/Caches")))
    if (!known.has(name))
      add(
        NodePath.join(roots.home, "Library/Caches", name),
        "user-cache",
        false,
        true,
        "未知软件缓存，未加入可清理白名单",
      );
  add(roots.systemCaches, "system-cache", false, true, "系统缓存受保护；不提权、不清理");
  for (const name of await namesAt(NodePath.join(roots.home, "Library/Logs")))
    add(
      NodePath.join(roots.home, "Library/Logs", name),
      "logs",
      false,
      false,
      "旧诊断日志移入废纸篓，不直接删除",
    );
  for (const name of await namesAt(NodePath.join(roots.home, "Downloads"))) {
    const installer = /\.(dmg|pkg|xip)$/i.test(name);
    add(
      NodePath.join(roots.home, "Downloads", name),
      installer ? "installers" : "large-old-files",
      false,
      !installer,
      installer ? "安装包需手动确认；仅移入废纸篓" : "下载资料仅分析，不根据大小或日期自动清理",
    );
  }
  const rollback = (await namesAt(roots.applications)).filter((n) =>
    /^T3 Code \(Alpha\)\.before-.+\.app$/.test(n),
  );
  const sorted = await Promise.all(
    rollback.map(async (n) => ({
      n,
      m: (await NodeFSP.lstat(NodePath.join(roots.applications, n))).mtimeMs,
    })),
  );
  sorted.sort(
    (a, b) =>
      rollbackGeneration(b.n) - rollbackGeneration(a.n) || b.m - a.m || b.n.localeCompare(a.n),
  );
  for (const [i, { n }] of sorted.entries())
    add(
      NodePath.join(roots.applications, n),
      "rollback-apps",
      false,
      i < 2 || /before-C(?:59|62)\.app$/.test(n),
      i < 2 || /before-C(?:59|62)\.app$/.test(n)
        ? "保留最新两份及当前回滚链锚点"
        : "超出最近两份回滚保留数；移入废纸篓",
      "confirm",
    );
  add(
    NodePath.join(roots.applications, "T3 Code (Alpha).app"),
    "protected",
    false,
    true,
    "当前安装版本",
  );
  const stagingNames = roots.staging ? await namesAt(roots.staging) : [];
  const staged = await Promise.all(
    stagingNames.map(async (n) => ({
      n,
      m: (await NodeFSP.lstat(NodePath.join(roots.staging, n))).mtimeMs,
    })),
  );
  const nestedCold: Array<{ n: string; m: number }> = [];
  for (const { n } of staged.filter(({ n }) => /^c\d+/i.test(n)).slice(0, 60)) {
    for (const filename of await namesAt(NodePath.join(roots.staging, n, "installation")))
      if (filename.endsWith(".tar.zst")) {
        const relative = NodePath.join(n, "installation", filename);
        nestedCold.push({
          n: relative,
          m: (await NodeFSP.lstat(NodePath.join(roots.staging, relative))).mtimeMs,
        });
      }
  }
  const cold = [...staged.filter(({ n }) => n.endsWith(".tar.zst")), ...nestedCold].sort(
    (a, b) => b.m - a.m,
  );
  for (const [i, { n }] of cold.entries())
    add(
      NodePath.join(roots.staging, n),
      "cold-backups",
      false,
      i < 2,
      i < 2 ? "最近两份冷备加锁" : "预览及执行时完整读取校验最新两份冷备后，旧备份仅进废纸篓",
      "confirm",
    );
  for (const { n } of cold)
    if (n.endsWith(".tar.zst"))
      add(
        NodePath.join(roots.staging, n.slice(0, -8) + ".json"),
        "protected",
        false,
        true,
        "冷备校验回执；与归档一同保留",
      );
  const receipts = await installationReceipts(roots, deadline);
  const current = receipts
    .filter((r) => r.data.status === "installed_verified")
    .toSorted(
      (a, b) =>
        rollbackGeneration(String(b.data.rollbackApp)) -
        rollbackGeneration(String(a.data.rollbackApp)),
    )[0];
  const currentMatches =
    current &&
    (await fileSha(
      NodePath.join(roots.applications, "T3 Code (Alpha).app/Contents/Resources/app.asar"),
      deadline,
    )) === current.data.actualAsar;
  const retainedGenerations = cold
    .slice(0, 2)
    .map((r) =>
      rollbackGeneration(
        NodePath.basename(NodePath.dirname(NodePath.dirname(NodePath.join(roots.staging, r.n)))),
      ),
    );
  for (const { n } of staged.filter(({ n }) => /^c\d+/i.test(n)).slice(0, 60)) {
    const generation = NodePath.join(roots.staging, n);
    const manifest = await readEvidence(NodePath.join(generation, "candidate.json"));
    const ownReceipt = receipts.find(
      (r) =>
        r.data.backupLocation === NodePath.join(generation, "installation") &&
        r.data.installed === true &&
        r.data.actualAsar === manifest?.data.candidateAsar,
    );
    const oldGeneration = rollbackGeneration(n);
    const superseded =
      currentMatches &&
      current &&
      current.data.installed === true &&
      ownReceipt &&
      manifest &&
      current.data.actualAsar !== ownReceipt.data.actualAsar &&
      oldGeneration < rollbackGeneration(String(current.data.rollbackApp)) &&
      !retainedGenerations.includes(oldGeneration);
    for (const relative of [
      ...(await namesAt(generation)).filter((name) =>
        /^(?:candidate(?:[-_].*)?|package-stage|tmp)$/.test(name),
      ),
      "restore-verification",
      "installation/restore-verification",
    ]) {
      const p = NodePath.join(generation, relative);
      if (!(await NodeFSP.lstat(p).catch(() => undefined))?.isDirectory()) continue;
      const candidateApp =
        typeof manifest?.data.candidate === "string" ? manifest.data.candidate : "";
      const isSealedCandidate =
        relative.startsWith("candidate") &&
        inside(candidateApp, p) &&
        manifest?.data.signatureVerified === true &&
        Number(manifest.data.allPackedMembersVerified) > 0;
      const proof =
        superseded &&
        isSealedCandidate &&
        (await fileSha(NodePath.join(candidateApp, "Contents/Resources/app.asar"), deadline)) ===
          manifest.data.candidateAsar;
      const target = add(
        p,
        "old-builds",
        false,
        !proof,
        proof
          ? "候选签名/封装清单及安装回执匹配；已有更新已验收版本，保留当前回滚链后逐项确认"
          : "缺少已被取代且无引用的完整证据，保留",
        "confirm",
      );
      if (proof)
        target.cleanupEvidence = [manifest, ownReceipt, current].map((r) => ({
          path: r.path,
          sha256: r.sha256,
        }));
    }
  }
  for (const { n } of staged.filter(
    ({ n }) =>
      /candidate|staging|restore-verification/i.test(n) &&
      !/^c\d+/i.test(n) &&
      !n.endsWith(".tar.zst"),
  ))
    add(
      NodePath.join(roots.staging, n),
      "old-builds",
      false,
      true,
      "缺少完整的安装替代与引用证据，保留",
      "confirm",
    );
  // Analyze bounded project artifacts; shared/live projects need a reference audit, not a name match.
  for (const { n } of staged.filter(({ n }) => /^c\d+/i.test(n)).slice(0, 40)) {
    const p = NodePath.join(roots.staging, n);
    for (const artifact of ["node_modules", "build", "dist"])
      add(
        NodePath.join(p, artifact),
        "project-artifacts",
        true,
        true,
        "可重建产物；缺少任务引用审查，暂不开放释放",
      );
  }
  // Useful objects first; locked generic caches must not consume the bounded scan budget.
  const priority = (target: Target) =>
    [
      "developer-cache",
      "rollback-apps",
      "cold-backups",
      "protected",
      "old-builds",
      "browser-cache",
    ].indexOf(target.category);
  return targets.toSorted(
    (a, b) => (priority(a) < 0 ? 99 : priority(a)) - (priority(b) < 0 ? 99 : priority(b)),
  );
}

export async function scanCleanup(
  roots: CleanupRoots,
  volumeRows: StorageInspection["volumes"],
  onProgress: (p: ScanProgress) => void = () => {},
  budgetMs = 15_000,
) {
  const deadline = DateTime.toEpochMillis(DateTime.nowUnsafe()) + budgetMs;
  const targets = await targetsFor(roots, deadline);
  const entries: Entry[] = [];
  let truncated = targets.length >= 240,
    checked = 0;
  for (const target of targets) {
    if (DateTime.toEpochMillis(DateTime.nowUnsafe()) > deadline) {
      truncated = true;
      break;
    }
    onProgress({
      phase: "scanning",
      checked,
      total: targets.length,
      current: target.category,
      truncated,
    });
    checked++;
    let st;
    try {
      st = await NodeFSP.lstat(target.path);
    } catch {
      continue;
    }
    if (
      st.isSymbolicLink() ||
      (await NodeFSP.realpath(target.path).catch(() => "")) !== target.path
    )
      continue;
    let locked = target.locked,
      reason = target.reason,
      bytes: number | null = null,
      lastModified = st.mtimeMs;
    let childPaths: string[] | undefined;
    if (
      !locked ||
      ["rollback-apps", "cold-backups", "protected", "old-builds"].includes(target.category)
    ) {
      try {
        const measured = await inspectCleanupTree(
          target.path,
          Math.min(deadline, DateTime.toEpochMillis(DateTime.nowUnsafe()) + 2000),
          40_000,
          !target.rebuildable,
        );
        bytes = measured.bytes;
        if (target.name) childPaths = measured.childPaths;
        lastModified = measured.latest;
      } catch (error) {
        locked = true;
        reason += "；" + (error instanceof Error ? error.message : "无法完整扫描");
      }
    }
    if (bytes === 0) continue;
    const recent = lastModified > DateTime.toEpochMillis(DateTime.nowUnsafe()) - 7 * DAY;
    if (recent && !locked) reason += "；7天内有改动，需手动确认";
    const volume = volumeRows
      .filter((v) => target.path === v.path || inside(target.path, v.path))
      .toSorted((a, b) => b.path.length - a.path.length)[0];
    const destination = target.rebuildable ? "delete-rebuildable" : "trash";
    entries.push({
      id: cleanupId(target.path),
      name: target.name ?? NodePath.basename(target.path),
      path: target.path,
      kind: target.rebuildable ? "cache" : target.category,
      category: target.category,
      risk: recent && target.risk === "safe" ? "caution" : target.risk,
      destination,
      reason,
      ...(childPaths ? { childPaths } : {}),
      ...(target.cleanupEvidence ? { cleanupEvidence: target.cleanupEvidence } : {}),
      lastModified: DateTime.formatIso(DateTime.makeUnsafe(lastModified)),
      modifiedAt: DateTime.formatIso(DateTime.makeUnsafe(lastModified)),
      rebuildable: target.rebuildable,
      locked,
      canRelease: !locked,
      canArchive: false,
      canExpand: false,
      bytes,
      ...(volume ? { volumePath: volume.path } : {}),
    });
  }
  onProgress({ phase: "completed", checked, total: targets.length, current: "", truncated });
  return { entries, truncated };
}

export function assertVolumeBudget(
  volumes: StorageInspection["volumes"],
  needed: Readonly<Record<string, number>> = {},
) {
  if (!volumes.length) throw new Error("没有可信卷容量，拒绝执行");
  for (const v of volumes)
    if (v.freeBytes - (needed[v.path] ?? 0) < Math.max(40, v.reserveGiB ?? 40) * GIB)
      throw new Error(`${v.name} 执行后会低于保护线，拒绝执行`);
}
