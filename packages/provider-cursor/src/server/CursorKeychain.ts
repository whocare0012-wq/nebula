// Remote clients cannot answer macOS prompts; time out reads but retain the in-flight request for reuse.
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import { collectUint8StreamText } from "@t3tools/provider-core/server/collectStreamText";

import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";

import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

const CACHE_MS = 5 * 60_000;
const DEFAULT_TIMEOUT = Duration.seconds(30);

export class CursorKeychainTimeoutError extends Schema.TaggedError<CursorKeychainTimeoutError>()(
  "CursorKeychainTimeoutError",
  {},
) {
  override get message(): string {
    return "Timed out waiting for Keychain access.";
  }
}

export const isCursorKeychainTimeoutError = Schema.is(CursorKeychainTimeoutError);

export class CursorKeychainReadError extends Schema.TaggedError<CursorKeychainReadError>()(
  "CursorKeychainReadError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "Cursor Keychain credentials could not be read.";
  }
}

export class CursorKeychain extends Context.Service<
  CursorKeychain,
  {
    readonly accessToken: Effect.Effect<
      string | null,
      CursorKeychainTimeoutError | CursorKeychainReadError
    >;
  }
>()("@t3tools/provider-cursor/server/CursorKeychain") {}

export const make = Effect.gen(function* () {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const read = Effect.gen(function* () {
    const child = yield* spawner.spawn(
      ChildProcess.make(
        "/usr/bin/security",
        ["find-generic-password", "-s", "cursor-access-token", "-a", "cursor-user", "-w"],
        { forceKillAfter: "1 second", stderr: "ignore" },
      ),
    );
    const [stdout, code] = yield* Effect.all(
      [collectUint8StreamText({ stream: child.stdout, maxBytes: 65536 }), child.exitCode],
      { concurrency: "unbounded" },
    );
    if (Number(code) === 44) return null;
    if (Number(code) !== 0 || stdout.truncated || stdout.invalidUtf8) {
      return yield* new CursorKeychainReadError({
        cause: new Error("Cursor Keychain access failed"),
      });
    }
    return stdout.text.trim() || null;
  }).pipe(
    Effect.scoped,
    Effect.timeout(DEFAULT_TIMEOUT),
    Effect.mapError((cause) => new CursorKeychainReadError({ cause })),
  );
  const timeout = DEFAULT_TIMEOUT;
  let cached: { readonly token: string; readonly untilMs: number } | null = null;
  let pending: Deferred.Deferred<string | null, CursorKeychainReadError> | null = null;

  const startRead = Effect.uninterruptible(
    Effect.gen(function* () {
      if (pending !== null) return pending;
      const done = Deferred.makeUnsafe<string | null, CursorKeychainReadError>();
      pending = done;
      yield* read.pipe(
        Effect.tap((token) =>
          Clock.currentTimeMillis.pipe(
            Effect.map((nowMs) => {
              cached = token ? { token, untilMs: nowMs + CACHE_MS } : null;
            }),
          ),
        ),
        Effect.onExit((exit) =>
          Effect.suspend(() => {
            pending = null;
            return Deferred.done(done, exit);
          }),
        ),
        Effect.forkDetach,
      );
      return done;
    }),
  );

  const accessToken = Effect.gen(function* () {
    const nowMs = yield* Clock.currentTimeMillis;
    if (cached !== null && cached.untilMs > nowMs) return cached.token;
    const done = yield* startRead;
    const token = yield* Deferred.await(done).pipe(Effect.timeoutOption(timeout));
    if (Option.isNone(token)) return yield* new CursorKeychainTimeoutError();
    return token.value;
  });

  return CursorKeychain.of({ accessToken });
});
