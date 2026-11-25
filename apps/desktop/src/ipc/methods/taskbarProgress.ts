import * as Electron from "electron";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as HostProcess from "@t3tools/shared/HostProcess";

import * as ElectronApp from "../../electron/ElectronApp.ts";
import * as DesktopIpc from "../DesktopIpc.ts";
import { SET_TASKBAR_PROGRESS_CHANNEL } from "../channels.ts";

const TaskbarProgress = Schema.Struct({ working: Schema.Boolean });

function applyTaskbarProgress(window: Electron.BrowserWindow, working: boolean): void {
  if (window.isDestroyed()) return;
  // Agents report no fraction of their work, so the bar only says that something is running.
  window.setProgressBar(working ? 2 : -1, { mode: working ? "indeterminate" : "none" });
}

/** Shows an indeterminate Windows taskbar progress bar while any thread's agent is working. */
export const installTaskbarProgress = Effect.fn("desktop.ipc.installTaskbarProgress")(function* () {
  const ipc = yield* DesktopIpc.DesktopIpc;
  const app = yield* ElectronApp.ElectronApp;
  const supported = (yield* HostProcess.Platform) === "win32";
  const runSync = Effect.runSyncWith(yield* Effect.context<never>());
  let working = false;
  const applyAll = () => {
    try {
      for (const window of Electron.BrowserWindow.getAllWindows()) {
        applyTaskbarProgress(window, working);
      }
    } catch (error) {
      runSync(Effect.logWarning("Could not update taskbar progress", error));
    }
  };
  yield* ipc.handle(
    DesktopIpc.makeIpcMethod({
      channel: SET_TASKBAR_PROGRESS_CHANNEL,
      payload: TaskbarProgress,
      result: Schema.Void,
      handler: (state) =>
        Effect.sync(() => {
          if (!supported || state.working === working) return;
          working = state.working;
          applyAll();
        }),
    }),
  );
  if (!supported) return;
  yield* app.on("browser-window-created", (_event: unknown, window: Electron.BrowserWindow) => {
    if (working) applyTaskbarProgress(window, true);
  });
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      working = false;
      applyAll();
    }),
  );
});
