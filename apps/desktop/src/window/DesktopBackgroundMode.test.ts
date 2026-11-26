import { describe, expect, it } from "vite-plus/test";

import { BACKGROUND_LAUNCH_ARGUMENT } from "../app/launchArguments.ts";
import { loginItemArguments } from "./DesktopBackgroundMode.ts";

describe("loginItemArguments", () => {
  it("starts hidden in the tray only when closing keeps Nebula running", () => {
    expect(loginItemArguments({ runInBackground: true, openAtLogin: true })).toEqual([
      BACKGROUND_LAUNCH_ARGUMENT,
    ]);
    expect(loginItemArguments({ runInBackground: false, openAtLogin: true })).toEqual([]);
  });
});
