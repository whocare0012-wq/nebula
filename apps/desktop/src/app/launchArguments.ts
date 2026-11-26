/** The jump list's New thread task launches Nebula with this argument. */
export const NEW_THREAD_ARGUMENT = "--nebula-new-thread";

/** Explorer's "Open with Nebula" passes the folder as `--nebula-open-folder=<path>`. */
export const OPEN_FOLDER_ARGUMENT = "--nebula-open-folder";

/** The login item starts Nebula with this argument to stay in the tray until opened. */
export const BACKGROUND_LAUNCH_ARGUMENT = "--nebula-background";

export function readOpenFolderArgument(argv: readonly string[]): string | null {
  const prefix = `${OPEN_FOLDER_ARGUMENT}=`;
  const value = argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
  // A drive root's trailing backslash escapes the closing quote, which then stays in the value.
  const folder = value?.replace(/"$/, "").trim();
  return folder ? folder : null;
}
