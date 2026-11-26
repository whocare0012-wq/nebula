import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Layer from "effect/Layer";
import * as ModelManifest from "./ModelManifest.ts";
import { expect, it } from "@effect/vitest";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Digest from "effect/crypto/Digest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Hex from "effect/encoding/Hex";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";
import * as Exit from "effect/Exit";
import * as Queue from "effect/Queue";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { HttpClient, HttpClientError, HttpClientRequest, HttpClientResponse } from "effect/http";
import * as TestClock from "effect/testing/TestClock";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import * as CodexInstallation from "./CodexInstallation.ts";

// A Windows host cannot run the `#!/bin/sh` fakes, keep POSIX execute bits, or unpack with POSIX
// `tar`, so there the harness simulates win32 with `.cmd` fakes and a Windows package instead.
const windowsHost = HostProcess.Platform.defaultValue() === "win32";
const hostTarget = windowsHost ? "aarch64-pc-windows-msvc" : "aarch64-apple-darwin";
const otherHostTarget = windowsHost ? "x86_64-pc-windows-msvc" : "x86_64-apple-darwin";
const exe = windowsHost ? ".exe" : "";
const archive = Buffer.from(
  windowsHost
    ? "H4sIALKyB2sAA+2XzWrEIBRG51HEdZNRkyj0Qbo3jiRpOxrU+aP03atTUtpAmUUnkcI9CyUi8TOXI6YdzFbZnT6X+qw3y0AIEUKg1EfmfaJBtKkIFRVlnCFCKSfVBpGF8vzg4IN0Mcpf3zPf3D/hWvvcIYBstJP/RWqLfWp668M9j4Pb/tcz/+uaCPB/DVKtc2cA8vHp/ihDv3XdQneA2/6zmf+sEgz8XwPX5U4A5GTyX73ITpfP3pr7rxF94Jz/7j9t+Nx/zgj4vwZv+FVe7CE8aecHa/Ajog8IH7+eMCljeUqK42j8UJ0OaVBKp3peF6MqToPZ2ZMv9v6o0iRtgruMdjDXie3330v8nnu3AAAAwMQH7Imn1AAUAAA="
    : "H4sIAAAAAAAC/+3W0W6DIBQGYB/FcD0sKNSkD7J7aom6tmAQtzXL3n3QZM3qdWVt+n8XoCckJp78wLY3q8bu9Ge2HBbUUp7nYD4H8s9zrNdSsCxnWQLT6JULn8ye09K9h/u2/c0/jSM9xqGzo0+bf3Gdf15WQiD/Kdy61/CA+z8dlO9Wrv2387+c5Z9VZY38p7BY0+Gh8t/sVauLt9Ga9Pnnop7ln1e4/6fxRQ7qZCf/qt3YW0M2OX/JyfvljbCCy3XBSaiGH9VqH4tKuaZbC6qG4aDpTrmP3sQV2nh3Gmxvzqsud0vyjaABAAAAAAAAAAAAAAAk8gOq19rvACgAAA==",
  "base64",
);
const asset = {
  version: "0.156.1",
  target: hostTarget,
  url: "https://github.com/openai/codex/releases/download/test/package.tar.gz",
  archiveBytes: archive.length,
};
/** Logs its arguments to `probeLog` and answers `--version` and `app-server` like the Codex CLI. */
const fakeCodexScript = (
  platform: NodeJS.Platform,
  probeLog: string,
  local: { version: string; appServerFails?: boolean; versionFails?: boolean },
) =>
  platform === "win32"
    ? [
        "@echo off",
        // The spawn quotes every argument for cmd.exe; log them bare like the POSIX fake.
        'set "args=%*"',
        `>>"${probeLog}" echo %args:"=%`,
        `if "%~1"=="--version" (${local.versionFails ? "exit /b 1" : `echo codex-cli ${local.version}& exit /b 0`})`,
        `if "%~1"=="app-server" exit /b ${local.appServerFails ? "1" : "0"}`,
        "",
      ].join("\r\n")
    : `#!/bin/sh\nprintf '%s\\n' "$*" >> '${probeLog}'\ncase "$1" in\n--version) ${local.versionFails ? "exit 1" : `printf '%s\\n' 'codex-cli ${local.version}'`};;\napp-server) exit ${local.appServerFails ? "1" : "0"};;\nesac\n`;
const readProbes = (fs: FileSystem.FileSystem, probeLog: string) =>
  fs.readFileString(probeLog).pipe(Effect.map((log) => log.trim().split(/\r?\n/u)));

