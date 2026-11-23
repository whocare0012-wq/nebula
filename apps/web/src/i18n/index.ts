import { zhCN } from "./catalog";
import { readCustomLocale } from "./customLocale";
export type UiLocale = "zh-CN" | "en";
export function readUiLocale(): UiLocale {
  return readCustomLocale();
}
// Legacy custom copy follows the official language setting; user content is never translated.
export function uiText(
  source: string,
  values?: Readonly<Record<string, unknown>>,
  locale: UiLocale = readUiLocale(),
): string {
  const translated = locale === "zh-CN" ? (zhCN[source] ?? source) : source;
  if (!values) return translated;
  return translated.replace(/\{([A-Za-z0-9_]+)\}/g, (placeholder, name: string) =>
    Object.hasOwn(values, name) ? String(values[name]) : placeholder,
  );
}
