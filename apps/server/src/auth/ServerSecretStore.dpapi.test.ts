import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import * as ServerConfig from "../config.ts";
import * as ServerSecretStore from "./ServerSecretStore.ts";
import { DPAPI_SEALED_PREFIX, isDpapiSealed } from "./windowsDpapi.ts";

const layerStore = () =>
  ServerSecretStore.layer.pipe(
    Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "t3-secret-dpapi-test-" })),
  );

const secretFile = (name: string) =>
  Effect.gen(function* () {
    const { secretsDir } = yield* ServerConfig.ServerConfig;
    return (yield* Path.Path).join(secretsDir, `${name}.bin`);
  });

const value = new TextEncoder().encode("sk-test-provider-token");

it.layer(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))(
  "ServerSecretStore on Windows",
  (it) => {
    it.effect.skipIf(HostProcess.Platform.defaultValue() !== "win32")(
      "seals what it writes and opens it again",
      () =>
        Effect.gen(function* () {
          const store = yield* ServerSecretStore.ServerSecretStore;
          yield* store.set("provider-auth-test", value);
          const stored = yield* (yield* FileSystem.FileSystem).readFile(
            yield* secretFile("provider-auth-test"),
          );
          assert.isTrue(isDpapiSealed(stored));
          assert.isFalse(Buffer.from(stored).includes(Buffer.from(value)));
          assert.deepEqual(Option.getOrThrow(yield* store.get("provider-auth-test")), value);
        }).pipe(Effect.provide(layerStore())),
    );

    it.effect.skipIf(HostProcess.Platform.defaultValue() !== "win32")(
      "seals a plaintext secret from an older build",
      () =>
        Effect.gen(function* () {
          const store = yield* ServerSecretStore.ServerSecretStore;
          const fs = yield* FileSystem.FileSystem;
          const file = yield* secretFile("legacy");
          yield* fs.writeFile(file, value);
          assert.deepEqual(Option.getOrThrow(yield* store.get("legacy")), value);
          assert.isTrue(isDpapiSealed(yield* fs.readFile(file)));
          assert.deepEqual(Option.getOrThrow(yield* store.get("legacy")), value);
        }).pipe(Effect.provide(layerStore())),
    );

    it.effect.skipIf(HostProcess.Platform.defaultValue() !== "win32")(
      "drops a sealed secret this account cannot open, as a restored backup from elsewhere",
      () =>
        Effect.gen(function* () {
          const store = yield* ServerSecretStore.ServerSecretStore;
          const fs = yield* FileSystem.FileSystem;
          const file = yield* secretFile("foreign");
          yield* fs.writeFile(file, Buffer.concat([DPAPI_SEALED_PREFIX, Buffer.alloc(64, 7)]));
          assert.isTrue(Option.isNone(yield* store.get("foreign")));
          assert.isFalse(yield* fs.exists(file));
          const created = yield* store.getOrCreateRandom("foreign", 32);
          assert.equal(created.byteLength, 32);
        }).pipe(Effect.provide(layerStore())),
    );

    it.effect("stores plaintext where DPAPI does not exist", () =>
      Effect.gen(function* () {
        const store = yield* ServerSecretStore.ServerSecretStore;
        yield* store.set("plain", value);
        const stored = yield* (yield* FileSystem.FileSystem).readFile(yield* secretFile("plain"));
        assert.deepEqual(Uint8Array.from(stored), value);
      }).pipe(Effect.provide(layerStore()), Effect.provideService(HostProcess.Platform, "linux")),
    );
  },
);