const makeHarness = Effect.fn("test.makeCodexInstallation")(function* (
  input: {
    options?: Partial<CodexInstallation.CodexInstallationOptions>;
    manifestCurrent?: Effect.Effect<ModelManifest.ModelManifestData>;
    body?: Stream.Stream<Uint8Array, HttpClientError.HttpClientError>;
    downloadStatus?: number;
    baseDir?: string;
    local?: { version: string; appServerFails?: boolean; versionFails?: boolean };
    platform?: NodeJS.Platform;
    spawner?: ChildProcessSpawner.ChildProcessSpawner["Service"];
    runtimeRenameFailures?: number;
    /** Served by URL instead of the pinned package. */
    responses?: Readonly<Record<string, () => Response>>;
  } = {},
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const platform = input.platform ?? (windowsHost ? "win32" : "darwin");
  const baseDir =
    input.baseDir ?? (yield* fs.makeTempDirectoryScoped({ prefix: "t3-codex-install-test-" }));
  const localDirectory = path.join(baseDir, "local");
  // The win32 PATH lookup reports the extension spelled as in PATHEXT.
  const localBinaryPath = path.join(localDirectory, `codex${platform === "win32" ? ".CMD" : ""}`);
  const probeLog = path.join(baseDir, "local-probes.txt");
  // A restarted harness on the same baseDir keeps the existing binary, and with it its fingerprint.
  if (input.local && !(yield* fs.exists(localBinaryPath))) {
    yield* fs.makeDirectory(localDirectory, { recursive: true });
    yield* fs.writeFileString(localBinaryPath, fakeCodexScript(platform, probeLog, input.local), {
      mode: 0o755,
    });
  }
  let downloads = 0;
  const digest = yield* Digest.Digest;
  const sha256 = Hex.encode(yield* digest.digest(Digest.sha256, archive).pipe(Effect.orDie));
  let runtimeRenameFailures = input.runtimeRenameFailures ?? 0;
  const failedRenames = yield* Queue.unbounded<void>();
  const lockingFs: FileSystem.FileSystem = {
    ...fs,
    // Suspended so each retry of the same effect is a fresh attempt, like the real rename.
    rename: (from, to) =>
      Effect.suspend(() =>
        /[/\\]runtime$/u.test(from) && runtimeRenameFailures-- > 0
          ? Queue.offer(failedRenames, undefined).pipe(
              Effect.andThen(
                Effect.fail(
                  PlatformError.systemError({
                    _tag: "PermissionDenied",
                    module: "FileSystem",
                    method: "rename",
                    pathOrDescriptor: from,
                  }),
                ),
              ),
            )
          : fs.rename(from, to),
      ),
  };
  const spawner = input.spawner ?? (yield* ChildProcessSpawner.ChildProcessSpawner);
  const installation = yield* CodexInstallation.makeCodexInstallation({
    baseDir,
    releaseAsset: { ...asset, sha256 },
    validate: () => Effect.void,
    ...input.options,
  }).pipe(
    Effect.provideService(ModelManifest.ModelManifest, {
      current: input.manifestCurrent ?? Effect.succeed(ModelManifest.BUNDLED_MODEL_MANIFEST),
      refresh: Effect.succeed(ModelManifest.BUNDLED_MODEL_MANIFEST),
      forceRefresh: Effect.succeed(ModelManifest.BUNDLED_MODEL_MANIFEST),
      refreshOnDemand: Effect.succeed(ModelManifest.BUNDLED_MODEL_MANIFEST),
      refreshInBackground: Effect.void,
    }),
    Effect.provideService(HostProcess.Platform, platform),
    Effect.provideService(HostProcess.Architecture, "arm64"),
    Effect.provideService(HostProcess.Environment, {
      PATH: input.local ? localDirectory : "",
      SystemRoot: "C:\\Windows",
    }),
    Effect.provideService(FileSystem.FileSystem, lockingFs),
    Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
    Effect.provideService(
      HttpClient.HttpClient,
      HttpClient.make((request) =>
        Effect.sync(() => {
          downloads++;
          const respond = input.responses?.[request.url];
          if (respond) return HttpClientResponse.fromWeb(request, respond());
          return Object.defineProperty(
            HttpClientResponse.fromWeb(
              request,
              new Response(null, { status: input.downloadStatus ?? 200 }),
            ),
            "stream",
            {
              value: input.body ?? Stream.succeed(archive),
            },
          );
        }),
      ),
    ),
  );
  return {
    installation,
    fs,
    baseDir,
    localBinaryPath,
    probeLog,
    failedRenames,
    downloads: () => downloads,
  };
});
const terminalState = (installation: CodexInstallation.CodexInstallation["Service"]) =>
  installation.changes.pipe(
    Stream.filter((state) => ["succeeded", "failed", "cancelled"].includes(state.phase)),
    Stream.runHead,
    Effect.map(Option.getOrThrow),
  );

