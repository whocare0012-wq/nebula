let latestRequest = 0;

/**
 * Asks the desktop shell for the Windows 11 Mica backdrop and marks the document only once the
 * window shows it, so the chrome never turns translucent over an opaque or black window.
 */
export function syncWindowMaterial(root: HTMLElement, micaEnabled: boolean): void {
  const setWindowMaterial = window.desktopBridge?.setWindowMaterial;
  if (setWindowMaterial === undefined) return;
  const request = ++latestRequest;
  if (!micaEnabled) delete root.dataset.windowMaterial;
  void setWindowMaterial(micaEnabled ? "mica" : "none").then(
    (active) => {
      if (request !== latestRequest) return;
      if (active) root.dataset.windowMaterial = "mica";
      else delete root.dataset.windowMaterial;
    },
    () => undefined,
  );
}
