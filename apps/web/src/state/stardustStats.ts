import { create } from "zustand";
import { isElectron } from "../env";
import { COMMUNITY_BASE_TAG } from "./communityUpdates.logic";
import {
  STARDUST_STATS_ENDPOINT,
  STARDUST_STATS_STORAGE_KEY,
  buildBeat,
  randomInstallId,
  readStardustStatsPreferences,
  shouldSendBeat,
  utcDay,
  type StardustStatsPreferences,
} from "./stardustStats.logic";

function newInstallId(): string {
  return randomInstallId((bytes) => {
    crypto.getRandomValues(bytes as Uint8Array<ArrayBuffer>);
    return bytes;
  });
}

function readPreferences(): StardustStatsPreferences {
  try {
    return readStardustStatsPreferences(
      JSON.parse(localStorage.getItem(STARDUST_STATS_STORAGE_KEY) ?? "null"),
      newInstallId,
    );
  } catch {
    return readStardustStatsPreferences(null, newInstallId);
  }
}

async function cpuArchitecture(): Promise<string | undefined> {
  const data = (
    navigator as Navigator & {
      userAgentData?: {
        getHighEntropyValues?: (hints: string[]) => Promise<{ architecture?: string }>;
      };
    }
  ).userAgentData;
  try {
    return (await data?.getHighEntropyValues?.(["architecture"]))?.architecture;
  } catch {
    return undefined;
  }
}

interface StardustStatsState extends StardustStatsPreferences {
  setEnabled: (enabled: boolean) => void;
  markNoticeShown: () => void;
  send: () => Promise<void>;
}

let pending: Promise<void> | null = null;

export const useStardustStats = create<StardustStatsState>((set, get) => {
  const save = (patch: Partial<StardustStatsPreferences>) => {
    set(patch);
    const { enabled, noticeShown, install, lastSentDay } = get();
    try {
      localStorage.setItem(
        STARDUST_STATS_STORAGE_KEY,
        JSON.stringify({ enabled, noticeShown, install, lastSentDay }),
      );
    } catch {
      // Without storage the next launch starts from defaults; counting stays at most once per day per launch.
    }
  };
  const initial = readPreferences();
  return {
    ...initial,
    // Turning counting on is consent, so the first-run notice has nothing left to say.
    setEnabled: (enabled) => save(enabled ? { enabled, noticeShown: true } : { enabled }),
    markNoticeShown: () => save({ noticeShown: true }),
    send: () => {
      if (pending) return pending;
      if (!isElectron || !shouldSendBeat(get(), Date.now())) return Promise.resolve();
      pending = (async () => {
        const beat = buildBeat({
          preferences: get(),
          tag: COMMUNITY_BASE_TAG,
          platform: window.desktopBridge?.getClientPlatform(),
          architecture: await cpuArchitecture(),
        });
        if (!beat) return;
        try {
          const response = await fetch(STARDUST_STATS_ENDPOINT, {
            method: "POST",
            credentials: "omit",
            referrerPolicy: "no-referrer",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(beat),
            signal: AbortSignal.timeout(10_000),
          });
          // Re-check: the user may have switched counting off while the request was in flight.
          if (response.ok && get().enabled) save({ lastSentDay: utcDay(Date.now()) });
        } catch {
          // Offline or blocked: try again at the next check.
        }
      })().finally(() => {
        pending = null;
      });
      return pending;
    },
  };
});