it.effect.each(["0.156.0", "0.156.1", "0.156.2", "0.157.0"])(
  "reuses installed Codex %s without downloading or taking ownership of it",
  (version) =>
    Effect.gen(function* () {
      const h = yield* makeHarness({ local: { version } });
      expect(yield* h.installation.start).toMatchObject({
        source: "local",
        phase: "succeeded",
        installedVersion: version,
        executablePath: h.localBinaryPath,
        canRemove: false,
      });
      expect(yield* h.installation.resolve()).toMatchObject({
        source: "local",
        executablePath: h.localBinaryPath,
        managedVersionDirectory: null,
        version,
      });
      yield* h.installation.acquire().pipe(Effect.scoped);
      expect(h.downloads()).toBe(0);
      expect(yield* h.fs.exists(h.installation.managedDirectory)).toBe(false);
      expect(yield* readProbes(h.fs, h.probeLog)).toEqual(["--version", "app-server --help"]);
      yield* h.installation.remove();
      expect(yield* h.fs.exists(h.localBinaryPath)).toBe(true);
      expect((yield* h.installation.state).source).toBe("local");
    }).pipe(Effect.scoped, Effect.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))),
);
it.effect.each([
  { version: "0.128.9" },
  { version: "0.145.0" },
  { version: "0.155.1" },
  { version: "0.155.9" },
  { version: "0.156.1-alpha.1" },
  { version: "unknown" },
  { version: "0.156.1", appServerFails: true },
  { version: "0.156.1", versionFails: true },
])("downloads the pinned release when the local CLI is unsupported or broken: %j", (local) =>
  Effect.gen(function* () {
    const h = yield* makeHarness({ local });
    expect((yield* h.installation.state).installedVersion).toBeNull();
    yield* h.installation.start;
    const installed = yield* terminalState(h.installation);
    expect(installed.phase).toBe("succeeded");
    const executable = yield* h.installation.resolve();
    expect(executable.source).toBe("managed");
    expect(installed.executablePath).toBe(executable.executablePath);
    expect(h.downloads()).toBe(1);
    expect(yield* h.fs.exists(h.localBinaryPath)).toBe(true);
  }).pipe(Effect.scoped, Effect.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))),
);

const compileNative = Effect.fn("test.compileNative")(function* (
  executablePath: string,
  source: string,
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const compiler = yield* spawner.spawn(
    ChildProcess.make("cc", ["-x", "c", "-", "-o", executablePath], {
      stdin: Stream.make(new TextEncoder().encode(source)),
      stdout: "inherit",
      stderr: "inherit",
    }),
  );
  expect(yield* compiler.exitCode).toBe(0);
}, Effect.scoped);

const reprobesAfterRestart = (layout: string, persists: boolean) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-codex-install-test-" });
    const packageDirectory =
      layout === "npm shim"
        ? path.join(baseDir, "local", "node_modules", "@openai", "codex")
        : path.join(baseDir, "npm", "lib", "node_modules", "@openai", "codex");
    const payload =
      layout === "wrapper script"
        ? path.join(baseDir, `payload${windowsHost ? ".cmd" : ""}`)
        : path.join(packageDirectory, "bin", `codex${windowsHost ? ".cmd" : ".js"}`);
    const install = Effect.fn("test.installPayload")(function* (version: string) {
      yield* fs.makeDirectory(path.join(packageDirectory, "bin"), { recursive: true });
      if (layout !== "wrapper script")
        yield* fs.writeFileString(
          path.join(packageDirectory, "package.json"),
          JSON.stringify({ name: "@openai/codex", version }),
        );
      yield* fs.writeFileString(
        payload,
        windowsHost
          ? fakeCodexScript("win32", path.join(baseDir, "local-probes.txt"), { version })
          : `#!/bin/sh\nprintf '%s\\n' "$*" >> '${baseDir}/local-probes.txt'\ncase "$1" in --version) printf 'codex-cli ${version}\\n';; esac\n`,
        { mode: 0o755 },
      );
    });
    yield* install("0.156.1");
    yield* fs.makeDirectory(path.join(baseDir, "local"), { recursive: true });
    if (layout === "npm bin symlink") yield* fs.symlink(payload, `${baseDir}/local/codex`);
    else if (windowsHost)
      yield* fs.writeFileString(
        path.join(baseDir, "local", "codex.cmd"),
        `@call "${payload}" %*\r\n`,
      );
    else
      yield* fs.writeFileString(`${baseDir}/local/codex`, `#!/bin/sh\nexec '${payload}' "$@"\n`, {
        mode: 0o755,
      });
    const first = yield* makeHarness({ baseDir, local: { version: "0.156.1" } });
    expect((yield* first.installation.resolve()).source).toBe("local");
    const restarted = yield* makeHarness({ baseDir, local: { version: "0.156.1" } });
    expect((yield* restarted.installation.resolve()).source).toBe("local");
    expect(yield* readProbes(fs, first.probeLog)).toHaveLength(persists ? 2 : 4);
    yield* install("0.128.9");
    const upgraded = yield* makeHarness({ baseDir, local: { version: "0.156.1" } });
    expect((yield* upgraded.installation.state).installedVersion).toBeNull();
  }).pipe(Effect.scoped, Effect.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)));

// npm links its bin into place only on POSIX; Windows gets the `.cmd` shim covered below.
it.effect.skipIf(windowsHost)(
  "re-probes a npm bin symlink Codex after a restart only when its payload can change",
  () => reprobesAfterRestart("npm bin symlink", true),
);
it.effect.each([
  { layout: "npm shim", persists: true },
  { layout: "wrapper script", persists: false },
])(
  "re-probes a $layout Codex after a restart only when its payload can change",
  ({ layout, persists }) => reprobesAfterRestart(layout, persists),
);

it.effect("rechecks compatibility after the local executable is replaced", () =>
  Effect.gen(function* () {
    const h = yield* makeHarness({ local: { version: "0.156.1" } });
    expect((yield* h.installation.resolve()).source).toBe("local");
    yield* h.fs.remove(h.localBinaryPath);
    yield* h.fs.writeFileString(
      h.localBinaryPath,
      windowsHost
        ? `${fakeCodexScript("win32", h.probeLog, { version: "0.128.9" })}rem replaced\r\n`
        : "#!/bin/sh\nprintf 'codex-cli 0.128.9\\n'\n",
      { mode: 0o755 },
    );
    yield* h.installation.start;
    expect((yield* terminalState(h.installation)).phase).toBe("succeeded");
    expect((yield* h.installation.resolve()).source).toBe("managed");
    expect(h.downloads()).toBe(1);
  }).pipe(Effect.scoped, Effect.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))),
);

