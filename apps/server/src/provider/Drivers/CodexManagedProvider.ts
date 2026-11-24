import { ProviderDriverKind, TextGenerationError, type CodexSettings } from "@t3tools/contracts";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";
import * as Option from "effect/Option";
import { ChildProcessSpawner } from "effect/process";
import { makeCodexTextGeneration } from "../../textGeneration/CodexTextGeneration.ts";
import * as ModelCatalog from "@t3tools/provider-core/server/ModelCatalog";
import * as ProviderHost from "@t3tools/provider-core/server/ProviderHost";
import { makeCodexManagedRuntime } from "../CodexManagedRuntime.ts";
import { ProviderDriverError } from "../Errors.ts";
import * as ResetCreditCoordinator from "../resetCreditCoordinator.ts";
import { createCodexAdapterV2 } from "../../orchestration-v2/Adapters/CodexAdapterV2.ts";
import {
  checkCodexProviderStatus,
  makePendingCodexProvider,
  probeCodexSkillsForCwd,
  withCodexAppServerClient,
} from "../CodexProvider.ts";
import { applyCodexModelCatalog } from "../codexModelCatalog.ts";
import { resolveCodexLaunchArgs } from "../codexLaunchArgs.ts";
import { makeManagedServerProvider } from "@t3tools/provider-core/server/managedProvider";
import { mergeProviderInstanceEnvironment } from "@t3tools/provider-core/server/instanceEnvironment";
import {
  type ProviderDriverCreateInput,
  type ProviderInstance,
} from "@t3tools/provider-core/server/driver";
import { codexContinuationIdentity } from "./CodexHomeLayout.ts";
import { withInstanceIdentity } from "@t3tools/provider-core/server/instanceIdentity";

const DRIVER = ProviderDriverKind.make("codex");

