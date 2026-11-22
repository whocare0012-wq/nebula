import { uiText } from "../../i18n";
import { useEffect } from "react";
import { isElectron } from "../../env";
import { useStardustStats } from "../../state/stardustStats";
import {
  STARDUST_STATS_CHECK_INTERVAL_MS,
  STARDUST_STATS_FIRST_SEND_DELAY_MS,
} from "../../state/stardustStats.logic";
import { Switch } from "../ui/switch";
import { toastManager } from "../ui/toast";
import { SettingsRow } from "./settingsLayout";

/** Shows the one-time notice, then sends at most one anonymous count per day while counting is on. */
export function StardustStatsCoordinator() {
  const enabled = useStardustStats((s) => s.enabled);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Own the one-time notice and the daily count timers while mounted.
  useEffect(() => {
    if (!isElectron || !enabled) return;
    const timers: number[] = [];
    if (!useStardustStats.getState().noticeShown) {
      timers.push(
        window.setTimeout(() => {
          useStardustStats.getState().markNoticeShown();
          const id = toastManager.add({
            type: "info",
            timeout: 30_000,
            title: uiText("T3 Stardust counts active users anonymously"),
            description: uiText(
              "Once a day it sends a random install ID, the app version and your system type. No chats, accounts, projects or IP addresses are stored. You can turn it off any time in Settings → About.",
            ),
            actionProps: {
              children: uiText("Turn off"),
              onClick: () => {
                useStardustStats.getState().setEnabled(false);
                toastManager.close(id);
              },
            },
          });
        }, 8_000),
      );
    }
    timers.push(
      window.setTimeout(() => {
        void useStardustStats.getState().send();
      }, STARDUST_STATS_FIRST_SEND_DELAY_MS + 8_000),
    );
    const interval = window.setInterval(() => {
      void useStardustStats.getState().send();
    }, STARDUST_STATS_CHECK_INTERVAL_MS);
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
      window.clearInterval(interval);
    };
  }, [enabled]);
  return null;
}

export function StardustStatsRow() {
  const enabled = useStardustStats((s) => s.enabled);
  const setEnabled = useStardustStats((s) => s.setEnabled);
  return (
    <SettingsRow
      title={uiText("Count me as an active Stardust user")}
      description={uiText(
        "Off by default. When on, once a day sends a random install ID, the app version and your system type to xiaoxin666.cn so the author knows how many people use T3 Stardust. No chats, accounts, projects or IP addresses are stored.",
      )}
      control={
        <Switch
          aria-label={uiText("Count me as an active Stardust user")}
          checked={enabled}
          onCheckedChange={(checked) => setEnabled(Boolean(checked))}
        />
      }
    />
  );
}
