import type { PreviewPin, PreviewAnnotationPayload } from "@t3tools/contracts";
export function previewPinKey(url: string, file?: string): string {
  if (file) return `file:${file}`;
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    if (["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)) parsed.port = "";
    return parsed.toString();
  } catch {
    return url.split("#")[0] ?? url;
  }
}
export function filterPreviewPins(
  pins: readonly PreviewPin[],
  filter: "all" | "pending" | "fixed",
) {
  return pins.filter(
    (pin) =>
      filter === "all" || (filter === "fixed" ? pin.status === "fixed" : pin.status !== "fixed"),
  );
}
function previewPinsMessage(pins: readonly PreviewPin[]): string {
  return pins
    .map(
      (p) =>
        `${p.number}. ${p.text}\n   ${p.tag} · ${p.elementText}\n   定位：${p.selectorChain[0] ?? "未找到位置"} · 相对位置 ${p.relative.x.toFixed(3)}, ${p.relative.y.toFixed(3)}`,
    )
    .join("\n\n");
}
export function previewPinsPayload(
  pins: readonly PreviewPin[],
  id: string,
  url: string,
  title: string | null,
  createdAt: string,
): PreviewAnnotationPayload {
  const pending = pins.filter((p) => p.status === "unsent");
  return {
    id,
    pageUrl: url,
    pageTitle: title,
    createdAt,
    comment: previewPinsMessage(pending),
    elements: pending.map((p) => ({ id: p.id, element: p.element, rect: p.rect })),
    regions: [],
    strokes: [],
    styleChanges: [],
    screenshot: null,
    pins: pending,
  };
}