export const makeManagedCodexProvider = Effect.fn("makeManagedCodexProvider")(function* (
  input: ProviderDriverCreateInput<CodexSettings>,
) {
  const { instanceId, enabled, displayName, accentColor, config } = input;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const host = yield* ProviderHost.ProviderHost;
  const modelCatalog = yield* ModelCatalog.ModelCatalog;
  const resetCreditCoordinator = yield* ResetCreditCoordinator.ResetCreditCoordinator;
  const currentCatalog = modelCatalog.current(DRIVER);
  const runtime = yield* makeCodexManagedRuntime({
    instanceId,
    enabled,
    config,
    environment: yield* mergeProviderInstanceEnvironment(input.environment),
  });
  const continuationIdentity = codexContinuationIdentity(runtime.homeLayout);
  const stamp = withInstanceIdentity({
    instanceId,
    driverKind: DRIVER,
    displayName,
    accentColor,
    continuationGroupKey: continuationIdentity.continuationKey,
  });
  const setup = { canAuthenticate: true, canInstall: true };
  const runtimePaths = {
    homePath: runtime.homeLayout.sharedHomePath,
    shadowHomePath: runtime.homeLayout.mode === "authOverlay" ? runtime.homePath : null,
  };
  const pending = makePendingCodexProvider({ ...config, enabled, customModels: [] }).pipe(
    Effect.map((draft) =>
      stamp({
        ...draft,
        models: [],
        setup,
        runtimePaths,
      }),
    ),
  );
  const check = Effect.gen(function* () {
    const base = yield* pending;
    if (!enabled) return base;
    const executable = yield* runtime.installation.resolve().pipe(Effect.option);
    if (Option.isNone(executable))
      return {
        ...base,
        installed: false,
        models: [],
        message: "Set up Codex to get started.",
        auth: { status: "unauthenticated" as const },
      };
    return yield* runtime.auth.controller.withAccess!(runtime.resolve).pipe(
      Effect.flatMap((effective) =>
        modelCatalog.refreshInBackground.pipe(
          Effect.andThen(
            Effect.zipWith(
              checkCodexProviderStatus(effective.config, undefined, effective.environment),
              currentCatalog,
              (draft, catalog) => applyCodexModelCatalog(draft, catalog),
              { concurrent: true },
            ),
          ),
        ),
      ),
      Effect.map((draft) => {
        if (draft.auth.status === "unauthenticated") {
          const { usageLimits: _unusedLimits, ...withoutLimits } = draft;
          return stamp({
            ...withoutLimits,
            installed: true,
            version: draft.version ?? executable.value.version,
            status: "warning",
            models: [],
            message: "Sign in with ChatGPT to use Codex.",
            auth: { status: "unauthenticated" as const, label: "ChatGPT" },
            setup,
            runtimePaths,
          });
        }
        return stamp({
          ...draft,
          auth: {
            ...draft.auth,
            ...(draft.auth.status === "authenticated" ? { canLogout: true } : {}),
          },
          version: draft.version ?? executable.value.version,
          setup,
          runtimePaths,
        });
      }),
      Effect.orElseSucceed(() =>
        stamp({
          ...base,
          installed: true,
          version: executable.value.version,
          models: [],
          auth: { status: "unknown" as const, label: "ChatGPT" },
          message: "Could not check Codex right now. Retry, or reconnect in provider settings.",
          setup,
          runtimePaths,
        }),
      ),
      Effect.scoped,
    );
  }).pipe(
    Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
    Effect.provideService(FileSystem.FileSystem, fileSystem),
    Effect.provideService(Path.Path, path),
  );
  const snapshot = yield* makeManagedServerProvider({
    resolveMaintenance: () => Effect.succeed({ provider: DRIVER, packageName: null, update: null }),
    getSettings: host.settings.get,
    streamSettings: host.settings.changes,
    haveSettingsChanged: () => false,
    initialSnapshot: () => pending,
    checkProvider: check,
  }).pipe(
    Effect.mapError(
      (cause) =>
        new ProviderDriverError({
          driver: DRIVER,
          instanceId,
          detail: "Could not prepare managed Codex.",
          cause,
        }),
    ),
  );
  yield* runtime.auth.controller.subscribe("managed-codex-snapshot").pipe(
    Stream.filter((state) => ["idle", "succeeded", "failed", "cancelled"].includes(state.phase)),
    // Sign-out interrupts in-flight probes; keep listening for its subsequent idle refresh.
    Stream.runForEach(() => snapshot.refresh.pipe(Effect.ignoreCause({ log: true }))),
    Effect.forkScoped,
  );
  if (enabled) {
    yield* fileSystem.watch(runtime.homePath).pipe(
      Stream.filter((event) => path.basename(event.path) === "auth.json"),
      Stream.debounce(Duration.millis(250)),
      Stream.runForEach(() => snapshot.refresh.pipe(Effect.ignoreCause({ log: true }))),
      Effect.catchReason("PlatformError", "NotFound", () => Effect.void),
      Effect.ignoreCause({ log: true }),
      Effect.forkScoped,
    );
  }
  const resolveRuntime = runtime.auth.controller.withAccess!(runtime.resolve);
  // The registry already wraps openSession in withAccess, so resolve without re-entering it.
  const models = snapshot.getSnapshot.pipe(Effect.map((value) => value.models));
  const orchestrationAdapter = yield* createCodexAdapterV2(input, {
    onUsageLimits: (update) => snapshot.applyUsageLimits(update),
    models,
    resolveRuntime: runtime.resolve,
    compatibility: runtime.installation.compatibility,
  }).pipe(
    Effect.mapError(
      (cause) =>
        new ProviderDriverError({
          driver: DRIVER,
          instanceId,
          detail: "Failed to build Codex orchestration adapter.",
          cause,
        }),
    ),
  );
  const consumeResetCredit: NonNullable<ProviderInstance["consumeResetCredit"]> = () =>
    resetCreditCoordinator
      .redeem(runtime.homePath, (idempotencyKey) =>
        Effect.gen(function* () {
          const effective = yield* resolveRuntime;
          const { client } = yield* withCodexAppServerClient({
            binaryPath: effective.config.binaryPath,
            homePath: effective.config.homePath,
            launchArgs: resolveCodexLaunchArgs(effective.config.launchArgs, effective.environment),
            cwd: process.cwd(),
            environment: effective.environment,
          });
          const response = yield* client.request("account/rateLimitResetCredit/consume", {
            idempotencyKey,
          });
          return response.outcome;
        }).pipe(
          Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
          Effect.provideService(FileSystem.FileSystem, fileSystem),
          Effect.provideService(Path.Path, path),
          Effect.scoped,
          Effect.timeout("20 seconds"),
        ),
      )
      .pipe(
        Effect.mapError(
          (cause) =>
            new ProviderDriverError({
              driver: DRIVER,
              instanceId,
              detail: "Codex could not redeem the reset credit.",
              cause,
            }),
        ),
        Effect.tap((outcome) =>
          ResetCreditCoordinator.refreshAfterRedemption({
            outcome,
            getSnapshot: snapshot.getSnapshot,
            refresh: snapshot.refresh,
          }).pipe(
            Effect.filterOrFail(
              (confirmed) => confirmed,
              () =>
                new ProviderDriverError({
                  driver: DRIVER,
                  instanceId,
                  detail:
                    "The reset was applied, but Codex could not confirm the new limits. Refresh to check.",
                }),
            ),
          ),
        ),
      );
  const nativeGeneration = yield* makeCodexTextGeneration(
    config,
    undefined,
    models,
    resolveRuntime,
  );
  const protect = <A>(operation: string, effect: Effect.Effect<A, TextGenerationError>) =>
    runtime.auth.controller.withAccess!(effect).pipe(
      Effect.scoped,
      Effect.mapError(
        (cause) =>
          new TextGenerationError({
            operation,
            detail: "detail" in cause ? cause.detail : "Codex text generation failed.",
          }),
      ),
    );
  const textGeneration: ProviderInstance["textGeneration"] = {
    generateCommitMessage: (value) =>
      protect("generateCommitMessage", nativeGeneration.generateCommitMessage(value)),
    generatePrContent: (value) =>
      protect("generatePrContent", nativeGeneration.generatePrContent(value)),
    generateBranchName: (value) =>
      protect("generateBranchName", nativeGeneration.generateBranchName(value)),
    generateThreadTitle: (value) =>
      protect("generateThreadTitle", nativeGeneration.generateThreadTitle(value)),
    generateReviewGuide: (value) =>
      protect("generateReviewGuide", nativeGeneration.generateReviewGuide(value)),
    generateTranscriptionPostProcessing: (value) =>
      protect(
        "generateTranscriptionPostProcessing",
        nativeGeneration.generateTranscriptionPostProcessing(value),
      ),
  };
  return {
    instanceId,
    driverKind: DRIVER,
    continuationIdentity,
    displayName,
    accentColor,
    enabled,
    snapshot,
    consumeResetCredit,
    orchestrationAdapter,
    textGeneration,
    auth: runtime.auth.controller,
    snapshotForCwd: (cwd: string) =>
      enabled
        ? snapshot.getSnapshot.pipe(
            Effect.flatMap((machine) =>
              machine.auth.status === "unauthenticated"
                ? Effect.succeed({ ...machine, skills: [] })
                : resolveRuntime.pipe(
                    Effect.flatMap((effective) =>
                      probeCodexSkillsForCwd({
                        binaryPath: effective.config.binaryPath,
                        homePath: effective.config.homePath,
                        launchArgs: effective.config.launchArgs,
                        cwd,
                        environment: effective.environment,
                      }).pipe(
                        Effect.flatMap((skills) =>
                          snapshot.getSnapshot.pipe(Effect.map((draft) => ({ ...draft, skills }))),
                        ),
                      ),
                    ),
                    Effect.scoped,
                    Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
                  ),
            ),
            // Fail instead of returning machine inventory, which the registry would publish as workspace inventory.
            Effect.mapError(
              (cause) =>
                new ProviderDriverError({
                  driver: DRIVER,
                  instanceId,
                  detail: `Failed to probe Codex skills for '${cwd}'`,
                  cause,
                }),
            ),
          )
        : snapshot.getSnapshot,
  } satisfies ProviderInstance;
});
