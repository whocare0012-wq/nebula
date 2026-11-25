// @effect-diagnostics nodeBuiltinImport:off - Windows counterpart of the macOS archive worker: renames, deletes and Recycle Bin moves on allowlisted paths.
import * as DateTime from "effect/DateTime";
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import type { StorageInspection } from "@t3tools/contracts";
import { cleanupId, inspectCleanupTree, samePath } from "./storageMole.ts";
import { windowsCleanupTargets, type WindowsCleanupRoots } from "./storageMoleWindows.ts";

type Entry = StorageInspection["entries"][number];
type Volume = StorageInspection["volumes"][number];
type Plan = Record<string, unknown> & {
  id: string;
  type: string;
  phase: string;
  createdAt: string;
  error?: string;
};
type Request = {
  action?: string;
  base: string;
  planId?: string;
  objectId?: string;
  statusOnly?: boolean;
  measureSizes?: boolean;
  inventoryPaths?: { logs?: string; attachments?: string; database?: string };
  cleanupCandidate?: Entry;
};

const ACTIVE = ["started", "retirement_intent", "releasing"];
const PLAN_TTL_MS = 15 * 60_000;
const BUSY_CODES = new Set(["EPERM", "EBUSY", "EACCES"]);
const now = () => DateTime.toEpochMillis(DateTime.nowUnsafe());
const iso = (ms = now()) => DateTime.formatIso(DateTime.makeUnsafe(ms));

// SHFileOperation is synchronous and can run without UI; FOF_WANTNUKEWARNING asks before an item too
// large for the Recycle Bin would be destroyed instead of recycled.
const RECYCLE_SCRIPT = `$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public static class NebulaRecycle {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct Op { public IntPtr hwnd; public uint wFunc; public string pFrom; public string pTo; public ushort fFlags; public bool aborted; public IntPtr mappings; public string title; }
  [DllImport("shell32.dll", CharSet = CharSet.Unicode)] static extern int SHFileOperation(ref Op op);
  public static int Run(string path) {
    var op = new Op { wFunc = 3, pFrom = path + "\\0\\0", fFlags = 0x40 | 0x10 | 0x400 | 0x4 | 0x4000 };
    int result = SHFileOperation(ref op);
    return result != 0 ? result : (op.aborted ? 1223 : 0);
  }
}
'@
exit [NebulaRecycle]::Run($env:NEBULA_RECYCLE_PATH)`;
const ENCODED_RECYCLE_SCRIPT = Buffer.from(RECYCLE_SCRIPT, "utf16le").toString("base64");