it.effect("rechecks a cached local executable when the shared manifest policy changes", () =>
  Effect.gen(function* () {
    let manifest = ModelManifest.BUNDLED_MODEL_MANIFEST;
    const h = yield* makeHarness({
      local: { version: "0.156.0" },
      manifestCurrent: Effect.sync(() => manifest),
    });
    expect((yield* h.installation.resolve()).source).toBe("local");
    manifest = {
      ...manifest,
      compatibility: [
        {
          driver: "codex",
          t3CodeRange: ">=0.0.42",
          ranges: [
            { range: ">=0.156.1", status: "supported" },
            { range: "<0.156.1", status: "broken" },
          ],
        },
      ],
    };
    yield* h.installation.start;
    expect((yield* terminalState(h.installation)).phase).toBe("succeeded");
    expect((yield* h.installation.resolve()).source).toBe("managed");
    expect(h.downloads()).toBe(1);
    expect(yield* readProbes(h.fs, h.probeLog)).toEqual(["--version", "app-server --help"]);
  }).pipe(Effect.scoped, Effect.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))),
);

it.effect("uses bundled Codex compatibility when the remote manifest omits its policy", () =>
  Effect.gen(function* () {
    const h = yield* makeHarness({
      local: { version: "0.156.0" },
      manifestCurrent: Effect.succeed({
        ...ModelManifest.BUNDLED_MODEL_MANIFEST,
        compatibility: [],
      }),
    });
    expect((yield* h.installation.start).source).toBe("local");
    expect(h.downloads()).toBe(0);
  }).pipe(Effect.scoped, Effect.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))),
);

// POSIX-only: these launchers are symlinks that dispatch on argv[0], built with `cc` or `/bin/sh`.
for (const { kind, name } of [
  { kind: "script", name: "volta-shim" },
  { kind: "native", name: "volta-shim" },
  { kind: "native", name: "mise" },
  { kind: "native", name: "aqua-proxy" },
])
  it.effect.skipIf(windowsHost)(
    `preserves the invoked name of ${kind} ${name} launcher symlinks`,
    () =>
      Effect.gen(function* () {
        const h = yield* makeHarness({ local: { version: "0.156.1" } });
        const launcher = `${h.baseDir}/${name}`;
        if (kind === "native") {
          const payload = `${h.baseDir}/codex.js`;
          yield* h.fs.rename(h.localBinaryPath, payload);
          yield* compileNative(
            launcher,
            `#include <string.h>
#include <unistd.h>
int main(int argc, char **argv) {
  const char *name = strrchr(argv[0], '/');
  if (strcmp(name ? name + 1 : argv[0], "codex") != 0) return 1;
  execv(${JSON.stringify(payload)}, argv);
  return 1;
}
`,
          );
        } else {
          yield* h.fs.writeFileString(
            launcher,
            '#!/bin/sh\ncase "$0" in */codex) ;; *) exit 1;; esac\ncase "$1" in --version) printf "codex-cli 0.156.1\\n";; app-server) exit 0;; esac\n',
            { mode: 0o755 },
          );
          yield* h.fs.remove(h.localBinaryPath);
        }
        yield* h.fs.symlink(launcher, h.localBinaryPath);
        expect(yield* h.installation.start).toMatchObject({ source: "local", phase: "succeeded" });
        expect((yield* h.installation.resolve()).executablePath).toBe(h.localBinaryPath);
        expect(h.downloads()).toBe(0);
        expect(yield* h.fs.exists(`${h.baseDir}/caches/codex-local-probe.json`)).toBe(false);
      }).pipe(Effect.scoped, Effect.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))),
  );

it.effect(
  "installs the complete verified package in tools/codex/version and survives a restart",
  () =>
    Effect.gen(function* () {
      const { installation, fs, baseDir } = yield* makeHarness();
      const path = yield* Path.Path;
      yield* installation.start;
      expect((yield* terminalState(installation)).phase).toBe("succeeded");
      const executable = yield* installation.resolve();
      expect(executable.executablePath).toBe(
        path.join(baseDir, "tools", "codex", "0.156.1", "bin", `codex${exe}`),
      );
      expect(
        yield* fs.readFileString(
          `${executable.managedVersionDirectory}/bin/codex-code-mode-host${exe}`,
        ),
      ).toBe("host");
      expect(
        yield* fs.readFileString(`${executable.managedVersionDirectory}/codex-path/rg${exe}`),
      ).toBe("rg");
      const restarted = yield* makeHarness({ baseDir });
      expect((yield* restarted.installation.resolve()).version).toBe("0.156.1");
    }).pipe(Effect.scoped, Effect.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))),
);

