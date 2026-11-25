import type * as Electron from "electron";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  applyWindowMaterial,
  hasMica,
  supportsMica,
  windowBackgroundColor,
} from "./windowMaterial.ts";

function fakeWindow() {
  const window = {
    isDestroyed: () => false,
    setBackgroundMaterial: vi.fn(),
    setBackgroundColor: vi.fn(),
  };
  return { window, electronWindow: window as unknown as Electron.BrowserWindow };
}

describe("supportsMica", () => {
  it("needs Windows 11 22H2 or later", () => {
    expect(supportsMica("win32", "10.0.22621")).toBe(true);
    expect(supportsMica("win32", "10.0.26300")).toBe(true);
    expect(supportsMica("win32", "10.0.22000")).toBe(false);
    expect(supportsMica("win32", "10.0.19045")).toBe(false);
    expect(supportsMica("darwin", "24.0.0")).toBe(false);
  });
});

describe("applyWindowMaterial", () => {
  it("clears the window background while Mica shows and restores it after", () => {
    const { window, electronWindow } = fakeWindow();

    applyWindowMaterial(electronWindow, "mica", "#ffffff");
    expect(window.setBackgroundMaterial).toHaveBeenLastCalledWith("mica");
    expect(window.setBackgroundColor).toHaveBeenLastCalledWith("#00000000");
    expect(hasMica(electronWindow)).toBe(true);
    expect(windowBackgroundColor(electronWindow, "#000000")).toBe("#00000000");

    applyWindowMaterial(electronWindow, "none", "#ffffff");
    expect(window.setBackgroundMaterial).toHaveBeenLastCalledWith("none");
    expect(window.setBackgroundColor).toHaveBeenLastCalledWith("#ffffff");
    expect(windowBackgroundColor(electronWindow, "#000000")).toBe("#000000");
  });
});
