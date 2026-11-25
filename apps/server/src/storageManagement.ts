// @effect-diagnostics nodeBuiltinImport:off - a fixed Python worker uses streaming tar verification without copying whole archives into RAM.
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as ServerSettings from "./serverSettings.ts";
import {
  scanCleanup,
  cleanupRoots,
  cleanupStagingDir,
  assertVolumeBudget,
  type ScanProgress,
} from "./storageMole.ts";
import * as NodeChildProcess from "node:child_process";
import * as HostProcess from "@t3tools/shared/HostProcess";
import {
  StorageActionInput,
  StorageInspection,
  StorageInspectInput,
  StorageOperation,
  StorageManagementError,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as ServerConfig from "./config.ts";
import * as StorageCleanup from "./storageCleanup.ts";
import { STORAGE_ARCHIVE_PROGRAM } from "./storageArchiveProgram.ts";
import { windowsCleanupRoots } from "./storageMoleWindows.ts";
import { makeWindowsStorageWorker } from "./storageWindows.ts";

export class StorageManagement extends Context.Service<
  StorageManagement,
  {
    readonly inspect: (
      input: StorageInspectInput,
    ) => Effect.Effect<StorageInspection, StorageManagementError>;
    readonly manage: (
      input: StorageActionInput,
    ) => Effect.Effect<StorageOperation, StorageManagementError>;
  }
>()("t3/storageManagement") {}

const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const platform = yield* HostProcess.Platform;
  const cleanup = yield* StorageCleanup.StorageCleanup;
  const scope = yield* Scope.Scope;
  const settings = yield* ServerSettings.ServerSettingsService;
  const windowsRoots =
    platform === "win32"
      ? windowsCleanupRoots({ home: NodeOS.homedir(), temp: NodeOS.tmpdir(), env: process.env })
      : undefined;
  const windowsWorker = windowsRoots
    ? makeWindowsStorageWorker({ roots: windowsRoots })
    : undefined;
  const roots = () => cleanupRoots(windowsRoots);
  let scanned: StorageInspection["entries"] = [];
  let progress: (ScanProgress & { requestId?: number }) | undefined;
  let scanRequest: number | undefined;
  let scanGeneration = 0;
  let lastScan = 0;
  const historyPath = NodePath.join(config.stateDir, "disk-cleanup-history.json");
  const historySchema = Schema.fromJsonString(
    Schema.Record(
      Schema.String,
      Schema.Array(Schema.Struct({ at: Schema.String, freeBytes: Schema.Number })),
    ),
  );
  let history = yield* Effect.tryPromise({
    try: () => NodeFSP.readFile(historyPath, "utf8"),
    catch: (cause) => new StorageManagementError({ message: String(cause) }),
  }).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(historySchema)),
    Effect.orElseSucceed((): typeof historySchema.Type => ({})),
  );
  const MAX_WORKER_STDOUT_BYTES = 16 * 1024 * 1024;
  const workerTimeoutMs = (input: object) => {
    const action = (input as { action?: unknown }).action;
    if (action === "execute") return 3_900_000;
    if (action === "plan" || action === "restore-plan" || action === "logs-plan") return 960_000;
    return 120_000;
  };
  const call = Effect.fn("StorageManagement.worker")(function* (input: object) {
    const currentSettings = yield* settings.getSettings.pipe(
      Effect.mapError(() => new StorageManagementError({ message: "无法读取保护设置" })),
    );
    const request = {
      ...input,
      base: config.baseDir,
      staging: cleanupStagingDir(),
      reserveByVolume: currentSettings.storageCleanup.volumeReserveGiB ?? {},
      inventoryPaths: {
        logs: config.logsDir,
        attachments: config.attachmentsDir,
        database: config.dbPath,
      },
    };
    return yield* Effect.tryPromise({
      try: (signal) =>
        windowsWorker
          ? windowsWorker.call(request)
          : new Promise<unknown>((resolve, reject) => {
              if (platform !== "darwin") {
                reject(new Error("当前归档操作需要 macOS 的 Python 3；不会执行清理"));
                return;
              }
              if (signal.aborted) {
                reject(new Error("归档操作已取消"));
                return;
              }
              const child = NodeChildProcess.spawn(
                "/usr/bin/python3",
                ["-c", STORAGE_ARCHIVE_PROGRAM],
                {
                  stdio: ["pipe", "pipe", "pipe"],
                },
              );
              let settled = false;
              let output = "";
              let outputBytes = 0;
              let stderr = "";
              const finish = (fn: () => void) => {
                if (settled) return;
                settled = true;
                signal.removeEventListener("abort", onAbort);
                fn();
              };
              const killChild = () => {
                try {
                  child.kill("SIGTERM");
                } catch {
                  /* Child already exited. */
                }
              };
              const onAbort = () => {
                killChild();
                finish(() => reject(new Error("归档操作已取消")));
              };
              signal.addEventListener("abort", onAbort, { once: true });
              child.stdout.on("data", (data: Buffer | string) => {
                const chunk = Buffer.isBuffer(data) ? data : Buffer.from(String(data));
                outputBytes += chunk.byteLength;
                if (outputBytes > MAX_WORKER_STDOUT_BYTES) {
                  killChild();
                  finish(() => reject(new Error("归档进程输出超过上限，已中止")));
                  return;
                }
                output += chunk.toString("utf8");
              });
              child.stderr.on("data", (data) => {
                stderr = (stderr + String(data)).slice(-2000);
              });
              child.on("error", (error) => finish(() => reject(error)));
              child.on("close", (code) => {
                finish(() => {
                  try {
                    const result: unknown = JSON.parse(output);
                    if (code !== 0)
                      reject(
                        new Error(
                          typeof result === "object" && result !== null && "error" in result
                            ? String(result.error)
                            : "归档操作未完成",
                        ),
                      );
                    else resolve(result);
                  } catch {
                    reject(new Error(stderr || "归档进程未返回有效结果"));
                  }
                });
              });
              child.stdin.on("error", () => undefined);
              child.stdin.end(JSON.stringify(request));
            }),
      catch: (error) =>
        new StorageManagementError({
          message: error instanceof Error ? error.message : String(error),
        }),
    }).pipe(
      Effect.timeoutOrElse({
        duration: workerTimeoutMs(input),
        orElse: () => Effect.fail(new StorageManagementError({ message: "归档进程超时，已终止" })),
      }),
    );
  });
  const readInspection = Effect.fn("StorageManagement.readInspection")(function* (
    input: StorageInspectInput,
  ) {
    const result = yield* call({ ...input, action: "inspect" }).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(StorageInspection)),
      Effect.mapError((error) => new StorageManagementError({ message: String(error) })),
    );
    const current = yield* settings.getSettings.pipe(
      Effect.mapError(() => new StorageManagementError({ message: "无法读取磁盘保护设置" })),
    );
    return {
      ...result,
      volumes: result.volumes.map((v) => ({
        ...v,
        reserveGiB: Math.max(40, current.storageCleanup.volumeReserveGiB?.[v.path] ?? 40),
        history: history[v.path] ?? [],
      })),
      scanOnOpenDaily: current.storageCleanup.scanOnOpenDaily ?? false,
    };
  });
  const scan = Effect.fn("StorageManagement.scanCleanup")(function* (
    volumes: StorageInspection["volumes"],
  ) {
    const requestId = progress?.requestId ?? 0;
    progress = {
      requestId,
      phase: "scanning",
      checked: 0,
      total: 0,
      current: "",
      truncated: false,
    };
    const result = yield* Effect.tryPromise({
      try: () =>
        scanCleanup(roots(), volumes, (p) => {
          progress = { ...p, requestId };
        }),
      catch: () => new StorageManagementError({ message: "白名单扫描失败" }),
    }).pipe(Effect.option);
    if (result._tag === "None") {
      progress = {
        requestId,
        phase: "completed",
        checked: progress?.checked ?? 0,
        total: progress?.total ?? 0,
        current: "",
        truncated: true,
      };
      return;
    }
    scanned = result.value.entries;
    lastScan = yield* Clock.currentTimeMillis;
    const at = DateTime.formatIso(DateTime.makeUnsafe(lastScan));
    const updatedHistory = { ...history };
    for (const v of volumes)
      updatedHistory[v.path] = [
        ...(history[v.path] ?? []).filter((row) => row.at.slice(0, 10) !== at.slice(0, 10)),
        { at, freeBytes: v.freeBytes },
      ].slice(-30);
    history = updatedHistory;
    const encoded = yield* Schema.encodeEffect(historySchema)(history).pipe(
      Effect.orElseSucceed(() => "{}"),
    );
    yield* Effect.tryPromise({
      try: () => NodeFSP.writeFile(historyPath, encoded, { mode: 0o600 }),
      catch: (cause) => new StorageManagementError({ message: String(cause) }),
    }).pipe(Effect.orElseSucceed(() => undefined));
  });
  const inspect = Effect.fn("StorageManagement.inspect")(function* (input: StorageInspectInput) {
    const result = yield* readInspection(input);
    const now = yield* Clock.currentTimeMillis;
    if (
      !input.statusOnly &&
      !input.objectId &&
      progress?.phase !== "scanning" &&
      ((input.scanRequest !== undefined && input.scanRequest !== scanRequest) ||
        (input.measureSizes && lastScan === 0) ||
        (result.scanOnOpenDaily && now - lastScan > 86400_000))
    ) {
      scanRequest = input.scanRequest;
      // Mark before forking so concurrent inspect calls join the same scan.
      scanGeneration = Math.max(scanGeneration + 1, now);
      progress = {
        requestId: scanGeneration,
        phase: "scanning",
        checked: 0,
        total: 0,
        current: "",
        truncated: false,
      };
      yield* scan(result.volumes).pipe(Effect.forkIn(scope));
    }
    const entries =
      input.statusOnly || input.objectId
        ? result.entries
        : [
            ...result.entries.filter((row) => !scanned.some((extra) => extra.path === row.path)),
            ...scanned,
          ];
    return {
      ...result,
      entries,
      ...(progress ? { scan: progress } : {}),
      truncated: result.truncated || progress?.truncated || false,
    };
  });
  const freshCandidate = Effect.fn("StorageManagement.freshCleanupCandidate")(function* (
    id: string,
  ) {
    const result = yield* readInspection({});
    const inventory = yield* Effect.tryPromise({
      try: () => scanCleanup(roots(), result.volumes, undefined, undefined, id),
      catch: () => new StorageManagementError({ message: "清理白名单复核失败" }),
    });
    const candidate = inventory.entries.find(
      (row) => row.id === id && !row.locked && row.canRelease,
    );
    if (!candidate)
      return yield* new StorageManagementError({
        message: "对象已改变、加锁或扫描不完整；请重新扫描",
      });
    return candidate;
  });
  const manage = Effect.fn("StorageManagement.manage")(function* (input: StorageActionInput) {
    if (input.action === "cleanup-settings") {
      const current = yield* settings.getSettings.pipe(
        Effect.mapError(() => new StorageManagementError({ message: "无法读取保护设置" })),
      );
      const inspection = yield* readInspection({});
      if (input.volumePath && !inspection.volumes.some((v) => v.path === input.volumePath))
        return yield* new StorageManagementError({ message: "磁盘已离线，未保存保护线" });
      yield* settings
        .updateSettings({
          storageCleanup: {
            ...(input.volumePath && input.reserveGiB !== undefined
              ? {
                  volumeReserveGiB: {
                    ...current.storageCleanup.volumeReserveGiB,
                    [input.volumePath]: input.reserveGiB,
                  },
                }
              : {}),
            ...(input.scanOnOpenDaily !== undefined
              ? { scanOnOpenDaily: input.scanOnOpenDaily }
              : {}),
          },
        })
        .pipe(Effect.mapError(() => new StorageManagementError({ message: "保存磁盘设置失败" })));
      return {
        id: "cleanup-settings",
        type: "settings",
        phase: "completed",
        createdAt: DateTime.formatIso(DateTime.makeUnsafe(yield* Clock.currentTimeMillis)),
        sourceBytes: 0,
      };
    }
    let cleanupCandidate: StorageInspection["entries"][number] | undefined;
    if (input.action === "cleanup-plan") cleanupCandidate = yield* freshCandidate(input.objectId);
    if (input.action === "execute") {
      const state = yield* readInspection({ statusOnly: true });
      const operation = state.operations.find((op) => op.id === input.planId);
      if (operation?.cleanupObjectId && operation.phase === "planned")
        cleanupCandidate = yield* freshCandidate(operation.cleanupObjectId);
    }
    if (!["cancel", "reconcile"].includes(input.action)) {
      const inspection = yield* readInspection({});
      yield* Effect.try({
        try: () => assertVolumeBudget(inspection.volumes),
        catch: (error) =>
          new StorageManagementError({
            message: error instanceof Error ? error.message : "保护线检查失败",
          }),
      });
    }
    const request = { ...input, ...(cleanupCandidate ? { cleanupCandidate } : {}) };
    if (input.action === "execute") {
      const operation = yield* call({ ...request, action: "queue" }).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(StorageOperation)),
        Effect.mapError((error) => new StorageManagementError({ message: String(error) })),
      );
      if (operation.phase === "queued") {
        yield* cleanup.withMaintenanceLock(call(request)).pipe(
          Effect.catch((error) =>
            Effect.logWarning("Storage management background execution failed", {
              planId: operation.id,
              error: error.message,
            }),
          ),
          Effect.ensuring(
            Effect.sync(() => {
              scanned = [];
              lastScan = 0;
              progress = undefined;
            }),
          ),
          Effect.forkIn(scope),
        );
      }
      return operation;
    }
    const work =
      input.action === "cancel" ? call(input) : cleanup.withMaintenanceLock(call(request));
    return yield* work.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(StorageOperation)),
      Effect.mapError((error) => new StorageManagementError({ message: String(error) })),
    );
  });
  return StorageManagement.of({ inspect, manage });
});
export const layer = Layer.effect(StorageManagement, make);
