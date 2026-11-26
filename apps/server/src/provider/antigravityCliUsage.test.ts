import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import { runAntigravityCliUsage } from "./antigravityCliUsage.ts";

const fakeAgy = (
  onSpawn: (command: ChildProcess.StandardCommand) => Effect.Effect<{
    readonly stdout?: string;
    readonly stderr?: string;
    readonly exits?: boolean;
  }>,
) =>
  ChildProcessSpawner.make((command) =>
    Effect.gen(function* () {
      if (!ChildProcess.isStandardCommand(command)) return yield* Effect.die("Unexpected pipeline");
      const result = yield* onSpawn(command);
      const text = (value: string | undefined) =>
        value === undefined ? Stream.empty : Stream.make(new TextEncoder().encode(value));
      return ChildProcessSpawner.makeHandle({
        pid: ChildProcessSpawner.ProcessId(1),
        // A signed-out agy waits for a pasted code; the run must not wait for it to exit.
        exitCode:
          result.exits === false ? Effect.never : Effect.succeed(ChildProcessSpawner.ExitCode(0)),
        isRunning: Effect.succeed(false),
        kill: () => Effect.void,
        unref: Effect.succeed(Effect.void),
        stdin: Sink.drain,
        stdout: text(result.stdout),
        stderr: text(result.stderr),
        all: Stream.empty,
        getInputFd: () => Sink.drain,
        getOutputFd: () => Stream.empty,
      });
    }),
  );

const makeProfile = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const profile = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-agy-usage-test-" });
  const acpDirectory = path.join(profile, "antigravity-acp");
  yield* fileSystem.makeDirectory(acpDirectory);
  yield* fileSystem.writeFileString(path.join(acpDirectory, "settings.json"), "profile");
  return acpDirectory;
});

describe("runAntigravityCliUsage", () => {
  it.effect("runs agy's /usage on the account's own profile and leaves the profile intact", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const acpDirectory = yield* makeProfile;
      let home = "";
      const stdout = yield* runAntigravityCliUsage({
        executablePath: "agy",
        acpDirectory,
        baseEnv: { PATH: "bin", HOME: "real-home", USERPROFILE: "real-home", BROWSER: "open" },
        authMethod: "oauth-personal",
      }).pipe(
        Effect.provideService(
          ChildProcessSpawner.ChildProcessSpawner,
          fakeAgy((command) =>
            Effect.gen(function* () {
              expect(command.args).toEqual([
                "--print",
                "/usage",
                "--output-format",
                "json",
                "--print-timeout",
                "15s",
              ]);
              const env = command.options.env ?? {};
              home = typeof env.HOME === "string" ? env.HOME : "";
              expect(home).not.toBe("real-home");
              expect(env.BROWSER).toBeUndefined();
              expect(env.SSH_CONNECTION).toBeDefined();
              const settings = path.join(home, ".gemini", "antigravity-cli", "settings.json");
              expect(yield* fileSystem.readFileString(settings).pipe(Effect.orDie)).toBe("profile");
              return { stdout: '{"command":{"name":"usage"}}' };
            }),
          ),
        ),
      );
      expect(stdout).toBe('{"command":{"name":"usage"}}');
      expect(yield* fileSystem.exists(home)).toBe(false);
      expect(yield* fileSystem.readFileString(path.join(acpDirectory, "settings.json"))).toBe(
        "profile",
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("stops as soon as agy asks to sign in, without waiting for a code", () =>
    Effect.gen(function* () {
      const acpDirectory = yield* makeProfile;
      const exit = yield* runAntigravityCliUsage({
        executablePath: "agy",
        acpDirectory,
        baseEnv: {},
        authMethod: "oauth-personal",
      }).pipe(
        Effect.provideService(
          ChildProcessSpawner.ChildProcessSpawner,
          fakeAgy(() =>
            Effect.succeed({
              stderr: "Authentication required. Please visit the URL to log in:\n",
              exits: false,
            }),
          ),
        ),
        Effect.exit,
      );
      expect(Exit.isFailure(exit)).toBe(true);
      expect(Exit.isFailure(exit) && JSON.stringify(exit.cause)).toContain("signed-out");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
