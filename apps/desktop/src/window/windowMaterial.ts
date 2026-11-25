import type * as Electron from "electron";

export type WindowMaterial = "mica" | "none";

// Mica needs DWMWA_SYSTEMBACKDROP_TYPE, which Windows 11 22H2 (build 22621) added.
const MICA_MIN_WINDOWS_BUILD = 22621;
const MICA_BACKGROUND_COLOR = "#00000000";

const micaWindows = new WeakSet<Electron.BrowserWindow>();

export function supportsMica(platform: NodeJS.Platform, osRelease: string): boolean {
  if (platform !== "win32") return false;
  const build = Number(osRelease.split(".")[2]);
  return Number.isInteger(build) && build >= MICA_MIN_WINDOWS_BUILD;
}

export function hasMica(window: Electron.BrowserWindow): boolean {
  return micaWindows.has(window);
}

/** The window background must be transparent for the system backdrop to show through. */
export function windowBackgroundColor(window: Electron.BrowserWindow, opaque: string): string {
  return hasMica(window) ? MICA_BACKGROUND_COLOR : opaque;
}

export function applyWindowMaterial(
  window: Electron.BrowserWindow,
  material: WindowMaterial,
  opaqueBackgroundColor: string,
): void {
  if (window.isDestroyed()) return;
  if (material === "mica") micaWindows.add(window);
  else micaWindows.delete(window);
  window.setBackgroundMaterial(material);
  window.setBackgroundColor(windowBackgroundColor(window, opaqueBackgroundColor));
}
