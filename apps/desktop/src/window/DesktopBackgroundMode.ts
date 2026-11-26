import type { ClientSettings } from "@t3tools/contracts/settings";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Electron from "electron";

import * as DesktopAssets from "../app/DesktopAssets.ts";
import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import { makeComponentLogger } from "../app/DesktopObservability.ts";
import * as DesktopState from "../app/DesktopState.ts";
import { BACKGROUND_LAUNCH_ARGUMENT } from "../app/launchArguments.ts";
import * as ElectronApp from "../electron/ElectronApp.ts";
import * as ElectronWindow from "../electron/ElectronWindow.ts";
import * as DesktopClientSettings from "../settings/DesktopClientSettings.ts";
import * as DesktopWindow from "./DesktopWindow.ts";

const { logWarning } = makeComponentLogger("desktop-background-mode");

export interface BackgroundModeSettings {
  readonly runInBackground: boolean;
  readonly openAtLogin: boolean;
}

/** The login item opens Nebula hidden in the tray only when closing keeps it running. */
export function loginItemArguments(settings: BackgroundModeSettings): string[] {
  return settings.runInBackground ? [BACKGROUND_LAUNCH_ARGUMENT] : [];
}

function trayMenuLabels(zh: boolean) {
  return zh
    ? { open: "打开星云", newThread: "新建会话", quit: "退出星云" }
    : { open: "Open Nebula", newThread: "New thread", quit: "Quit Nebula" };
}

/**
 * Windows background mode: closing the main window hides it to the tray, so agents, notifications
 * and the taskbar keep working, and Nebula can start at login straight into the tray.
 */
export class DesktopBackgroundMode extends Context.Service<
  DesktopBackgroundMode,
  {
    /** Runs once Electron is ready and before the main window opens. */
    readonly start: Effect.Effect<void>;
    readonly configure: (settings: ClientSettings) => Effect.Effect<void>;
  }
>()("@t3tools/desktop/window/DesktopBackgroundMode") {}

/** @public */
export const make = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const electronApp = yield* ElectronApp.ElectronApp;
  const electronWindow = yield* ElectronWindow.ElectronWindow;
  const desktopWindow = yield* DesktopWindow.DesktopWindow;
  const desktopState = yield* DesktopState.DesktopState;
  const assets = yield* DesktopAssets.DesktopAssets;
  const clientSettings = yield* DesktopClientSettings.DesktopClientSettings;
  const launchArguments = yield* HostProcess.Arguments;
  const context = yield* Effect.context<never>();
  const runSync = Effect.runSyncWith(context);
  const runFork = Effect.runForkWith(context);
  const supported = environment.platform === "win32";

  let runInBackground = false;
  // Windows is logging off or shutting down; a hidden window must not hold that up.
  let sessionEnding = false;
  let tray: Electron.Tray | null = null;

  const activate = () =>
    void runFork(
      desktopWindow.activate.pipe(
        Effect.catchCause((cause) => logWarning("could not open the window", { cause })),
      ),
    );
  const newThread = () =>
    void runFork(
      desktopWindow
        .dispatchMenuAction("chat.new")
        .pipe(Effect.catchCause((cause) => logWarning("could not open a new thread", { cause }))),
    );
  const quit = () => void runFork(electronApp.quit);

  const syncTray = Effect.fn("DesktopBackgroundMode.syncTray")(function* (language: string) {
    if (!runInBackground) {
      tray?.destroy();
      tray = null;
      return;
    }
    if (tray === null) {
      const icons = yield* assets.iconPaths;
      const icon = Option.getOrUndefined(Option.orElse(icons.ico, () => icons.png));
      if (icon === undefined) {
        yield* logWarning("no icon for the tray");
        return;
      }
      tray = new Electron.Tray(icon);
      tray.on("click", activate);
    }
    const systemLocale = yield* electronApp.systemLocale;
    const labels = trayMenuLabels(
      (language === "system" ? systemLocale : language).startsWith("zh"),
    );
    tray.setToolTip(environment.displayName);
    tray.setContextMenu(
      Electron.Menu.buildFromTemplate([
        { label: labels.open, click: activate },
        { label: labels.newThread, click: newThread },
        { type: "separator" },
        { label: labels.quit, click: quit },
      ]),
    );
  });

  const syncLoginItem = Effect.fn("DesktopBackgroundMode.syncLoginItem")(function* (
    settings: BackgroundModeSettings,
  ) {
    // A development build's executable is Electron itself, which cannot open this app alone.
    if (!environment.isPackaged) return;
    const failure = yield* Effect.sync(() => {
      try {
        Electron.app.setLoginItemSettings({
          openAtLogin: settings.openAtLogin,
          args: loginItemArguments(settings),
        });
        return null;
      } catch (error) {
        return { error };
      }
    });
    if (failure !== null) yield* logWarning("could not update the login item", failure);
  });

  const apply = Effect.fn("DesktopBackgroundMode.apply")(function* (
    settings: BackgroundModeSettings,
    language: string,
  ) {
    const wasRunningInBackground = runInBackground;
    runInBackground = settings.runInBackground;
    yield* syncTray(language);
    yield* syncLoginItem(settings);
    if (wasRunningInBackground && !runInBackground) {
      // Without the tray a hidden window could not be opened again.
      const main = yield* electronWindow.main;
      if (Option.isSome(main) && !main.value.isDestroyed() && !main.value.isVisible()) {
        yield* desktopWindow.activate.pipe(Effect.ignoreCause);
      }
    }
  });

  const hideMainInsteadOfClosing = (window: Electron.BrowserWindow) => {
    window.on("session-end", () => {
      sessionEnding = true;
    });
    window.on("close", (event) => {
      if (!runInBackground || sessionEnding || runSync(Ref.get(desktopState.quitting))) return;
      const main = runSync(electronWindow.main);
      if (Option.isNone(main) || main.value !== window) return;
      event.preventDefault();
      window.hide();
    });
  };

  if (supported) {
    yield* electronApp.on(
      "browser-window-created",
      (_event: unknown, window: Electron.BrowserWindow) => hideMainInsteadOfClosing(window),
    );
    yield* electronApp.on("will-quit", () => {
      tray?.destroy();
      tray = null;
    });
  }

  return DesktopBackgroundMode.of({
    start: Effect.gen(function* () {
      if (!supported) return;
      const saved = yield* clientSettings.get.pipe(Effect.orElseSucceed(() => Option.none()));
      // A login launch opens hidden, so it always gets a tray to open the window from.
      const launchedInBackground = launchArguments.includes(BACKGROUND_LAUNCH_ARGUMENT);
      yield* apply(
        {
          runInBackground:
            launchedInBackground || (Option.isSome(saved) && saved.value.windowsRunInBackground),
          openAtLogin: Option.isSome(saved) && saved.value.windowsOpenAtLogin,
        },
        Option.isSome(saved) ? saved.value.language : "system",
      );
    }).pipe(Effect.withSpan("DesktopBackgroundMode.start")),
    configure: Effect.fn("DesktopBackgroundMode.configure")(function* (settings) {
      if (!supported) return;
      yield* apply(
        {
          runInBackground: settings.windowsRunInBackground,
          openAtLogin: settings.windowsOpenAtLogin,
        },
        settings.language,
      );
    }),
  });
});

export const layer = Layer.effect(DesktopBackgroundMode, make);
