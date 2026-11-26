// Effect-free so the service launcher shares the pre-lock owner identity check with server startup.
import { windowsPowerShellPath } from "@t3tools/shared/windowsSystem";

export const legacyOwnerStartTimeCommand = (
  pid: number,
  platform: NodeJS.Platform,
  hostEnv: NodeJS.ProcessEnv,
) => {
  const windows = platform === "win32";
  return {
    command: windows ? windowsPowerShellPath(hostEnv) : "ps",
    args: windows
      ? [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `(Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToUniversalTime().ToString('o')`,
        ]
      : ["-p", String(pid), "-o", "lstart="],
    env: { LC_ALL: "C", TZ: "UTC" },
  };
};

// Windows PowerShell alone takes about two seconds to start, so a two-second limit there would
// always run out and leave every reused PID looking like its old owner.
export const legacyOwnerStartTimeTimeoutMs = (platform: NodeJS.Platform) =>
  platform === "win32" ? 15_000 : 2_000;

// ps reports whole seconds. Unknown identity (no output) stays conservative.
export const legacyOwnerStartedBeforeRecord = (
  output: string | undefined,
  recordedAt: number,
  platform: NodeJS.Platform,
): boolean => {
  if (output === undefined) return true;
  const trimmed = output.trim();
  const startedAt = Date.parse(platform === "win32" ? trimmed : `${trimmed} UTC`);
  return !Number.isFinite(startedAt) || startedAt <= recordedAt + 1_000;
};
