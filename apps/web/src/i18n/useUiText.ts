import { isChineseLocale } from "./customLocale";
import { chineseDuration } from "./conversationLabel";
import { useGT, useLocale } from "gt-react";
import { zhCN } from "./catalog";
import { uiText } from "./index";
import { customMessageSource } from "./customMessageSource";

/** Custom terms use GT's reactive locale and shipped catalog, with no remote translation. */
export function useUiText() {
  // Custom sources are looked up at runtime; the destructuring keeps `gt generate` from scanning them.
  const [gt] = [useGT()];
  const requestedLocale = useLocale();
  const locale = isChineseLocale(requestedLocale) ? "zh" : requestedLocale;
  return (source: string, values?: Readonly<Record<string, unknown>>) => {
    if (!Object.hasOwn(zhCN, source)) return uiText(source, values, "en");
    const variables: Record<string, string> = {};
    for (const match of source.matchAll(/\{([A-Za-z0-9_]+)\}/g)) {
      const name = match[1]!;
      variables[name] =
        values && Object.hasOwn(values, name)
          ? name === "duration" &&
            locale.startsWith("zh") &&
            /^(Worked for|Continued for|You stopped after) /.test(source)
            ? chineseDuration(String(values[name]))
            : String(values[name])
          : match[0];
    }
    // The source is application copy; user strings are only interpolation variables.
    return gt(customMessageSource(source), {
      ...variables,
      $context: "stardust-custom",
      $locale: locale,
    });
  };
}