it.effect("requires an update before running an older activated managed installation", () =>
  Effect.gen(function* () {
    const first = yield* makeHarness();
    yield* first.installation.start;
    yield* terminalState(first.installation);
    const executable = yield* first.installation.resolve();
    const oldDirectory = `${first.installation.managedDirectory}/0.155.1`;
    yield* first.fs.rename(executable.managedVersionDirectory!, oldDirectory);
    for (const name of ["codex-package.json", ".install-complete.json"]) {
      const file = `${oldDirectory}/${name}`;
      yield* first.fs.writeFileString(
        file,
        (yield* first.fs.readFileString(file)).replaceAll("0.156.1", "0.155.1"),
      );
    }
    yield* first.fs.writeFileString(
      `${first.installation.managedDirectory}/active.json`,
      '{"version":"0.155.1"}',
    );
    const restarted = yield* makeHarness({ baseDir: first.baseDir });
    expect((yield* Effect.flip(restarted.installation.resolve())).detail).toContain(
      "outside the supported range",
    );
    yield* restarted.installation.start;
    expect((yield* terminalState(restarted.installation)).phase).toBe("succeeded");
    expect((yield* restarted.installation.resolve()).version).toBe("0.156.1");
    expect(restarted.downloads()).toBe(1);
  }).pipe(Effect.scoped, Effect.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))),
);

it.effect("updates an older supported managed installation to the pinned release on startup", () =>
  Effect.gen(function* () {
    const first = yield* makeHarness();
    yield* first.installation.start;
    yield* terminalState(first.installation);
    const executable = yield* first.installation.resolve();
    const oldDirectory = `${first.installation.managedDirectory}/0.156.0`;
    yield* first.fs.rename(executable.managedVersionDirectory!, oldDirectory);
    for (const name of ["codex-package.json", ".install-complete.json"]) {
      const file = `${oldDirectory}/${name}`;
      yield* first.fs.writeFileString(
        file,
        (yield* first.fs.readFileString(file)).replaceAll("0.156.1", "0.156.0"),
      );
    }
    yield* first.fs.writeFileString(
      `${first.installation.managedDirectory}/active.json`,
      '{"version":"0.156.0"}',
    );
    const restarted = yield* makeHarness({ baseDir: first.baseDir });
    expect((yield* restarted.installation.state).operationId).not.toBeNull();
    expect((yield* terminalState(restarted.installation)).phase).toBe("succeeded");
    expect((yield* restarted.installation.resolve()).version).toBe("0.156.1");
    expect(restarted.downloads()).toBe(1);
  }).pipe(Effect.scoped, Effect.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))),
);

it.effect("rejects corrupted downloads without publishing a runtime", () =>
  Effect.gen(function* () {
    const { installation, fs } = yield* makeHarness({
      options: { releaseAsset: { ...asset, sha256: "0".repeat(64) } },
    });
    yield* installation.start;
    const state = yield* terminalState(installation);
    expect(state.phase).toBe("failed");
    expect(state.message).toContain("SHA-256");
    expect(yield* fs.exists(`${installation.managedDirectory}/active.json`)).toBe(false);
    expect(yield* fs.exists(`${installation.managedDirectory}/0.156.1`)).toBe(false);
  }).pipe(Effect.scoped, Effect.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))),
);

it.effect.each(["interrupted body", "HTTP 404"] as const)(
  "reports a download failure for %s without blaming disk access",
  (failure) =>
    Effect.gen(function* () {
      const request = HttpClientRequest.get(asset.url);
      const response = HttpClientResponse.fromWeb(request, new Response(null));
      const h = yield* makeHarness(
        failure === "HTTP 404"
          ? { downloadStatus: 404 }
          : {
              body: Stream.concat(
                Stream.succeed(archive.subarray(0, 10)),
                Stream.fail(
                  new HttpClientError.HttpClientError({
                    reason: new HttpClientError.DecodeError({
                      request,
                      response,
                      cause: new TypeError("terminated"),
                    }),
                  }),
                ),
              ),
            },
      );
      yield* h.installation.start;
      expect(yield* terminalState(h.installation)).toMatchObject({
        phase: "failed",
        message:
          failure === "HTTP 404"
            ? "The Codex download server returned HTTP 404. Try again later."
            : "The Codex download was interrupted. Check your internet connection, then retry installation.",
      });
      expect(h.downloads()).toBe(1);
      expect(yield* h.fs.readDirectory(h.installation.managedDirectory)).toEqual([]);
    }).pipe(Effect.scoped, Effect.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))),
);

it.effect(
  "preserves the filesystem failure message when installation cannot create its directory",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "t3-codex-install-test-" });
      const baseDir = `${directory}/not-a-directory`;
      yield* fs.writeFileString(baseDir, "existing file");
      const h = yield* makeHarness({ baseDir });
      yield* h.installation.start;
      expect(yield* terminalState(h.installation)).toMatchObject({
        phase: "failed",
        message: "Could not install Codex. Check disk space and directory access, then try again.",
      });
      expect(h.downloads()).toBe(0);
      expect(yield* fs.readFileString(baseDir)).toBe("existing file");
    }).pipe(Effect.scoped, Effect.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))),
);

