import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import { materializeCodexShadowHome } from "./CodexHomeLayout.ts";

// Windows without Developer Mode cannot create symlinks, which is what most users have.
const windows = HostProcess.Platform.defaultValue() === "win32";

it.layer(NodeServices.layer)("CodexHomeLayout on Windows", (it) => {
  describe("materializeCodexShadowHome", () => {
    it.effect.runIf(windows)(
      "shares folders through junctions and files through hard links that survive a rewrite",
      () =>
        Effect.gen(function* () {
          const fileSystem = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-codex-win-" });
          const shared = path.join(root, "shared");
          const shadow = path.join(root, "shadow");
          yield* fileSystem.makeDirectory(path.join(shared, "sessions"), { recursive: true });
          yield* fileSystem.writeFileString(path.join(shared, "sessions", "a.jsonl"), "one");
          yield* fileSystem.writeFileString(path.join(shared, "config.toml"), "model = 'a'");
          yield* fileSystem.writeFileString(path.join(shared, "auth.json"), "shared-login");
          const layout = {
            mode: "authOverlay" as const,
            sharedHomePath: shared,
            effectiveHomePath: shadow,
            continuationKey: `codex:home:${shared}`,
          };

          yield* materializeCodexShadowHome(layout);

          // A folder is a junction to the shared one.
          expect(yield* fileSystem.readLink(path.join(shadow, "sessions"))).toBe(
            path.join(shared, "sessions"),
          );
          expect(yield* fileSystem.readFileString(path.join(shadow, "sessions", "a.jsonl"))).toBe(
            "one",
          );
          // A file is the same file as the shared one.
          const inode = (file: string) =>
            fileSystem.stat(file).pipe(Effect.map((info) => Option.getOrUndefined(info.ino)));
          expect(yield* inode(path.join(shadow, "config.toml"))).toBe(
            yield* inode(path.join(shared, "config.toml")),
          );
          // The login stays private.
          expect(yield* fileSystem.exists(path.join(shadow, "auth.json"))).toBe(false);

          // Codex replaces the file in the shadow home, which detaches the hard link.
          const shadowConfig = path.join(shadow, "config.toml");
          yield* fileSystem.remove(shadowConfig);
          yield* fileSystem.writeFileString(shadowConfig, "model = 'b'");
          yield* fileSystem.utimes(path.join(shared, "config.toml"), 0, 0);

          yield* materializeCodexShadowHome(layout);

          // The newer copy became the shared content, and the link is back.
          expect(yield* fileSystem.readFileString(path.join(shared, "config.toml"))).toBe(
            "model = 'b'",
          );
          expect(yield* inode(shadowConfig)).toBe(yield* inode(path.join(shared, "config.toml")));

          // Removing the shadow home leaves the shared home whole.
          yield* fileSystem.remove(shadow, { recursive: true });
          expect(yield* fileSystem.readFileString(path.join(shared, "sessions", "a.jsonl"))).toBe(
            "one",
          );
          expect(yield* fileSystem.readFileString(path.join(shared, "auth.json"))).toBe(
            "shared-login",
          );
        }).pipe(Effect.scoped),
    );

    it.effect.runIf(windows)("leaves databases out and drops links an older setup made", () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-codex-win-" });
        const shared = path.join(root, "shared");
        const shadow = path.join(root, "shadow");
        yield* fileSystem.makeDirectory(shadow, { recursive: true });
        yield* fileSystem.makeDirectory(shared, { recursive: true });
        for (const name of ["state_5.sqlite", "state_5.sqlite-wal", "logs_2.sqlite"])
          yield* fileSystem.writeFileString(path.join(shared, name), name);
        yield* fileSystem.link(
          path.join(shared, "state_5.sqlite"),
          path.join(shadow, "state_5.sqlite"),
        );
        // A journal that already came apart from the shared one may hold the only recent writes.
        yield* fileSystem.writeFileString(path.join(shadow, "state_5.sqlite-wal"), "local writes");

        yield* materializeCodexShadowHome({
          mode: "authOverlay",
          sharedHomePath: shared,
          effectiveHomePath: shadow,
          continuationKey: `codex:home:${shared}`,
        });

        expect(yield* fileSystem.exists(path.join(shadow, "state_5.sqlite"))).toBe(false);
        expect(yield* fileSystem.exists(path.join(shadow, "logs_2.sqlite"))).toBe(false);
        expect(yield* fileSystem.readFileString(path.join(shadow, "state_5.sqlite-wal"))).toBe(
          "local writes",
        );
        expect(yield* fileSystem.readFileString(path.join(shared, "state_5.sqlite"))).toBe(
          "state_5.sqlite",
        );
      }).pipe(Effect.scoped),
    );
  });
});
