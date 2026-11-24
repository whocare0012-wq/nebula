import {
  ProviderSetupError,
  type ProviderAuthMethod,
  type ProviderInstanceId,
} from "@t3tools/contracts";
import { codexAuthorizationRequest, codexCallbackUrl } from "@t3tools/shared/codexAuthHandoff";
import * as ProviderAuthFlow from "@t3tools/provider-core/server/providerAuthFlow";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import type * as Scope from "effect/Scope";
import { HttpClient } from "effect/http";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import { withCodexAppServerClient } from "./CodexProvider.ts";
import { resolveCodexLaunchArgs } from "./codexLaunchArgs.ts";
import type { CodexEffectiveRuntime } from "./CodexManagedRuntime.ts";

const NATIVE_CODEX_AUTH_METHODS: ReadonlyArray<ProviderAuthMethod> = [
  {
    id: "chatgpt",
    name: "ChatGPT",
    description: null,
    type: "agent",
  },
  {
    id: "chatgpt-change-account",
    name: "ChatGPT",
    description: null,
    type: "agent",
  },
];

export function resolveNativeCodexCallbackForwardUrl(
  authorizationUrl: string,
  callbackUrl: string,
): string {
  try {
    const request = codexAuthorizationRequest(authorizationUrl);
    return codexCallbackUrl(callbackUrl, request.redirectUri, request.state).toString();
  } catch {
    const authParsed = new URL(authorizationUrl);
    const redirectUri = authParsed.searchParams.get("redirect_uri");
    const expectedState = authParsed.searchParams.get("state");
    if (!redirectUri) {
      throw new Error("Invalid ChatGPT sign-in request.");
    }
    const redirect = new URL(redirectUri);
    const trimmed = callbackUrl.trim();
    const candidate = new URL(/^https?:\/\//iu.test(trimmed) ? trimmed : `http://${trimmed}`);
    const isLoopback = (host: string) => host === "127.0.0.1" || host === "localhost";
    if (
      redirect.protocol !== "http:" ||
      !isLoopback(redirect.hostname) ||
      !redirect.port ||
      candidate.protocol !== "http:" ||
      !isLoopback(candidate.hostname) ||
      candidate.port !== redirect.port ||
      candidate.pathname !== redirect.pathname ||
      candidate.username ||
      candidate.password ||
      (expectedState && candidate.searchParams.get("state") !== expectedState)
    ) {
      throw new Error("This redirect URL does not belong to the current sign-in.");
    }
    return new URL(`${candidate.pathname}${candidate.search}`, redirect.origin).toString();
  }
}

// Codex's authorize URL reuses the browser's OpenAI session; changing accounts must ask for a fresh login.
export function nativeCodexSignInUrl(authUrl: string, methodId: string): string {
  if (methodId !== "chatgpt-change-account") return authUrl;
  const url = new URL(authUrl);
  url.searchParams.set("prompt", "login");
  return url.toString();
}

export const makeCodexNativeAuth = Effect.fn("makeCodexNativeAuth")(function* (options: {
  readonly instanceId: ProviderInstanceId;
  readonly homePath: string;
  readonly resolveRuntime: Effect.Effect<CodexEffectiveRuntime, ProviderSetupError, Scope.Scope>;
}) {
  const http = yield* HttpClient.HttpClient;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const failure = (operation: string, detail: string) =>
    new ProviderSetupError({ instanceId: options.instanceId, operation, detail });

  const controller = yield* ProviderAuthFlow.make({
    instanceId: options.instanceId,
    credentialBinding: { owner: "provider", key: options.homePath },
    methods: Effect.succeed(NATIVE_CODEX_AUTH_METHODS),
    defaultMethodId: "chatgpt",
    authenticate: Effect.fn("CodexNativeAuth.authenticate")(function* (methodId, context) {
      const effective = yield* options.resolveRuntime;
      const completed = yield* Deferred.make<{
        readonly success: boolean;
        readonly error?: string | null;
      }>();
      let expectedLoginId: string | undefined;

      const { client } = yield* withCodexAppServerClient({
        binaryPath: effective.config.binaryPath,
        homePath: effective.config.homePath,
        launchArgs: resolveCodexLaunchArgs(effective.config.launchArgs, effective.environment),
        cwd: process.cwd(),
        environment: effective.environment,
      }).pipe(
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        Effect.provideService(FileSystem.FileSystem, fs),
        Effect.provideService(Path.Path, path),
        Effect.mapError((cause) =>
          failure("start", `Could not start Codex sign-in: ${cause.message}`),
        ),
      );

      yield* client.handleServerNotification("account/login/completed", (payload) =>
        !expectedLoginId || !payload.loginId || payload.loginId === expectedLoginId
          ? Deferred.succeed(completed, payload).pipe(Effect.asVoid)
          : Effect.void,
      );

      const started = yield* client
        .request("account/login/start", { type: "chatgpt" })
        .pipe(
          Effect.mapError((cause) =>
            failure("start", `Could not start ChatGPT sign-in: ${cause.message}`),
          ),
        );

      if (started.type !== "chatgpt") {
        return yield* failure("start", "Codex returned an unexpected sign-in response.");
      }
      expectedLoginId = started.loginId;

      const completeCallback = (callbackUrl: string) =>
        Effect.try({
          try: () => resolveNativeCodexCallbackForwardUrl(started.authUrl, callbackUrl),
          catch: (cause) =>
            failure(
              "complete",
              cause instanceof Error
                ? cause.message
                : "This redirect URL does not belong to the current sign-in.",
            ),
        }).pipe(
          Effect.flatMap((forwardUrl) =>
            http.get(forwardUrl).pipe(
              Effect.asVoid,
              Effect.mapError(() =>
                failure(
                  "complete",
                  "Could not deliver the sign-in callback to Codex. Start sign-in again.",
                ),
              ),
            ),
          ),
        );

      yield* context.setInteraction(
        {
          type: "browser",
          id: started.loginId,
          url: nativeCodexSignInUrl(started.authUrl, methodId),
          requiresConsent: false,
          acceptsCallback: true,
        },
        undefined,
        completeCallback,
      );

      const outcome = yield* Effect.raceFirst(
        Deferred.await(completed),
        client.awaitTermination.pipe(
          Effect.mapError((cause) =>
            failure("authenticate", `Codex exited before sign-in finished: ${cause.message}`),
          ),
        ),
      );

      if (!outcome.success) {
        return yield* failure(
          "authenticate",
          outcome.error?.trim() || "ChatGPT sign-in did not complete. Try again.",
        );
      }

      yield* context.verifying;
    }),
    logout: Effect.gen(function* () {
      yield* options.resolveRuntime.pipe(
        Effect.flatMap((effective) =>
          withCodexAppServerClient({
            binaryPath: effective.config.binaryPath,
            homePath: effective.config.homePath,
            launchArgs: resolveCodexLaunchArgs(effective.config.launchArgs, effective.environment),
            cwd: process.cwd(),
            environment: effective.environment,
          }).pipe(
            Effect.flatMap(({ client }) => client.request("account/logout", undefined)),
            Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
            Effect.provideService(FileSystem.FileSystem, fs),
            Effect.provideService(Path.Path, path),
          ),
        ),
        Effect.scoped,
        Effect.timeoutOption("10 seconds"),
        Effect.ignore,
      );
      yield* fs
        .remove(path.join(options.homePath, "auth.json"), { force: true })
        .pipe(Effect.ignore);
      yield* fs
        .remove(path.join(options.homePath, "auth.lock"), { force: true })
        .pipe(Effect.ignore);
    }),
  });

  return { controller };
});