it.effect.each(["cached update", "reverify"] as const)(
  "reports a verification timeout during %s and preserves the managed runtime",
  (operation) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-codex-verify-test-" });
      const managed = `${baseDir}/tools/codex`;
      const installedVersion = operation === "cached update" ? "0.156.0" : asset.version;
      const target = "aarch64-pc-windows-msvc";
      const checksum = "a".repeat(64);
      for (const version of new Set([installedVersion, asset.version])) {
        const directory = `${managed}/${version}`;
        yield* fs.makeDirectory(`${directory}/bin`, { recursive: true });
        yield* fs.makeDirectory(`${directory}/codex-path`, { recursive: true });
        for (const name of ["bin/codex.exe", "bin/codex-code-mode-host.exe", "codex-path/rg.exe"]) {
          yield* fs.writeFileString(`${directory}/${name}`, "fixture executable");
        }
        yield* fs.writeFileString(
          `${directory}/codex-package.json`,
          JSON.stringify({ layoutVersion: 1, version, target, entrypoint: "bin/codex.exe" }),
        );
        yield* fs.writeFileString(
          `${directory}/.install-complete.json`,
          JSON.stringify({ version, target, sha256: checksum }),
        );
      }
      const pointer = JSON.stringify({ version: installedVersion });
      yield* fs.writeFileString(`${managed}/active.json`, pointer);
      const entered = yield* Deferred.make<void>();
      const h = yield* makeHarness({
        baseDir,
        platform: "win32",
        manifestCurrent: Effect.succeed({
          ...ModelManifest.BUNDLED_MODEL_MANIFEST,
          compatibility: [
            {
              driver: "codex",
              t3CodeRange: ">=0.0.0",
              ranges: [{ range: ">=0.156.0", status: "supported" }],
            },
          ],
        }),
        options: {
          releaseAsset: operation === "reverify" ? null : { ...asset, target, sha256: checksum },
          validate: () => Deferred.succeed(entered, undefined).pipe(Effect.andThen(Effect.never)),
        },
      });
      yield* h.installation.start;
      yield* Deferred.await(entered);
      yield* TestClock.adjust("90 seconds");
      expect(yield* terminalState(h.installation)).toMatchObject({
        phase: "failed",
        installedVersion,
        message:
          "Codex runtime verification timed out after 90 seconds. Check this environment's server logs for startup errors, then retry installation.",
      });
      expect(yield* fs.readFileString(`${managed}/active.json`)).toBe(pointer);
      expect((yield* h.installation.resolve()).version).toBe(installedVersion);
      expect(h.downloads()).toBe(0);
    }).pipe(Effect.scoped, Effect.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))),
);

it.effect("reports a download timeout and cleans the staging directory", () =>
  Effect.gen(function* () {
    const started = yield* Deferred.make<void>();
    const stall = Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never));
    const h = yield* makeHarness({
      body: Stream.concat(Stream.succeed(archive.subarray(0, 10)), Stream.fromEffect(stall)),
    });
    yield* h.installation.start;
    yield* Deferred.await(started);
    yield* TestClock.adjust("45 minutes");
    expect(yield* terminalState(h.installation)).toMatchObject({
      phase: "failed",
      message: "The Codex download timed out. Retry installation.",
    });
    expect(h.downloads()).toBe(1);
    expect(yield* h.fs.readDirectory(h.installation.managedDirectory)).toEqual([]);
  }).pipe(Effect.scoped, Effect.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))),
);

it.effect("cancels an in-flight download and cleans the staging directory", () =>
  Effect.gen(function* () {
    const downloading = yield* Deferred.make<void>();
    const body = Stream.fromEffect(
      Deferred.succeed(downloading, undefined).pipe(Effect.andThen(Effect.never)),
    );
    const { installation, fs } = yield* makeHarness({ body });
    const started = yield* installation.start;
    yield* Deferred.await(downloading);
    expect((yield* installation.cancel(started.operationId!)).phase).toBe("cancelled");
    expect(
      (yield* fs.readDirectory(installation.managedDirectory)).filter((name) =>
        name.startsWith(".install-"),
      ),
    ).toEqual([]);
    expect(yield* fs.exists(`${installation.managedDirectory}/active.json`)).toBe(false);
  }).pipe(Effect.scoped, Effect.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))),
);

it.effect("protects active process leases and removes the runtime after release", () =>
  Effect.gen(function* () {
    const { installation, fs } = yield* makeHarness();
    yield* installation.start;
    yield* terminalState(installation);
    const leaseScope = yield* Scope.make();
    yield* installation.acquire().pipe(Effect.provideService(Scope.Scope, leaseScope));
    expect((yield* Effect.flip(installation.remove())).detail).toContain("Stop Codex sessions");
    yield* Scope.close(leaseScope, Exit.void);
    yield* installation.remove();
    expect(yield* fs.exists(installation.managedDirectory)).toBe(false);
    expect((yield* installation.state).installedVersion).toBeNull();
    expect((yield* installation.state).executablePath).toBeNull();
  }).pipe(Effect.scoped, Effect.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))),
);

it.effect("keeps an activated runtime when a later update fails verification", () =>
  Effect.gen(function* () {
    const first = yield* makeHarness();
    yield* first.installation.start;
    yield* terminalState(first.installation);
    const update = yield* makeHarness({
      baseDir: first.baseDir,
      options: { releaseAsset: { ...asset, version: "0.156.2", sha256: "0".repeat(64) } },
    });
    expect((yield* update.installation.state).executablePath).toBe(
      (yield* first.installation.resolve()).executablePath,
    );
    yield* update.installation.start;
    expect((yield* terminalState(update.installation)).phase).toBe("failed");
    expect((yield* update.installation.resolve()).version).toBe("0.156.1");
  }).pipe(Effect.scoped, Effect.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))),
);

