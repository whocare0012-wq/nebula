import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";

import { readClaudeSettingsEnv } from "../provider/Drivers/ClaudeSkills.ts";

/**
 * The API key Claude Code sends to `origin`, when its configured `ANTHROPIC_BASE_URL` is that
 * relay. The key is only ever sent back to the same origin it is configured for.
 */
export const readClaudeRelayKey = Effect.fn("readClaudeRelayKey")(function* (origin: string) {
  const environment = yield* HostProcess.Environment;
  const settings = yield* readClaudeSettingsEnv({ homePath: "" }, undefined, environment);
  const baseUrl = settings.ANTHROPIC_BASE_URL ?? environment.ANTHROPIC_BASE_URL;
  if (URL.parse(baseUrl?.trim() ?? "")?.origin !== origin) return undefined;
  const key =
    settings.ANTHROPIC_AUTH_TOKEN ??
    settings.ANTHROPIC_API_KEY ??
    environment.ANTHROPIC_AUTH_TOKEN ??
    environment.ANTHROPIC_API_KEY;
  return key?.trim() || undefined;
});
