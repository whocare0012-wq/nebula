/**
 * Anonymous active-device count for T3 Stardust builds.
 *
 * Once per UTC day the desktop app sends a random install id, the Stardust version, the OS and the
 * CPU architecture. Nothing else: no chats, accounts, projects or paths. The site endpoint does not
 * read or forward the caller's IP, and the server re-hashes the install id before storing it.
 */
export const STARDUST_STATS_ENDPOINT = "https://www.xiaoxin666.cn/api/stardust";
export const STARDUST_STATS_STORAGE_KEY = "t3code:stardust-stats:v1";
/** First send waits this long after the notice so the user can turn counting off before anything leaves. */
export const STARDUST_STATS_FIRST_SEND_DELAY_MS = 60_000;
export const STARDUST_STATS_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

export interface StardustStatsPreferences {
  enabled: boolean;
  noticeShown: boolean;
  install: string;
  lastSentDay: string;
}

export interface StardustBeat {
  install: string;
  version: string;
  os: "darwin" | "win32" | "linux";
  arch: "arm64" | "x64";
}

const INSTALL_RE = /^[a-f0-9]{64}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function randomInstallId(random: (bytes: Uint8Array) => Uint8Array): string {
  return Array.from(random(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

export function readStardustStatsPreferences(
  value: unknown,
  makeInstallId: () => string,
): StardustStatsPreferences {
  const v = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    // Counting is opt-in: nothing is sent until the user turns it on.
    enabled: v.enabled === true,
    noticeShown: v.noticeShown === true,
    install:
      typeof v.install === "string" && INSTALL_RE.test(v.install) ? v.install : makeInstallId(),
    lastSentDay:
      typeof v.lastSentDay === "string" && DAY_RE.test(v.lastSentDay) ? v.lastSentDay : "",
  };
}

export function utcDay(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

export function shouldSendBeat(preferences: StardustStatsPreferences, now: number): boolean {
  return preferences.enabled && preferences.noticeShown && preferences.lastSentDay !== utcDay(now);
}

/** `v1.2.1` -> `1.2.1`; anything else is not a public Stardust release and is never reported. */
export function stardustVersionFromTag(tag: string): string | null {
  const match = /^v(\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(tag);
  return match ? match[1]! : null;
}

export function beatOs(platform: string | undefined): StardustBeat["os"] | null {
  return platform === "darwin" || platform === "win32" || platform === "linux" ? platform : null;
}

/** Chromium reports `arm` or `x86`; the public Stardust build is Apple Silicon, so that is the fallback. */
export function beatArch(architecture: string | undefined): StardustBeat["arch"] {
  return architecture === "x86" ? "x64" : "arm64";
}

export function buildBeat(input: {
  preferences: StardustStatsPreferences;
  tag: string;
  platform: string | undefined;
  architecture: string | undefined;
}): StardustBeat | null {
  const version = stardustVersionFromTag(input.tag);
  const os = beatOs(input.platform);
  if (!version || !os) return null;
  return {
    install: input.preferences.install,
    version,
    os,
    arch: beatArch(input.architecture),
  };
}
