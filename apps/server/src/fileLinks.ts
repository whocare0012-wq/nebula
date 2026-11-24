// @effect-diagnostics-next-line nodeBuiltinImport:off - Effect's symlink has no type argument, and Windows needs a junction to link a folder without elevation.
import * as NodeFSP from "node:fs/promises";

import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as PlatformError from "effect/PlatformError";

const EXISTS_CODES = new Set(["EEXIST"]);
const PERMISSION_CODES = new Set(["EPERM", "EACCES"]);

const junction = (target: string, link: string) =>
  Effect.tryPromise({
    try: () => NodeFSP.symlink(target, link, "junction"),
    catch: (cause) => {
      const code = (cause as NodeJS.ErrnoException | undefined)?.code ?? "";
      return PlatformError.systemError({
        _tag: EXISTS_CODES.has(code)
          ? "AlreadyExists"
          : PERMISSION_CODES.has(code)
            ? "PermissionDenied"
            : code === "ENOENT"
              ? "NotFound"
              : "Unknown",
        module: "FileSystem",
        method: "symlink",
        syscall: "symlink",
        pathOrDescriptor: link,
        cause,
      });
    },
  });

/**
 * Makes `link` stand for `target`. Elsewhere that is a symlink. On Windows a symlink needs
 * Developer Mode or elevation, so a folder gets a junction (which `readLink` reads and `remove`
 * deletes without touching the target) and a file falls back to a hard link to the same content.
 */
export const linkEntry = Effect.fn("linkEntry")(function* (
  fileSystem: FileSystem.FileSystem,
  target: string,
  link: string,
) {
  if ((yield* HostProcess.Platform) !== "win32") return yield* fileSystem.symlink(target, link);
  const isDirectory = yield* fileSystem.stat(target).pipe(
    Effect.map((info) => info.type === "Directory"),
    Effect.orElseSucceed(() => false),
  );
  if (isDirectory) return yield* junction(target, link);
  return yield* fileSystem
    .symlink(target, link)
    .pipe(
      Effect.catchReason("PlatformError", "PermissionDenied", () => fileSystem.link(target, link)),
    );
});

/**
 * Whether `path` is a link `linkEntry` could have made: a symlink or junction, or on Windows a
 * file with another hard link. Removing either never deletes the content it stands for.
 */
export const isLinkedEntry = Effect.fn("isLinkedEntry")(function* (
  fileSystem: FileSystem.FileSystem,
  path: string,
) {
  if (Option.isSome(yield* fileSystem.readLink(path).pipe(Effect.option))) return true;
  if ((yield* HostProcess.Platform) !== "win32") return false;
  return yield* fileSystem.stat(path).pipe(
    Effect.map((info) => info.type === "File" && Option.getOrElse(info.nlink, () => 1n) > 1n),
    Effect.orElseSucceed(() => false),
  );
});