const upstreamVersion = "0.163.0";
const upstreamArchive = Buffer.from(
  windowsHost
    ? "H4sIALKyB2sAA+2XzW6EIBRG51EI6+pcUCHpg3SPDlHbDhhg/tL03SvT2LQmzSw6Sprcs4BICHxXcozUvdk2dqfPuT7rzTIAgJSSxH5k3kcqwqoCmCwYF5wAYwKKDYGF8vzg4INyY5S/rjMv7p9wPfvUIZBk1JP/WWyzfWw668M9Pwe3/S9n/pclSPR/DeJZp86ApOPT/UGFbuvahf4BbvvPZ/7zQnL0fw1cmzoBkpLJ/+ZFtTp/9tbcf4/RByHE7/6zSsz9FxzQ/zV4o6/qYg/hSTvfW0MfCXsg9Pj1RCFnosiBjqPji2p1iINKuaYTZTY02ak3O3vy2d4fmzhJm+Aug+3NdWL9/XpJ31NXiyAIgkx8AH9ARo4AFAAA"
    : "H4sIAAAAAAACA+3WzY7CIBQF4D5Kw1oqtNQmPoh7rKStP9BQdMaYefcBE43T9RQ1nm8B7Q1Jk94cYN3peW026juZDvOqsrzO3nj2yofnUK9KwZKUJREcByet/2TymabuPby29S3/NIz0EIbWDC5u/sXf/PO8EAL5j+G/ew1vuP/TXrp2bpunnf/5KP+syCvkP4bJmg5vlf96JxuVbQej4+efi2qUf17g/h/Hhezl2RzdStmhM5osUz5Lyen+RljGF0XGiK/6H9UoF4pS2rpdCCr7fq/oRtqvTocVSjt77k2nr6vud0vyg6ABAAAAAAAAAAAAAABE8gvVbjvaACgAAA==",
  "base64",
);
const upstreamReleaseUrl = `https://github.com/openai/codex/releases/download/rust-v${upstreamVersion}`;
const upstreamResponses = (checksum: string) => ({
  "https://registry.npmjs.org/@openai/codex/latest": () =>
    Response.json({ version: upstreamVersion }),
  [`${upstreamReleaseUrl}/codex-package_SHA256SUMS`]: () =>
    new Response(
      `${"0".repeat(64)}  codex-package-${otherHostTarget}.tar.gz\n${checksum}  codex-package-${hostTarget}.tar.gz\n`,
    ),
  [`${upstreamReleaseUrl}/codex-package-${hostTarget}.tar.gz`]: () => new Response(upstreamArchive),
});

it.effect("updates a managed install to OpenAI's newest release and never downgrades it", () =>
  Effect.gen(function* () {
    const digest = yield* Digest.Digest;
    const checksum = Hex.encode(
      yield* digest.digest(Digest.sha256, upstreamArchive).pipe(Effect.orDie),
    );
    const h = yield* makeHarness({ responses: upstreamResponses(checksum) });
    yield* h.installation.checkForUpdate;
    // A fresh install still gets the pinned release.
    expect((yield* h.installation.state).version).toBe("0.156.1");
    yield* h.installation.start;
    expect(yield* terminalState(h.installation)).toMatchObject({
      phase: "succeeded",
      installedVersion: "0.156.1",
      version: upstreamVersion,
    });

    const sessionScope = yield* Scope.make();
    const previous = yield* h.installation.acquire().pipe(Scope.provide(sessionScope));
    yield* h.installation.start;
    expect(yield* terminalState(h.installation)).toMatchObject({
      phase: "succeeded",
      installedVersion: upstreamVersion,
      version: upstreamVersion,
    });
    expect((yield* h.installation.resolve()).version).toBe(upstreamVersion);
    // The running session keeps its release until the next start prunes it.
    expect(yield* h.fs.exists(previous.managedVersionDirectory!)).toBe(true);
    yield* Scope.close(sessionScope, Exit.void);

    // Without upstream information the older pin is not offered as a reinstall.
    const restarted = yield* makeHarness({ baseDir: h.baseDir });
    expect(yield* h.fs.exists(previous.managedVersionDirectory!)).toBe(false);
    expect(yield* restarted.installation.state).toMatchObject({
      installedVersion: upstreamVersion,
      version: upstreamVersion,
    });
    yield* restarted.installation.start;
    expect(yield* terminalState(restarted.installation)).toMatchObject({
      phase: "succeeded",
      installedVersion: upstreamVersion,
    });
    expect(restarted.downloads()).toBe(0);
  }).pipe(Effect.scoped, Effect.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))),
);

