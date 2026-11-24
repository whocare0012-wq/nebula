import { resolveManagedCodexHomeLayout } from "./CodexManagedHome.ts";
import { CodexSettings, ProviderSetupError, type ProviderInstanceId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as ServerConfig from "../config.ts";
import * as CodexInstallation from "./CodexInstallation.ts";
import { makeCodexNativeAuth } from "./CodexNativeAuth.ts";
import { codexHomeLaunchArgs, materializeCodexShadowHome } from "./Drivers/CodexHomeLayout.ts";

export interface CodexEffectiveRuntime {
  readonly config: CodexSettings;
  readonly environment: NodeJS.ProcessEnv;
  readonly revision: string;
  readonly omitServiceTier?: boolean;
}

const decodeSettings = Schema.decodeSync(CodexSettings);
const FILE_CREDENTIAL_STORE_LAUNCH_ARG = `-c ${JSON.stringify('cli_auth_credentials_store="file"')}`;

const managedNativeCodexLaunchArgs = (
  path: Path.Path,
  homeLayout: Parameters<typeof codexHomeLaunchArgs>[1],
  userLaunchArgs: string,
) => {
  const baseArgs = codexHomeLaunchArgs(path, homeLayout, userLaunchArgs);
  return baseArgs.length > 0
    ? `${FILE_CREDENTIAL_STORE_LAUNCH_ARG} ${baseArgs}`
    : FILE_CREDENTIAL_STORE_LAUNCH_ARG;
};

export const makeCodexManagedRuntime = Effect.fn("makeCodexManagedRuntime")(function* (options: {
  readonly instanceId: ProviderInstanceId;
  readonly enabled: boolean;
  readonly environment: NodeJS.ProcessEnv;
  readonly config: CodexSettings;
}) {
  const installation = yield* CodexInstallation.CodexInstallation;
  const config = yield* ServerConfig.ServerConfig;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const homeLayout = yield* resolveManagedCodexHomeLayout(
    config.stateDir,
    options.instanceId,
    options.config,
  );
  const homePath = homeLayout.effectiveHomePath ?? homeLayout.sharedHomePath;
  const launchArgs = managedNativeCodexLaunchArgs(path, homeLayout, options.config.launchArgs);

  const resolve = Effect.gen(function* () {
    const executable = yield* installation.acquire().pipe(
      Effect.mapError(
        () =>
          new ProviderSetupError({
            instanceId: options.instanceId,
            operation: "install",
            detail: "Set up managed Codex before starting a session.",
          }),
      ),
    );
    yield* materializeCodexShadowHome(homeLayout).pipe(
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.provideService(Path.Path, path),
      Effect.mapError(
        (cause) =>
          new ProviderSetupError({
            instanceId: options.instanceId,
            operation: "runtime",
            detail: cause.message,
          }),
      ),
    );
    yield* fs.makeDirectory(homePath, { recursive: true }).pipe(
      Effect.mapError(
        () =>
          new ProviderSetupError({
            instanceId: options.instanceId,
            operation: "runtime",
            detail: "Could not prepare the managed Codex runtime.",
          }),
      ),
    );
    // Strip ambient overrides so this managed Codex account always uses its own native OAuth home.
    const environment: NodeJS.ProcessEnv = {
      ...options.environment,
      CODEX_HOME: homePath,
    };
    delete environment.ACCESS_TOKEN;
    delete environment.T3CODE_CODEX_LAUNCH_ARGS;
    delete environment.OPENAI_API_KEY;
    delete environment.OPENAI_BASE_URL;
    return {
      config: decodeSettings({
        enabled: options.enabled,
        setupMode: "managed",
        binaryPath: executable.executablePath,
        homePath,
        launchArgs,
      }),
      environment,
      revision: homePath,
    } satisfies CodexEffectiveRuntime;
  });

  const auth = yield* makeCodexNativeAuth({
    instanceId: options.instanceId,
    homePath,
    resolveRuntime: resolve,
  });

  return { auth, resolve, installation, homePath, homeLayout };
});
