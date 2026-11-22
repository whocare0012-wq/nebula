import { uiText } from "../i18n";
import { create } from "zustand";
import {
  COMMUNITY_BASE_TAG,
  COMMUNITY_CHECK_INTERVAL_MS,
  COMMUNITY_REPOSITORY,
  communityReleaseNumber,
  parseCommunityRelease,
  type CommunityRelease,
  type CommunityUpdateMode,
} from "./communityUpdates.logic";
const KEY = "t3code:community-updates:v1";
type Preferences = {
  mode: CommunityUpdateMode;
  /** True once the user picks a mode; until then the default applies. */
  modeChosen: boolean;
  automatic: boolean;
  lastAttempt: number;
  notifiedTag: string;
};
function readPreferences(): Preferences {
  const defaults: Preferences = {
    mode: "standard",
    modeChosen: false,
    // This fork ships no releases of its own, so polling the upstream Stardust repo is opt-in.
    automatic: false,
    lastAttempt: 0,
    notifiedTag: "",
  };
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (!value || typeof value !== "object") return defaults;
    const v = value as Record<string, unknown>;
    return {
      // Earlier builds stored their "custom" default without a user choice; only honor explicit picks.
      mode: v.modeChosen === true && v.mode === "custom" ? "custom" : "standard",
      modeChosen: v.modeChosen === true,
      automatic: typeof v.automatic === "boolean" ? v.automatic : defaults.automatic,
      lastAttempt:
        typeof v.lastAttempt === "number" &&
        Number.isFinite(v.lastAttempt) &&
        v.lastAttempt > 0 &&
        v.lastAttempt <= Date.now()
          ? v.lastAttempt
          : 0,
      notifiedTag: typeof v.notifiedTag === "string" ? v.notifiedTag : "",
    };
  } catch {
    return defaults;
  }
}
interface CommunityUpdatesState extends Preferences {
  status: "idle" | "checking" | "available" | "current" | "error";
  release: CommunityRelease | null;
  error: string | null;
  setMode: (mode: CommunityUpdateMode) => void;
  setAutomatic: (automatic: boolean) => void;
  markNotified: (tag: string) => void;
  check: (manual?: boolean) => Promise<void>;
}
let pending: Promise<void> | null = null;
export const useCommunityUpdates = create<CommunityUpdatesState>((set, get) => {
  const save = (patch: Partial<Preferences>) => {
    set(patch);
    const { mode, modeChosen, automatic, lastAttempt, notifiedTag } = get();
    try {
      localStorage.setItem(
        KEY,
        JSON.stringify({ mode, modeChosen, automatic, lastAttempt, notifiedTag }),
      );
    } catch {
      set({
        error: uiText("Couldn’t save update preferences. Defaults may return after restart."),
      });
    }
  };
  return {
    ...readPreferences(),
    status: "idle",
    release: null,
    error: null,
    setMode: (mode) => save({ mode, modeChosen: true }),
    setAutomatic: (automatic) => save({ automatic }),
    markNotified: (tag) => save({ notifiedTag: tag }),
    check: (manual = false) => {
      if (pending) return pending;
      if (
        !manual &&
        (!get().automatic || Date.now() - get().lastAttempt < COMMUNITY_CHECK_INTERVAL_MS)
      )
        return Promise.resolve();
      save({ lastAttempt: Date.now() });
      set({ status: "checking", error: null });
      pending = (async () => {
        try {
          const response = await fetch(
            `https://api.github.com/repos/${COMMUNITY_REPOSITORY}/releases/latest`,
            {
              credentials: "omit",
              referrerPolicy: "no-referrer",
              headers: { Accept: "application/vnd.github+json" },
              signal: AbortSignal.timeout(15_000),
            },
          );
          if (!response.ok)
            throw new Error(
              response.status === 403 || response.status === 429
                ? uiText("GitHub is rate-limiting update checks. Try again later.")
                : uiText("Update check failed (HTTP {status})", { status: response.status }),
            );
          const release = parseCommunityRelease(await response.json());
          const baseline = communityReleaseNumber(COMMUNITY_BASE_TAG);
          if (baseline === null)
            throw new Error(uiText("Local community baseline unknown. Check the releases page."));
          set({ status: release.number > baseline ? "available" : "current", release });
        } catch (error) {
          set({
            status: "error",
            error:
              error instanceof Error
                ? error.message
                : uiText("Couldn’t reach GitHub. Try again later."),
          });
        }
      })().finally(() => {
        pending = null;
      });
      return pending;
    },
  };
});
