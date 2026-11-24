// @effect-diagnostics nodeBuiltinImport:off - checks the host's default Codex directory without writing to it.
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { CodexSettings, ProviderInstanceId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientResponse } from "effect/http";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as PlatformError from "effect/PlatformError";
import * as ServerConfig from "../config.ts";
import * as CodexInstallation from "./CodexInstallation.ts";
import { makeCodexManagedRuntime } from "./CodexManagedRuntime.ts";
import { resolveNativeCodexCallbackForwardUrl } from "./CodexNativeAuth.ts";
import { codexAppServerArgs } from "./codexLaunchArgs.ts";

const decodeSettings = Schema.decodeSync(CodexSettings);

it.live.each(
  (["managed", "local"] as const).flatMap((source) =>
    (["primary", "additional"] as const).map((account) => ({ source, account })),
  ),
)(
  "$source Codex $account account uses native Codex OAuth in an isolated shadow home without leaking ambient overrides",
  ({ source, account }) =>
    Effect.gen(function* () {
      const instanceId = ProviderInstanceId.make(
        account === "primary" ? "codex" : "codex-personal",
      );
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const sharedHome = yield* fs.makeTempDirectoryScoped({ prefix: "codex-shared-home-" });
      yield* fs.writeFileString(path.join(sharedHome, "auth.json"), "native-auth-unchanged");
      yield* fs.writeFileString(path.join(sharedHome, "config.toml"), "# shared config\n");
      yield* fs.makeDirectory(path.join(sharedHome, "sessions"), { recursive: true });
      let leases = 0;
      const executable = {
        executablePath:
          source === "managed" ? "/isolated/tools/codex/0.166.0/bin/codex" : "/user/bin/codex",
        managedVersionDirectory: source === "managed" ? "/isolated/tools/codex/0.166.0" : null,
        source,
        version: "0.166.0",
      };
      const layerInstaller = Layer.mock(CodexInstallation.CodexInstallation)({
        managedDirectory: "/isolated/tools/codex",
        resolve: () => Effect.succeed(executable),
        acquire: () =>
          Effect.gen(function* () {
            leases++;
            yield* Effect.addFinalizer(() =>
              Effect.sync(() => {
                leases--;
              }),
            );
            return executable;
          }),
      });
      const noSpawn = ChildProcessSpawner.make(() =>
        PlatformError.badArgument({
          module: "ChildProcessSpawner",
          method: "spawn",
          description: "fixture app-server not spawned during runtime test",
        }),
      );
      yield* Effect.gen(function* () {
        const hostEnv = yield* HostProcess.Environment;
        const ambient = {
          CODEX_HOME: "/user/.codex",
          ACCESS_TOKEN: "ambient-bearer",
          T3CODE_HOME: path.join(sharedHome, "wrong-server-home"),
          OPENAI_API_KEY: "dummy-global-key",
          OPENAI_BASE_URL: "https://user-proxy.test",
          T3CODE_CODEX_LAUNCH_ARGS: "--config model_provider=global-proxy",
          PATH: hostEnv.PATH,
          SystemRoot: hostEnv.SystemRoot,
        };
        const runtime = yield* makeCodexManagedRuntime({
          instanceId,
          enabled: true,
          config: decodeSettings({ setupMode: "managed", homePath: sharedHome }),
          environment: ambient,
        });
        yield* Effect.gen(function* () {
          const effective = yield* runtime.resolve;
          assert.strictEqual(leases, 1);
          assert.strictEqual(effective.config.binaryPath, executable.executablePath);
          assert.notStrictEqual(effective.config.homePath, ambient.CODEX_HOME);
          assert.equal(runtime.homeLayout.sharedHomePath, sharedHome);
          assert.equal(runtime.homeLayout.mode, "authOverlay");
          assert.include(effective.config.homePath, instanceId);
          assert.include(
            effective.config.homePath.replaceAll("\\", "/"),
            "userdata/providers/codex",
          );
          assert.isFalse(yield* fs.exists(path.join(effective.config.homePath, "auth.json")));
          yield* fs.writeFileString(
            path.join(effective.config.homePath, "auth.json"),
            '{"tokens":{"access_token":"account-token"}}',
          );

          assert.isUndefined(effective.environment.ACCESS_TOKEN);
          assert.isUndefined(effective.environment.OPENAI_API_KEY);
          assert.isUndefined(effective.environment.OPENAI_BASE_URL);
          assert.isUndefined(effective.environment.T3CODE_CODEX_LAUNCH_ARGS);
          assert.equal(effective.environment.CODEX_HOME, effective.config.homePath);

          const args = codexAppServerArgs(effective.config.launchArgs);
          assert.include(args, 'cli_auth_credentials_store="file"');
          assert.notInclude(args, 'model_provider="openai_token_sharing"');
          assert.notInclude(args, "features.multi_agent=false");
          assert.notInclude(args, "features.multi_agent_v2=false");
          assert.isFalse(yield* fs.exists(ambient.T3CODE_HOME));
          assert.strictEqual(ambient.CODEX_HOME, "/user/.codex");
        }).pipe(Effect.scoped);

        assert.strictEqual(leases, 0);
        yield* runtime.auth.controller.logout(Effect.void);
        assert.isFalse(yield* fs.exists(path.join(runtime.homePath, "auth.json")));
        assert.equal(
          yield* fs.readFileString(path.join(sharedHome, "auth.json")),
          "native-auth-unchanged",
        );
      }).pipe(
        Effect.provide(layerInstaller),
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, noSpawn),
        Effect.provideService(
          HttpClient.HttpClient,
          HttpClient.make((request) =>
            Effect.succeed(
              HttpClientResponse.fromWeb(request, new Response(null, { status: 200 })),
            ),
          ),
        ),
      );
    }).pipe(
      Effect.scoped,
      Effect.provide(
        ServerConfig.layerTest(process.cwd(), {
          prefix: "t3-managed-runtime-",
        }).pipe(Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))),
      ),
    ),
);

it("validates and normalizes native Codex OAuth callback URLs", () => {
  const authUrl =
    "https://auth.openai.com/oauth/authorize?response_type=code&client_id=app_EMoamEEZ73f0CkXaXp7hrann&redirect_uri=http%3A%2F%2F127.0.0.1%3A1455%2Fauth%2Fcallback&code_challenge=1Qm45W4iPKW2qCzy9sKE4IDAwK3aUR5R-Xbq5dylMc0&code_challenge_method=S256&state=_u9AnurYMIcKvkSoYtC5b1ULlHiFkLS3q-ts7xWUHss";
  const callback =
    "http://localhost:1455/auth/callback?code=abc123&state=_u9AnurYMIcKvkSoYtC5b1ULlHiFkLS3q-ts7xWUHss";
  assert.equal(
    resolveNativeCodexCallbackForwardUrl(authUrl, callback),
    "http://127.0.0.1:1455/auth/callback?code=abc123&state=_u9AnurYMIcKvkSoYtC5b1ULlHiFkLS3q-ts7xWUHss",
  );
  assert.throws(() =>
    resolveNativeCodexCallbackForwardUrl(
      authUrl,
      "http://127.0.0.1:1455/auth/callback?code=abc123&state=wrong-state",
    ),
  );
});
