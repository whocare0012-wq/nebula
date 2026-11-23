import type { ThreadStructure } from "@t3tools/client-runtime/state/shell";
import { memo, useEffect, useState } from "react";
import { useUiText } from "../../i18n/useUiText";
import { formatStatDuration } from "./sessionStats";
import { selectTurnThroughput, throughputReading } from "./turnThroughput";

/** Local one-second clock only; no polling requests or updates to the chat timeline. */
export function useVisibleTurnClock(ticking: boolean) {
  const [now, setNow] = useState(() => Date.now());
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Keep the elapsed-time clock running only while the document is visible and the turn is active.
  useEffect(() => {
    if (!ticking) return;
    let timer: ReturnType<typeof setInterval> | undefined;
    const sync = () => {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
      if (document.visibilityState !== "hidden") {
        setNow(Date.now());
        timer = setInterval(() => setNow(Date.now()), 1000);
      }
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => {
      if (timer !== undefined) clearInterval(timer);
      document.removeEventListener("visibilitychange", sync);
    };
  }, [ticking]);
  return now;
}

export const TurnThroughput = memo(function TurnThroughput({
  projection,
  disconnected = false,
  now,
}: {
  projection: ThreadStructure;
  disconnected?: boolean;
  now?: number | undefined;
}) {
  const uiText = useUiText();
  const snapshot = selectTurnThroughput(projection);
  const localNow = useVisibleTurnClock(
    now === undefined && snapshot?.running === true && !disconnected,
  );
  if (!snapshot)
    return <p className="text-muted-foreground">{uiText("Turn usage has not been reported.")}</p>;
  const reading = throughputReading(snapshot, now ?? localNow);
  const notReported = uiText("Not reported");
  const rate =
    reading.rate === null ? notReported : uiText("{rate} tok/s", { rate: reading.rate.toFixed(1) });
  const phase = uiText(disconnected ? "Disconnected" : snapshot.phase);
  return (
    <section
      className="space-y-2 text-xs text-muted-foreground"
      data-turn-throughput
      aria-label={uiText("Current turn usage")}
    >
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5" data-throughput-details>
        <dt>{uiText("Status")}</dt>
        <dd className="text-right text-foreground">{phase}</dd>
        <dt>{uiText("Elapsed time")}</dt>
        <dd className="text-right tabular-nums">{formatStatDuration(reading.elapsedMs, uiText)}</dd>
        <dt>{uiText("Output")}</dt>
        <dd className="text-right tabular-nums">
          {snapshot.outputTokens === null
            ? notReported
            : uiText(snapshot.partial ? "{count} tokens (partial)" : "{count} tokens", {
                count: snapshot.outputTokens.toLocaleString(),
              })}
        </dd>
        <dt>{uiText("Average end-to-end rate")}</dt>
        <dd className="text-right tabular-nums">
          {disconnected ? uiText("Usage data is stale") : rate}
        </dd>
        <dt>{uiText("Model")}</dt>
        <dd className="min-w-0 text-right break-words">
          {snapshot.provider} / {snapshot.model}
        </dd>
        {snapshot.running && reading.reportAgeMs !== null ? (
          <>
            <dt>{uiText("Last report")}</dt>
            <dd className="text-right tabular-nums">
              {uiText("{duration} ago", {
                duration: formatStatDuration(reading.reportAgeMs, uiText),
              })}
            </dd>
          </>
        ) : null}
      </dl>
      <p className="leading-relaxed">
        {uiText(
          "Includes thinking, tool calls, and network waits. Main task only. Usage reports may be delayed.",
        )}
      </p>
    </section>
  );
});
