import { SpawnExecutableResolution } from "@t3tools/shared/shell";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

// The Codex desktop app ships as an MSIX package: its bundled CLI lives under
// C:\Program Files\WindowsApps, which is not on PATH and cannot be listed. Windows does expose
// app-execution aliases in %LOCALAPPDATA%\Microsoft\WindowsApps whose link target names the
// current package directory, so the CLI can be found next to them.
const DESKTOP_ALIASES: ReadonlyArray<{
  readonly alias: string;
  readonly cli: ReadonlyArray<string>;
}> = [
  { alias: "chatgpt-desktop.exe", cli: ["resources", "codex.exe"] },
  { alias: "codex-core-command-runner.exe", cli: ["codex.exe"] },
];

/**
 * On Windows, for the bare default `codex` with nothing on PATH, use the managed Codex (so every
 * account runs one version), else the desktop app's bundled CLI, which only that app can update.
 * Anything else is returned as is.
 */
export const resolveCodexDesktopBinary = Effect.fn("resolveCodexDesktopBinary")(function* (input: {
  readonly binaryPath: string;
  readonly platform: NodeJS.Platform;
  readonly env: NodeJS.ProcessEnv;
  /** The managed Codex executable, if one is installed; looked up only when it would be used. */
  readonly managed?: Effect.Effect<Option.Option<string>>;
}) {
  const { binaryPath, platform, env } = input;
  const localAppData = env.LOCALAPPDATA?.trim();
  if (platform !== "win32" || binaryPath.trim() !== "codex" || !localAppData) return binaryPath;

  const resolveExecutable = yield* SpawnExecutableResolution;
  const onPath = yield* Effect.promise(async () => {
    try {
      return await resolveExecutable("codex", platform, env);
    } catch {
      return undefined;
    }
  });
  if (onPath !== undefined) return binaryPath;
  if (input.managed !== undefined) {
    const managed = yield* input.managed;
    if (Option.isSome(managed)) return managed.value;
  }

  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const aliasDirectory = path.join(localAppData, "Microsoft", "WindowsApps");
  for (const { alias, cli } of DESKTOP_ALIASES) {
    const target = yield* fileSystem
      .readLink(path.join(aliasDirectory, alias))
      .pipe(Effect.orElseSucceed(() => undefined));
    if (!target) continue;
    const candidate = path.join(path.dirname(target), ...cli);
    const isFile = yield* fileSystem.stat(candidate).pipe(
      Effect.map((info) => info.type === "File"),
      Effect.orElseSucceed(() => false),
    );
    if (isFile) return candidate;
  }
  return binaryPath;
});