it.effect("keeps the managed install when an update fails its published checksum", () =>
  Effect.gen(function* () {
    const h = yield* makeHarness({ responses: upstreamResponses("f".repeat(64)) });
    yield* h.installation.start;
    yield* terminalState(h.installation);
    yield* h.installation.checkForUpdate;
    yield* h.installation.start;
    expect(yield* terminalState(h.installation)).toMatchObject({
      phase: "failed",
      installedVersion: "0.156.1",
      message: expect.stringContaining("SHA-256"),
    });
    expect((yield* h.installation.resolve()).version).toBe("0.156.1");
  }).pipe(Effect.scoped, Effect.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))),
);

it.effect("does not install a cached update the manifest has since withdrawn", () =>
  Effect.gen(function* () {
    const digest = yield* Digest.Digest;
    const checksum = Hex.encode(
      yield* digest.digest(Digest.sha256, upstreamArchive).pipe(Effect.orDie),
    );
    let manifest = ModelManifest.BUNDLED_MODEL_MANIFEST;
    const h = yield* makeHarness({
      responses: upstreamResponses(checksum),
      manifestCurrent: Effect.sync(() => manifest),
    });
    yield* h.installation.start;
    yield* terminalState(h.installation);
    yield* h.installation.checkForUpdate;
    expect((yield* h.installation.state).version).toBe(upstreamVersion);
    manifest = {
      ...manifest,
      compatibility: [
        {
          driver: "codex",
          t3CodeRange: ">=0.0.42",
          ranges: [
            { range: ">=0.160.0", status: "unsupported" },
            { range: ">=0.156.0 <0.160.0", status: "supported" },
          ],
        },
      ],
    };
    const downloads = h.downloads();
    yield* h.installation.start;
    expect(yield* terminalState(h.installation)).toMatchObject({
      phase: "succeeded",
      installedVersion: "0.156.1",
      version: "0.156.1",
    });
    expect(h.downloads()).toBe(downloads);
    expect((yield* h.installation.resolve()).version).toBe("0.156.1");
  }).pipe(Effect.scoped, Effect.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))),
);

it.effect("returns a managed install the manifest withdraws to the pinned release", () =>
  Effect.gen(function* () {
    const digest = yield* Digest.Digest;
    const checksum = Hex.encode(
      yield* digest.digest(Digest.sha256, upstreamArchive).pipe(Effect.orDie),
    );
    let manifest = ModelManifest.BUNDLED_MODEL_MANIFEST;
    const h = yield* makeHarness({
      responses: upstreamResponses(checksum),
      manifestCurrent: Effect.sync(() => manifest),
    });
    yield* h.installation.checkForUpdate;
    yield* h.installation.start;
    yield* terminalState(h.installation);
    yield* h.installation.start;
    expect(yield* terminalState(h.installation)).toMatchObject({
      installedVersion: upstreamVersion,
    });

    manifest = {
      ...manifest,
      compatibility: [
        {
          driver: "codex",
          t3CodeRange: ">=0.0.42",
          ranges: [
            { range: ">=0.160.0", status: "unsupported" },
            { range: ">=0.156.0 <0.160.0", status: "supported" },
          ],
        },
      ],
    };
    yield* h.installation.checkForUpdate;
    expect(yield* h.installation.state).toMatchObject({
      installedVersion: upstreamVersion,
      version: "0.156.1",
    });
    yield* h.installation.start;
    expect(yield* terminalState(h.installation)).toMatchObject({
      phase: "succeeded",
      installedVersion: "0.156.1",
      version: "0.156.1",
    });
    expect((yield* h.installation.resolve()).version).toBe("0.156.1");
  }).pipe(Effect.scoped, Effect.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))),
);

it.effect.each(["update", "reinstall"] as const)(
  "rejects withdrawal during $0 validation",
  (operation) =>
    Effect.gen(function* () {
      const digest = yield* Digest.Digest;
      const checksum = Hex.encode(
        yield* digest.digest(Digest.sha256, upstreamArchive).pipe(Effect.orDie),
      );
      let manifest = ModelManifest.BUNDLED_MODEL_MANIFEST;
      let withdraw = operation === "update";
      const h = yield* makeHarness({
        responses: upstreamResponses(checksum),
        manifestCurrent: Effect.sync(() => manifest),
        options: {
          validate: (_executable, version) =>
            Effect.sync(() => {
              if (withdraw && version === upstreamVersion)
                manifest = {
                  ...ModelManifest.BUNDLED_MODEL_MANIFEST,
                  compatibility: [
                    {
                      driver: "codex",
                      t3CodeRange: ">=0.0.42",
                      ranges: [
                        { range: ">=0.160.0", status: "unsupported" },
                        { range: ">=0.156.0 <0.160.0", status: "supported" },
                      ],
                    },
                  ],
                };
            }),
        },
      });
      yield* h.installation.start;
      yield* terminalState(h.installation);
      yield* h.installation.checkForUpdate;
      if (operation === "reinstall") {
        yield* h.installation.start;
        expect((yield* terminalState(h.installation)).phase).toBe("succeeded");
        withdraw = true;
      }
      yield* h.installation.start;
      expect((yield* terminalState(h.installation)).phase).toBe("failed");
      if (operation === "update") {
        expect((yield* h.installation.resolve()).version).toBe("0.156.1");
      } else {
        expect((yield* h.installation.state).version).toBe("0.156.1");
        yield* Effect.flip(h.installation.resolve());
      }
    }).pipe(Effect.scoped, Effect.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))),
);
