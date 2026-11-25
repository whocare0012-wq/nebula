import * as Effect from "effect/Effect";
import { beforeEach, expect, vi } from "vite-plus/test";
import { it } from "@effect/vitest";
import * as HostProcess from "@t3tools/shared/HostProcess";

const native = vi.hoisted(() => ({
  setProgressBar: vi.fn(),
  isDestroyed: vi.fn(() => false),
  listeners: new Map<string, (...args: unknown[]) => void>(),
}));
vi.mock("electron", () => ({
  app: {
    on: (event: string, listener: (...args: unknown[]) => void) =>
      native.listeners.set(event, listener),
    removeListener: (event: string) => native.listeners.delete(event),
  },
  BrowserWindow: { getAllWindows: () => [native] },
}));

import * as ElectronApp from "../../electron/ElectronApp.ts";
import * as DesktopIpc from "../DesktopIpc.ts";
import { installTaskbarProgress } from "./taskbarProgress.ts";

beforeEach(() => {
  vi.clearAllMocks();
  native.listeners.clear();
});

const run = (
  platform: NodeJS.Platform,
  body: (send: (payload: unknown) => Promise<unknown>) => Effect.Effect<void>,
) =>
  Effect.gen(function* () {
    const handlers = new Map<string, DesktopIpc.DesktopIpcHandleListener>();
    yield* Effect.scoped(
      Effect.gen(function* () {
        yield* installTaskbarProgress();
        const handler = handlers.get("desktop:set-taskbar-progress")!;
        yield* body((payload) => Promise.resolve(handler({ sender: { id: 1 } }, payload)));
      }),
    ).pipe(
      Effect.provideService(HostProcess.Platform, platform),
      Effect.provide([
        ElectronApp.layer,
        DesktopIpc.layerTest({
          handle: (channel, handler) => {
            handlers.set(channel, handler);
          },
          removeHandler: (channel) => {
            handlers.delete(channel);
          },
          on: vi.fn(),
          removeAllListeners: vi.fn(),
        }),
      ]),
    );
  });

it.effect("shows an indeterminate Windows taskbar bar while agents work and clears it", () =>
  run("win32", (send) =>
    Effect.gen(function* () {
      yield* Effect.promise(() => expect(send({ working: "yes" })).rejects.toBeDefined());
      yield* Effect.promise(() => send({ working: true }));
      yield* Effect.promise(() => send({ working: true }));
      expect(native.setProgressBar).toHaveBeenCalledExactlyOnceWith(2, { mode: "indeterminate" });
      native.listeners.get("browser-window-created")!({}, native);
      expect(native.setProgressBar).toHaveBeenCalledTimes(2);
      yield* Effect.promise(() => send({ working: false }));
      expect(native.setProgressBar).toHaveBeenLastCalledWith(-1, { mode: "none" });
      yield* Effect.promise(() => send({ working: true }));
    }),
  ).pipe(
    Effect.tap(() =>
      Effect.sync(() => {
        // Closing the app's scope clears a bar that was still showing.
        expect(native.setProgressBar).toHaveBeenLastCalledWith(-1, { mode: "none" });
        expect(native.listeners.size).toBe(0);
      }),
    ),
  ),
);

it.effect("leaves the taskbar alone off Windows", () =>
  run("darwin", (send) =>
    Effect.gen(function* () {
      yield* Effect.promise(() => send({ working: true }));
      expect(native.setProgressBar).not.toHaveBeenCalled();
      expect(native.listeners.size).toBe(0);
    }),
  ),
);
