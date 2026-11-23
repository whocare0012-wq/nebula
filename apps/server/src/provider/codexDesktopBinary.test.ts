import { describe, expect, it } from "@effect/vitest";
import { SpawnExecutableResolution } from "@t3tools/shared/shell";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";

import { resolveCodexDesktopBinary } from "./codexDesktopBinary.ts";

const env = { LOCALAPPDATA: "/Users/me/AppData/Local", PATH: "" };
const packageApp = "/Program Files/WindowsApps/OpenAI.Codex_26.1117.3838.0_x64__2p2nqsd0c76g0/app";
const missing = (method: string) =>
  Effect.fail(PlatformError.systemError({ _tag: "NotFound", module: "FileSystem", method }));

function resolve(input: {
  readonly binaryPath?: string;
  readonly platform?: NodeJS.Platform;
  readonly links: Record<string, string>;
  readonly files: ReadonlyArray<string>;
  readonly onPath?: string;
}) {
  const fileSystem = FileSystem.layerNoop({
    readLink: (path) =>
      path in input.links ? Effect.succeed(input.links[path]!) : missing("readLink"),
    stat: (path) =>
      input.files.includes(path)
        ? Effect.succeed({ type: "File" } as FileSystem.File.Info)
        : missing("stat"),
  });
  return resolveCodexDesktopBinary({
    binaryPath: input.binaryPath ?? "codex",
    platform: input.platform ?? "win32",
    env,
  }).pipe(
    Effect.provideService(SpawnExecutableResolution, () => input.onPath),
    Effect.provide(Layer.merge(fileSystem, Path.layer)),
  );
}

const aliases = "/Users/me/AppData/Local/Microsoft/WindowsApps";

describe("resolveCodexDesktopBinary", () => {
  it.effect("uses the CLI bundled with the Codex desktop app when codex is not on PATH", () =>
    Effect.gen(function* () {
      const binary = yield* resolve({
        links: { [`${aliases}/chatgpt-desktop.exe`]: `${packageApp}/ChatGPT.exe` },
        files: [`${packageApp}/resources/codex.exe`],
      });
      expect(binary).toBe(`${packageApp}/resources/codex.exe`);
    }),
  );

  it.effect("falls back to the command-runner alias", () =>
    Effect.gen(function* () {
      const binary = yield* resolve({
        links: {
          [`${aliases}/codex-core-command-runner.exe`]: `${packageApp}/resources/codex-command-runner.exe`,
        },
        files: [`${packageApp}/resources/codex.exe`],
      });
      expect(binary).toBe(`${packageApp}/resources/codex.exe`);
    }),
  );

  it.effect("keeps codex when it resolves on PATH, a custom path, or another platform", () =>
    Effect.gen(function* () {
      const desktop = {
        links: { [`${aliases}/chatgpt-desktop.exe`]: `${packageApp}/ChatGPT.exe` },
        files: [`${packageApp}/resources/codex.exe`],
      };
      expect(yield* resolve({ ...desktop, onPath: "/npm/codex.cmd" })).toBe("codex");
      expect(yield* resolve({ ...desktop, binaryPath: "/tools/codex.exe" })).toBe(
        "/tools/codex.exe",
      );
      expect(yield* resolve({ ...desktop, platform: "darwin" })).toBe("codex");
      expect(yield* resolve({ links: {}, files: [] })).toBe("codex");
    }),
  );
});
