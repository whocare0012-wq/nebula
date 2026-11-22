import { type UsageCurrency, USD, formatUsd as formatUsdIn } from "@t3tools/shared/usageFormat";
import * as Schema from "effect/Schema";
import { useId } from "react";

import {
  readLocalStorageValue,
  subscribeLocalStorageKey,
  useLocalStorage,
} from "../../hooks/useLocalStorage";
import { uiText } from "../../i18n";
import { InlineButton } from "../ui/button";
import { Label } from "../ui/label";
import {
  NumberField,
  NumberFieldDecrement,
  NumberFieldGroup,
  NumberFieldIncrement,
  NumberFieldInput,
} from "../ui/number-field";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Toggle } from "../ui/toggle-group";
import { UsageSegments } from "./UsageSegments";

const STORAGE_KEY = "t3code:usage-currency:v1";

const UsageCurrencyPreference = Schema.Struct({
  code: Schema.Literals(["USD", "CNY"]),
  cnyPerUsd: Schema.Number.check(Schema.isGreaterThan(0)),
});
type UsageCurrencyPreference = typeof UsageCurrencyPreference.Type;

const DEFAULT_PREFERENCE: UsageCurrencyPreference = { code: "USD", cnyPerUsd: 7.2 };

function toCurrency(preference: UsageCurrencyPreference): UsageCurrency {
  return preference.code === "CNY" ? { code: "CNY", perUsd: preference.cnyPerUsd } : USD;
}

function readPreference(): UsageCurrencyPreference {
  return typeof localStorage === "undefined"
    ? DEFAULT_PREFERENCE
    : readLocalStorageValue(STORAGE_KEY, DEFAULT_PREFERENCE, UsageCurrencyPreference);
}

// Usage views format costs from plain helpers, so they read this snapshot; the page re-keys on change.
let current = toCurrency(readPreference());
if (typeof window !== "undefined") {
  subscribeLocalStorageKey(STORAGE_KEY, () => {
    current = toCurrency(readPreference());
  });
}

/** Formats a USD amount in the currency the viewer picked on the Usage page. */
export function formatUsd(value: number, locale?: string): string {
  return formatUsdIn(value, locale, current);
}

/** A whole amount in the displayed currency, such as "$12" or "¥86", for axes and large totals. */
export function formatUsdWhole(value: number): string {
  const symbol = current.code === "CNY" ? "¥" : "$";
  return `${symbol}${Math.round(value * costDisplayFactor()).toLocaleString()}`;
}

/** Whether `value` USD lands on a whole number once converted, within float noise. */
export function isWholeDisplayedCost(value: number): boolean {
  const displayed = value * costDisplayFactor();
  return Math.abs(displayed - Math.round(displayed)) < 1e-6;
}

/** Multiplier from USD into the displayed currency, for rounding chart ticks in that unit. */
export function costDisplayFactor(): number {
  return current.code === "CNY" ? current.perUsd : 1;
}

/** A key that changes whenever costs must be formatted again. */
export function useUsageCurrencyKey(): string {
  const [preference] = useLocalStorage(STORAGE_KEY, DEFAULT_PREFERENCE, UsageCurrencyPreference);
  return preference.code === "CNY" ? `CNY:${preference.cnyPerUsd}` : "USD";
}

export function UsageCurrencyControl() {
  const id = useId();
  const [preference, setPreference] = useLocalStorage(
    STORAGE_KEY,
    DEFAULT_PREFERENCE,
    UsageCurrencyPreference,
  );
  return (
    <span className="flex items-center gap-1.5">
      {preference.code === "CNY" ? (
        <Popover>
          <PopoverTrigger
            render={<InlineButton tone="muted" />}
            aria-label={uiText("Edit exchange rate")}
          >
            <span className="text-xs tabular-nums">$1 = ¥{preference.cnyPerUsd}</span>
          </PopoverTrigger>
          <PopoverPopup side="bottom" align="end" data-usage-portal>
            <div className="w-44">
              <NumberField
                id={id}
                min={0.01}
                step={0.01}
                value={preference.cnyPerUsd}
                onValueChange={(value) => {
                  if (value !== null && value > 0) {
                    setPreference((saved) => ({ ...saved, cnyPerUsd: value }));
                  }
                }}
              >
                <Label htmlFor={id}>{uiText("Yuan per US dollar")}</Label>
                <NumberFieldGroup>
                  <NumberFieldDecrement aria-label={uiText("Decrease exchange rate")} />
                  <NumberFieldInput />
                  <NumberFieldIncrement aria-label={uiText("Increase exchange rate")} />
                </NumberFieldGroup>
              </NumberField>
            </div>
          </PopoverPopup>
        </Popover>
      ) : null}
      <UsageSegments
        aria-label={uiText("Cost currency")}
        variant="segmented"
        value={[preference.code]}
        onValueChange={(next) => {
          const code = next[0];
          if (code === "USD" || code === "CNY") setPreference((saved) => ({ ...saved, code }));
        }}
      >
        <Toggle value="USD" aria-description={uiText("US dollars")}>
          $
        </Toggle>
        <Toggle value="CNY" aria-description={uiText("Chinese yuan")}>
          ¥
        </Toggle>
      </UsageSegments>
    </span>
  );
}