export function makeWindowsStorageWorker(deps: {
  roots: WindowsCleanupRoots;
  statfs?: (path: string) => Promise<{ bavail: number; bsize: number; blocks: number }>;
  recycle?: (path: string) => Promise<void>;
}) {
  const statfs = deps.statfs ?? ((path: string) => NodeFSP.statfs(path));
  const recycle =
    deps.recycle ??
    ((path: string) =>
      new Promise<void>((resolve, reject) => {
        const systemRoot = deps.roots.windowsDir;
        NodeChildProcess.execFile(
          NodePath.join(systemRoot, "System32\\WindowsPowerShell\\v1.0\\powershell.exe"),
          ["-NoProfile", "-NonInteractive", "-EncodedCommand", ENCODED_RECYCLE_SCRIPT],
          {
            env: { ...process.env, NEBULA_RECYCLE_PATH: path },
            timeout: 600_000,
            windowsHide: true,
          },
          (error) => (error ? reject(new Error("未能移入回收站，原件保留")) : resolve()),
        );
      }));
  const running = new Set<string>();
  const locks = new Map<string, Promise<unknown>>();
  const sizeCache = new Map<string, { identity: string; at: number; bytes: number }>();

  const stateDir = (req: Request) => NodePath.join(req.base, "storage-management");
  const opFile = (req: Request, id: unknown) => {
    if (typeof id !== "string" || !/^[A-Za-z0-9-]{1,80}$/.test(id)) throw new Error("无效操作ID");
    return NodePath.join(stateDir(req), "operations", id + ".json");
  };
  const cancelFile = (req: Request, id: string) => NodePath.join(stateDir(req), "cancel", id);
  const exists = (p: string) =>
    NodeFSP.lstat(p).then(
      () => true,
      () => false,
    );
  const load = async (p: string): Promise<Plan | null> => {
    try {
      return JSON.parse(await NodeFSP.readFile(p, "utf8")) as Plan;
    } catch {
      return null;
    }
  };
  const save = async (req: Request, plan: Plan) => {
    const file = opFile(req, plan.id);
    await NodeFSP.mkdir(NodePath.dirname(file), { recursive: true });
    const tmp = `${file}.writing-${NodeCrypto.randomUUID()}`;
    await NodeFSP.writeFile(tmp, JSON.stringify(plan));
    await NodeFSP.rename(tmp, file);
  };
  const isCancelled = (req: Request, plan: Plan) => exists(cancelFile(req, plan.id));
  const freeBytes = async (p: string) => {
    const s = await statfs(NodePath.parse(p).root);
    return s.bavail * s.bsize;
  };

  const volumes = async (req: Request): Promise<Volume[]> => {
    const baseRoot = NodePath.parse(req.base).root.toUpperCase();
    const roots = [
      ...new Set(
        [req.base, deps.roots.home, deps.roots.localAppData].map((p) =>
          NodePath.parse(p).root.toUpperCase(),
        ),
      ),
    ];
    const rows: Volume[] = [];
    for (const root of roots) {
      try {
        const s = await statfs(root);
        rows.push({
          id: NodeCrypto.createHash("sha256").update(root).digest("hex"),
          name: `本地磁盘 (${root.replace(/\\$/, "")})`,
          path: root,
          freeBytes: s.bavail * s.bsize,
          totalBytes: s.blocks * s.bsize,
          internal: root === baseRoot,
        });
      } catch {
        // A drive that can't report capacity stays out of the list.
      }
    }
    return rows;
  };

  const operations = async (req: Request): Promise<Plan[]> => {
    const dir = NodePath.join(stateDir(req), "operations");
    const names = await NodeFSP.readdir(dir).catch(() => []);
    const plans = (
      await Promise.all(
        names.filter((n) => n.endsWith(".json")).map((n) => load(NodePath.join(dir, n))),
      )
    ).filter((plan): plan is Plan => plan !== null);
    const result = plans.toSorted((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 30);
    for (const op of result) {
      if (op.phase === "queued" && op.serverPid !== process.pid) {
        op.phase = "locked";
        op.error = "排队时的服务端已退出，不自动重新执行；请核对中断状态";
      }
      if (await isCancelled(req, op)) op.cancelRequested = true;
      if (ACTIVE.includes(op.phase) && !running.has(op.id)) {
        op.phase = "locked";
        op.error = "操作进程已退出或身份不明，请先核对源、暂存与回执；不会自动重试释放";
      }
    }
    return result;
  };

  const measure = async (p: string, deadline: number) => {
    const st = await NodeFSP.lstat(p);
    const identity = `${st.dev}:${st.ino}:${st.mtimeMs}:${st.size}`;
    const cached = sizeCache.get(p);
    if (cached?.identity === identity && now() - cached.at < 600_000) return cached.bytes;
    let bytes = 0;
    const pending = [p];
    while (pending.length) {
      if (now() > deadline) return undefined;
      const current = pending.pop()!;
      const s = await NodeFSP.lstat(current).catch(() => undefined);
      if (!s || s.dev !== st.dev) continue;
      bytes += s.blocks * 512;
      if (s.isDirectory() && !s.isSymbolicLink())
        for (const name of await NodeFSP.readdir(current).catch(() => []))
          pending.push(NodePath.join(current, name));
    }
    sizeCache.set(p, { identity, at: now(), bytes });
    return bytes;
  };

  const inventory = async (req: Request, volumeRows: Volume[]) => {
    const home = deps.roots.home;
    const codex = process.env.CODEX_HOME || NodePath.join(home, ".codex");
    const roaming = process.env.APPDATA || NodePath.join(home, "AppData", "Roaming");
    const paths = req.inventoryPaths ?? {};
    const rows: Array<[string, string, string]> = [
      [
        paths.logs ?? NodePath.join(req.base, "userdata", "logs"),
        "logs",
        "日志保留规则可在维护设置调整",
      ],
      [
        paths.attachments ?? NodePath.join(req.base, "userdata", "attachments"),
        "attachments",
        "聊天与交付资料，普通清理保留",
      ],
      [
        paths.database ?? NodePath.join(req.base, "userdata", "statev2.sqlite"),
        "database",
        "聊天与交付资料，普通清理保留",
      ],
      [NodePath.join(codex, "sessions"), "protected", "对话历史，普通清理保留"],
      [NodePath.join(home, ".claude", "projects"), "protected", "对话历史，普通清理保留"],
      [
        NodePath.join(deps.roots.localAppData, "claude-cli-nodejs"),
        "cache",
        "其他 AI 工具缓存；先核对所属软件，本工具不直接删除",
      ],
      ...["Cache", "Code Cache", "GPUCache"].map((name): [string, string, string] => [
        NodePath.join(roaming, "nebula", name),
        "cache",
        "星云浏览器缓存；运行中的缓存保留",
      ]),
    ];
    const entries: Array<{ -readonly [K in keyof Entry]: Entry[K] }> = [];
    for (const [p, kind, reason] of rows) {
      const st = await NodeFSP.lstat(p).catch(() => undefined);
      if (!st || st.isSymbolicLink()) continue;
      const volume = volumeRows.find((v) => samePath(NodePath.parse(p).root, v.path));
      entries.push({
        id: NodeCrypto.createHash("sha256").update(p).digest("hex"),
        name: NodePath.basename(p),
        path: p,
        kind,
        reason,
        canRelease: false,
        canArchive: false,
        canExpand: false,
        modifiedAt: iso(st.mtimeMs),
        ...(volume ? { volumePath: volume.path } : {}),
      });
    }
    if (req.measureSizes) {
      const deadline = now() + 30_000;
      for (const entry of entries) {
        const bytes = await measure(entry.path, Math.min(deadline, now() + 5000)).catch(
          () => undefined,
        );
        if (bytes !== undefined) entry.bytes = bytes;
      }
    }
    return entries;
  };

  // The client names an id; the path and destination must still be one this host would offer.
  const candidate = async (req: Request) => {
    const c = req.cleanupCandidate;
    if (!c || c.locked !== false || c.canRelease !== true)
      throw new Error("缺少最新白名单扫描授权");
    const target = (await windowsCleanupTargets(deps.roots)).find(
      (t) => cleanupId(t.path) === c.id && samePath(t.path, c.path),
    );
    const destination = target?.rebuildable ? "delete-rebuildable" : "trash";
    if (!target || target.locked || c.destination !== destination)
      throw new Error("对象不在清理白名单");
    const st = await NodeFSP.lstat(target.path).catch(() => undefined);
    if (!st || st.isSymbolicLink() || !samePath(await NodeFSP.realpath(target.path), target.path))
      throw new Error("白名单路径变化");
    return { c, p: target.path, identity: `${st.dev}:${st.ino}` };
  };
  const snapshot = (p: string, rebuildable: boolean) =>
    inspectCleanupTree(p, now() + 20_000, 300_000, !rebuildable);

  const cleanupPlan = async (req: Request) => {
    const { c, p, identity } = await candidate(req);
    const tree = await snapshot(p, c.destination === "delete-rebuildable");
    const id = NodeCrypto.randomUUID();
    const trash = c.destination === "trash";
    const plan: Plan = {
      id,
      type: "mole-cleanup",
      phase: "planned",
      createdAt: iso(),
      source: p,
      sourceIdentity: identity,
      sourceBytes: c.bytes ?? tree.bytes,
      measuredBytes: tree.bytes,
      digest: tree.fingerprint,
      cleanupObjectId: c.id,
      cleanupDestination: c.destination,
      category: c.category,
      release: !trash,
      expiresAt: now() + PLAN_TTL_MS,
      spacePath: NodePath.dirname(p),
      freeBefore: await freeBytes(p),
      warnings: [
        trash
          ? "移入回收站，不立即释放空间。星云不会清空回收站；需要找回时在回收站中右键“还原”。"
          : "仅白名单内可重建内容会永久删除；执行前再次检查路径、内容、占用和所有卷保护线。",
      ],
      ...(trash ? { destination: "回收站" } : {}),
    };
    await save(req, plan);
    return plan;
  };

  const recheck = async (req: Request, plan: Plan) => {
    const current = await freeBytes(String(plan.spacePath));
    const before = Number(plan.freeBefore);
    if (Math.abs(current - before) > Math.max(1, before) * 0.01)
      throw new Error("可用空间与预览相差超过1%，请返回预览重新确认");
    const { c, p, identity } = await candidate(req);
    if (
      c.id !== plan.cleanupObjectId ||
      p !== plan.source ||
      c.destination !== plan.cleanupDestination
    )
      throw new Error("对象或去向变化，请返回预览重新确认");
    if (identity !== plan.sourceIdentity) throw new Error("路径身份变化，请返回预览重新确认");
    const tree = await snapshot(p, c.destination === "delete-rebuildable");
    if (tree.fingerprint !== plan.digest)
      throw new Error("文件内容或大小与预览不同，请返回预览重新确认");
    return p;
  };

  // Windows refuses to rename a folder while any file inside is open, so the rename doubles as
  // the in-use check that lsof provides on macOS.
  const renameOrBusy = async (from: string, to: string) => {
    try {
      await NodeFSP.rename(from, to);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? "";
      throw new Error(
        BUSY_CODES.has(code)
          ? "文件被占用（可能有程序正在使用），未清理"
          : "路径已存在或变化，未覆盖",
        { cause: error },
      );
    }
  };

  const cleanupRun = async (req: Request, plan: Plan) => {
    const p = await recheck(req, plan);
    if (await isCancelled(req, plan)) throw new Error("已取消；未释放的源文件保留");
    const held = `${p}.nebula-held-${plan.id}`;
    if (plan.cleanupDestination === "trash") {
      plan.held = held;
      await renameOrBusy(p, held);
      try {
        await renameOrBusy(held, p);
      } catch (error) {
        plan.phase = "retirement_intent";
        throw error;
      }
      delete plan.held;
      await recycle(p);
      if (await exists(p)) throw new Error("未能移入回收站，原件保留");
      plan.phase = "trashed";
    } else {
      plan.held = held;
      plan.phase = "retirement_intent";
      await save(req, plan);
      try {
        await renameOrBusy(p, held);
      } catch (error) {
        plan.phase = "started";
        delete plan.held;
        throw error;
      }
      plan.phase = "releasing";
      await save(req, plan);
      try {
        await NodeFSP.rm(held, { recursive: true, maxRetries: 2 });
      } catch {
        throw new Error(`删除未完成；剩余内容保留在 ${held}`);
      }
      plan.phase = "completed";
    }
    plan.freeAfter = await freeBytes(p);
    await save(req, plan);
    return plan;
  };

  const reconcile = async (req: Request, plan: Plan) => {
    if (["completed", "source_restored", "cancelled", "failed"].includes(plan.phase)) return plan;
    if (plan.phase === "trashed")
      throw new Error("已移入回收站；需要找回时请打开回收站，右键“还原”");
    if (running.has(plan.id)) throw new Error("原进程仍在运行");
    const src = String(plan.source ?? "");
    const held = typeof plan.held === "string" ? plan.held : "";
    if (!held || !(await exists(held))) {
      if (plan.phase !== "queued" && plan.phase !== "locked" && plan.phase !== "started")
        throw new Error("保全项不完整，锁定等待人工检查");
      plan.phase = "cancelled";
      plan.error = "操作中断前未移动原件";
      await save(req, plan);
      return plan;
    }
    if (held !== `${src}.nebula-held-${plan.id}`) throw new Error("恢复路径变化");
    if (await exists(src)) throw new Error("原路径有新内容，绝不覆盖");
    await renameOrBusy(held, src);
    plan.phase = "source_restored";
    plan.error = "已恢复原路径，未继续清理";
    await save(req, plan);
    return plan;
  };

  const execute = async (req: Request, plan: Plan) => {
    if (plan.phase !== "planned" && plan.phase !== "queued") return plan;
    if (await isCancelled(req, plan)) {
      plan.phase = "cancelled";
      await save(req, plan);
      return plan;
    }
    if (now() > Number(plan.expiresAt)) {
      plan.phase = "failed";
      plan.error = "计划过期，请重新检查";
      await save(req, plan);
      return plan;
    }
    running.add(plan.id);
    plan.phase = "started";
    await save(req, plan);
    try {
      return await cleanupRun(req, plan);
    } catch (error) {
      plan.phase = ACTIVE.slice(1).includes(plan.phase)
        ? "locked"
        : (await isCancelled(req, plan))
          ? "cancelled"
          : "failed";
      plan.error = error instanceof Error ? error.message : String(error);
      await save(req, plan);
      return plan;
    } finally {
      running.delete(plan.id);
    }
  };

  const withPlan = async (req: Request, run: (plan: Plan) => Promise<unknown>) => {
    const file = opFile(req, req.planId);
    const previous = locks.get(file) ?? Promise.resolve();
    const next = previous.then(async () => {
      const plan = await load(file);
      if (!plan) throw new Error("操作不存在");
      return run(plan);
    });
    const settled = next.catch(() => undefined);
    locks.set(file, settled);
    void settled.then(() => {
      if (locks.get(file) === settled) locks.delete(file);
    });
    return next;
  };

  const call = async (input: object): Promise<unknown> => {
    const req = input as Request;
    switch (req.action) {
      case "inspect": {
        if (req.statusOnly)
          return {
            entries: [],
            archives: [],
            volumes: [],
            operations: await operations(req),
            checkedAt: iso(),
          };
        if (req.objectId) throw new Error("对象已变化，请重新检查");
        const volumeRows = await volumes(req);
        return {
          entries: await inventory(req, volumeRows),
          archives: [],
          volumes: volumeRows,
          operations: await operations(req),
          checkedAt: iso(),
          truncated: false,
        };
      }
      case "cleanup-plan":
        return cleanupPlan(req);
      case "queue":
        return withPlan(req, async (plan) => {
          if (plan.phase !== "planned") return plan;
          if (now() > Number(plan.expiresAt)) throw new Error("计划过期，请重新检查");
          await recheck(req, plan);
          if (await isCancelled(req, plan)) throw new Error("已取消；未释放的源文件保留");
          plan.phase = "queued";
          plan.serverPid = process.pid;
          await save(req, plan);
          return plan;
        });
      case "execute":
        return withPlan(req, (plan) => execute(req, plan));
      case "reconcile":
        return withPlan(req, (plan) => reconcile(req, plan));
      case "cancel": {
        const plan = await load(opFile(req, req.planId));
        if (!plan) throw new Error("操作不存在");
        await NodeFSP.mkdir(NodePath.dirname(cancelFile(req, plan.id)), { recursive: true });
        await NodeFSP.writeFile(cancelFile(req, plan.id), JSON.stringify({ requestedAt: now() }));
        return { ...plan, cancelRequested: true };
      }
      default:
        throw new Error("Windows 暂不支持归档到外置磁盘；可重建缓存和安装包可以直接清理");
    }
  };
  return { call };
}
