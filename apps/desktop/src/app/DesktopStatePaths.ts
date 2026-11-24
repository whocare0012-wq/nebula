import * as Option from "effect/Option";

export type JoinPath = (first: string, ...segments: string[]) => string;

const BASE_DIR_NAME = ".nebula";
// Nebula shared T3 Code's home before it had its own.
const LEGACY_BASE_DIR_NAME = ".t3";

function normalizeConfiguredBaseDir(t3Home: Option.Option<string>): Option.Option<string> {
  if (Option.isNone(t3Home)) {
    return Option.none();
  }
  const trimmed = t3Home.value.trim();
  return trimmed.length > 0 ? Option.some(trimmed) : Option.none();
}

export function resolveDesktopBaseDir(input: {
  readonly homeDirectory: string;
  readonly joinPath: JoinPath;
  readonly t3Home: Option.Option<string>;
}): string {
  return Option.getOrElse(normalizeConfiguredBaseDir(input.t3Home), () =>
    input.joinPath(input.homeDirectory, BASE_DIR_NAME),
  );
}

export type LegacyBaseDirMigration =
  | { readonly kind: "none" }
  | { readonly kind: "moved"; readonly from: string; readonly to: string }
  | { readonly kind: "kept-legacy"; readonly legacyBaseDir: string; readonly cause: unknown };

/**
 * Moves the shared ~/.t3 to ~/.nebula once. Windows refuses to rename a folder while a file in it
 * is open, so a running T3 Code or background service keeps its data; the caller then keeps using
 * ~/.t3 for this launch and the move is retried on the next one.
 */
export function migrateLegacyDesktopBaseDir(input: {
  readonly homeDirectory: string;
  readonly joinPath: JoinPath;
  readonly exists: (path: string) => boolean;
  readonly rename: (from: string, to: string) => void;
}): LegacyBaseDirMigration {
  const to = input.joinPath(input.homeDirectory, BASE_DIR_NAME);
  const from = input.joinPath(input.homeDirectory, LEGACY_BASE_DIR_NAME);
  if (input.exists(to) || !input.exists(input.joinPath(from, "userdata"))) return { kind: "none" };
  try {
    input.rename(from, to);
    return { kind: "moved", from, to };
  } catch (cause) {
    return { kind: "kept-legacy", legacyBaseDir: from, cause };
  }
}

export function resolveDesktopStateDir(input: {
  readonly baseDir: string;
  readonly isDevelopment: boolean;
  readonly joinPath: JoinPath;
  readonly t3Home: Option.Option<string>;
}): string {
  const useDevSubdir =
    input.isDevelopment && Option.isNone(normalizeConfiguredBaseDir(input.t3Home));
  return input.joinPath(input.baseDir, useDevSubdir ? "dev" : "userdata");
}
