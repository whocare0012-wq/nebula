import type { ServerProviderUsageWindow } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

const QUOTA_HEADING = "### Quota Limits";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// agy writes resets as "Oct 02, 2026, 14:00 UTC".
const RESET = /^([A-Z][a-z]{2}) (\d{1,2}), (\d{4}), (\d{2}):(\d{2}) UTC$/;
const REMAINING = /^(\d+(?:\.\d+)?)% remaining(?: \(resets (.+)\))?$/;
const MODEL_FAMILIES = ["gemini", "claude", "gpt"] as const;

function resetIso(text: string): string | undefined {
  const match = RESET.exec(text.trim());
  if (!match) return undefined;
  const month = MONTHS.indexOf(match[1]!);
  if (month === -1) return undefined;
  const at = Date.UTC(
    Number(match[3]),
    month,
    Number(match[2]),
    Number(match[4]),
    Number(match[5]),
  );
  return Number.isFinite(at) ? DateTime.formatIso(DateTime.makeUnsafe(at)) : undefined;
}

const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

function windowShape(
  bucket: string,
): Pick<ServerProviderUsageWindow, "kind" | "windowDurationMins"> {
  if (/weekly|week/i.test(bucket)) return { kind: "weekly", windowDurationMins: 7 * 24 * 60 };
  if (/monthly|month/i.test(bucket)) return { kind: "monthly" };
  if (/\b5\s*h|5-hour|five/i.test(bucket)) return { kind: "session", windowDurationMins: 5 * 60 };
  if (/daily|day/i.test(bucket)) return { kind: "other", windowDurationMins: 24 * 60 };
  return { kind: "other" };
}

/** The models a group such as "Claude and GPT models" meters, or every model when it names none. */
function groupModelIds(group: string | undefined, modelSlugs: ReadonlyArray<string>) {
  const families = MODEL_FAMILIES.filter((family) => group?.toLowerCase().includes(family));
  if (families.length === 0) return undefined;
  return modelSlugs.filter((model) => families.some((family) => model.includes(family)));
}

/**
 * Reads the Markdown that agy's own `/usage` command answers with. Each "N% remaining" bucket under
 * "### Quota Limits" becomes a window; unit counts, alerts and agent error lines are not meters.
 */
export function parseAntigravityUsageReply(
  text: string,
  modelSlugs: ReadonlyArray<string>,
): ServerProviderUsageWindow[] {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === QUOTA_HEADING);
  if (start === -1) return [];
  const windows: ServerProviderUsageWindow[] = [];
  let group: string | undefined;
  for (const line of lines.slice(start + 1)) {
    if (line.trimStart().startsWith("### ")) break;
    const indent = line.length - line.trimStart().length;
    const item = line.trim().match(/^- \*\*(.+?)\*\*(.*)$/);
    if (!item) continue;
    const name = item[1]!.trim();
    const rest = item[2]!.trim();
    if (indent === 0) {
      group = rest === "" ? name : undefined;
      continue;
    }
    const bucket = name.replace(/:$/, "").trim();
    const remaining = REMAINING.exec(rest);
    if (!name.endsWith(":") || !remaining || group === undefined) continue;
    const percent = Number(remaining[1]);
    if (!(percent >= 0 && percent <= 100)) continue;
    const resetsAt = remaining[2] === undefined ? undefined : resetIso(remaining[2]);
    const modelIds = groupModelIds(group, modelSlugs);
    windows.push({
      id: `antigravity-${slug(group)}-${slug(bucket)}`,
      label: `${group} · ${bucket}`,
      usedPercent: 100 - percent,
      ...windowShape(bucket),
      ...(resetsAt ? { resetsAt } : {}),
      ...(modelIds ? { modelIds } : {}),
    });
  }
  return windows;
}

const CliBucket = Schema.Struct({
  id: Schema.String,
  name: Schema.optional(Schema.String),
  window: Schema.optional(Schema.String),
  remaining_fraction: Schema.optional(Schema.Number),
  reset_time: Schema.optional(Schema.String),
  disabled: Schema.optional(Schema.Boolean),
});
const CliUsage = Schema.Struct({
  status: Schema.optional(Schema.String),
  num_turns: Schema.optional(Schema.Number),
  command: Schema.optional(
    Schema.Struct({
      name: Schema.String,
      data: Schema.optional(
        Schema.Struct({
          groups: Schema.optional(
            Schema.Array(
              Schema.Struct({
                name: Schema.optional(Schema.String),
                buckets: Schema.optional(Schema.Array(CliBucket)),
              }),
            ),
          ),
        }),
      ),
    }),
  ),
});
const decodeCliUsage = Schema.decodeUnknownOption(Schema.fromJsonString(CliUsage));

const CLI_WINDOWS: Record<
  string,
  Pick<ServerProviderUsageWindow, "kind" | "windowDurationMins">
> = {
  weekly: { kind: "weekly", windowDurationMins: 7 * 24 * 60 },
  "5h": { kind: "session", windowDurationMins: 5 * 60 },
};
const CLI_WINDOW_LABELS: Record<string, string> = { weekly: "Weekly", "5h": "5-hour" };

/**
 * Reads `agy --print /usage --output-format json`. Returns undefined unless agy answered as the
 * `/usage` command; an agy that no longer knows the command runs a model turn instead.
 */
export function parseAntigravityCliUsage(
  stdout: string,
  modelSlugs: ReadonlyArray<string>,
): ServerProviderUsageWindow[] | undefined {
  const json = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .findLast((line) => line.startsWith("{"));
  const output = json === undefined ? undefined : Option.getOrUndefined(decodeCliUsage(json));
  if (
    output?.command?.name !== "usage" ||
    (output.status !== undefined && output.status !== "SUCCESS") ||
    (output.num_turns ?? 0) !== 0
  ) {
    return undefined;
  }
  const windows: ServerProviderUsageWindow[] = [];
  for (const group of output.command.data?.groups ?? []) {
    const groupName = group.name?.trim() || "Antigravity";
    const modelIds = groupModelIds(groupName, modelSlugs);
    for (const bucket of group.buckets ?? []) {
      const remaining = bucket.remaining_fraction;
      if (bucket.disabled === true || remaining === undefined || !Number.isFinite(remaining)) {
        continue;
      }
      const fraction = Math.min(1, Math.max(0, remaining));
      const resetAt = bucket.reset_time === undefined ? NaN : Date.parse(bucket.reset_time);
      // An untouched bucket reports a Unix-epoch or rolling reset that means nothing yet.
      const resetsAt =
        fraction < 1 && resetAt > 0 ? DateTime.formatIso(DateTime.makeUnsafe(resetAt)) : undefined;
      const window = bucket.window ?? "";
      windows.push({
        id: `antigravity-${slug(bucket.id)}`,
        label: `${groupName} · ${CLI_WINDOW_LABELS[window] ?? bucket.name?.trim() ?? bucket.id}`,
        usedPercent: (1 - fraction) * 100,
        ...(CLI_WINDOWS[window] ?? windowShape(bucket.name ?? "")),
        ...(resetsAt ? { resetsAt } : {}),
        ...(modelIds ? { modelIds } : {}),
      });
    }
  }
  return windows;
}
