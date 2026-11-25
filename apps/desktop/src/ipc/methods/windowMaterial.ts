import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as HostProcess from "@t3tools/shared/HostProcess";

import * as ElectronTheme from "../../electron/ElectronTheme.ts";
import * as ElectronWindow from "../../electron/ElectronWindow.ts";
import { getInitialWindowBackgroundColor } from "../../window/DesktopWindow.ts";
import { applyWindowMaterial, supportsMica } from "../../window/windowMaterial.ts";
import * as DesktopIpc from "../DesktopIpc.ts";
import { SET_WINDOW_MATERIAL_CHANNEL } from "../channels.ts";

/** Lets the main window show the Windows 11 Mica backdrop behind the renderer's translucent chrome. */
export const installWindowMaterial = Effect.fn("desktop.ipc.installWindowMaterial")(function* () {
  const ipc = yield* DesktopIpc.DesktopIpc;
  const electronWindow = yield* ElectronWindow.ElectronWindow;
  const electronTheme = yield* ElectronTheme.ElectronTheme;
  const supported = supportsMica(yield* HostProcess.Platform, yield* HostProcess.KernelRelease);
  yield* ipc.handle(
    DesktopIpc.makeIpcMethod({
      channel: SET_WINDOW_MATERIAL_CHANNEL,
      payload: Schema.Literals(["mica", "none"]),
      result: Schema.Boolean,
      handler: Effect.fn("desktop.ipc.setWindowMaterial")(function* (material) {
        if (!supported) return false;
        const window = yield* electronWindow.main;
        if (Option.isNone(window)) return false;
        const opaque = getInitialWindowBackgroundColor(yield* electronTheme.shouldUseDarkColors);
        const failure = yield* Effect.sync(() => {
          try {
            applyWindowMaterial(window.value, material, opaque);
            return null;
          } catch (error) {
            return { error };
          }
        });
        if (failure !== null) {
          yield* Effect.logWarning("Could not set the window material", failure.error);
          return false;
        }
        return material === "mica";
      }),
    }),
  );
});
