import type { AntigravityAuthMethod } from "@t3tools/contracts";
import { collectUint8StreamText } from "@t3tools/provider-core/server/collectStreamText";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import { linkEntry } from "../fileLinks.ts";
import { antigravityCliEnvironment } from "./antigravityAuthSupport.ts";

export class AntigravityCliUsageError extends Schema.TaggedError<AntigravityCliUsageError>()(
  "AntigravityCliUsageError",
  { reason: Schema.Literals(["signed-out", "failed"]), cause: Schema.optional(Schema.Defect()) },
) {
  override get message(): string {
    return this.reason === "signed-out"
      ? "Antigravity's saved sign-in has expired."
      : "Could not run Antigravity's /usage.";
  }
}

const isUsageError = Schema.is(AntigravityCliUsageError);
const failed = (cause: unknown) =>
  isUsageError(cause) ? cause : new AntigravityCliUsageError({ reason: "failed", cause });

/**
 * Runs `agy --print /usage --output-format json` on one profile and returns its stdout. agy answers
 * the command itself, with no model turn, and T3 never reads the sign-in it uses.
 */
export const runAntigravityCliUsage = Effect.fn("runAntigravityCliUsage")(
  function* (input: {
    readonly executablePath: string;
    readonly acpDirectory: string;
    readonly baseEnv: NodeJS.ProcessEnv;
    readonly authMethod: AntigravityAuthMethod;
  }) {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const platform = yield* HostProcess.Platform;
    const home = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-antigravity-usage-" });
    const geminiDirectory = path.join(home, ".gemini");
    yield* fileSystem.makeDirectory(geminiDirectory);
    const profileLink = path.join(geminiDirectory, "antigravity-cli");
    yield* linkEntry(fileSystem, input.acpDirectory, profileLink);
    // Unlink before the temp home is removed, so that removal can never reach the profile.
    yield* Effect.addFinalizer(() => fileSystem.remove(profileLink).pipe(Effect.ignore));
    const child = yield* spawner.spawn(
      ChildProcess.make(
        input.executablePath,
        ["--print", "/usage", "--output-format", "json", "--print-timeout", "15s"],
        {
          cwd: home,
          env: antigravityCliEnvironment({
            baseEnv: input.baseEnv,
            home,
            platform,
            authMethod: input.authMethod,
          }),
          extendEnv: false,
          shell: false,
        },
      ),
    );
    yield* Stream.empty.pipe(Stream.run(child.stdin), Effect.ignore, Effect.forkScoped);
    // Signed out, agy prints a sign-in link and waits a minute for a code; stop at once instead.
    const [stdout] = yield* Effect.all(
      [
        collectUint8StreamText({ stream: child.stdout, maxBytes: 256 * 1024 }),
        child.stderr.pipe(
          Stream.decodeText(),
          Stream.splitLines,
          Stream.runForEach((line) =>
            /authentication required/i.test(line)
              ? Effect.fail(new AntigravityCliUsageError({ reason: "signed-out" }))
              : Effect.void,
          ),
        ),
        child.exitCode,
      ],
      { concurrency: "unbounded" },
    );
    return stdout.text;
  },
  Effect.scoped,
  Effect.mapError(failed),
  Effect.timeoutOrElse({
    duration: "25 seconds",
    orElse: () => Effect.fail(new AntigravityCliUsageError({ reason: "failed" })),
  }),
);
