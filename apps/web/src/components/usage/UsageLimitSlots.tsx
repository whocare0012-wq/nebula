import { observeResize } from "~/lib/observeResize";
import { useState, useRef, useLayoutEffect } from "react";
import * as Schema from "effect/Schema";
import { ProviderDriverKind, defaultInstanceIdForDriver } from "@t3tools/contracts";
import { useRouter, useNavigate } from "@tanstack/react-router";
import { useLocalStorage } from "~/hooks/useLocalStorage";
import { useUiText } from "~/i18n/useUiText";
import { UsageLimitBrand } from "./UsageLimitBrand";
import { providerClients } from "../settings/providerDriverMeta";
import { XIcon } from "lucide-react";

export const LIMIT_SLOTS_KEY = "t3code:usage-limit-slots:v1";
const PITCH: Record<string, readonly [string, string]> = {
  codex: [
    "OpenAI",
    "OpenAI's coding agent. Sign in with ChatGPT to work across large codebases and longer tasks.",
  ],
  claudeAgent: ["Anthropic", "Claude Code for writing and coding, with 5-hour and weekly limits."],
  antigravity: ["Google", "Use Gemini through Antigravity for everyday work and batch tasks."],
  cursor: ["Anysphere", "Cursor's command-line agent, with multiple models and monthly limits."],
  grok: ["xAI", "Grok for research and short tasks."],
  opencode: ["SST", "An open-source coding agent for your API keys and local models."],
};
export function limitSlotCandidates(connected: ReadonlySet<string>) {
  // The runtime registry is the supported-provider source; its order is also used in settings.
  const ordered = providerClients.definitions.map((d) => d.driverKind);
  return [
    ...ordered.filter(
      (id) =>
        id !== "openaiCompatible" &&
        providerClients.get(ProviderDriverKind.make(id)) &&
        !connected.has(id),
    ),
    "custom",
  ];
}
export function UsageLimitSlots({
  realCount,
  connected,
  hidden,
}: {
  readonly realCount: number;
  readonly connected: ReadonlySet<string>;
  readonly hidden: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState(4);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Keep the final row slot count in step with the DOM container width; CSS uses the same content-width breakpoint.
  useLayoutEffect(() => {
    const parent = ref.current?.parentElement;
    if (!parent) return;
    const update = () => setColumns(parent.getBoundingClientRect().width < 1100 ? 2 : 4);
    update();
    return observeResize(parent, update);
  }, []);
  const count = realCount === 0 ? columns : Math.ceil(realCount / columns) * columns - realCount;
  const candidates = limitSlotCandidates(connected);
  return (
    <>
      <div ref={ref} className="usage-slots-measure" aria-hidden />
      {!hidden &&
        Array.from(
          { length: realCount === 0 ? count : Math.min(count, candidates.length) },
          (_, i) => (
            <LimitSlot
              key={`${realCount}:${columns}:${i}`}
              index={realCount + i}
              candidates={candidates}
              initial={i}
            />
          ),
        )}
    </>
  );
}
export function LimitSlotsToggle() {
  const text = useUiText();
  const [hidden, setHidden] = useLocalStorage(LIMIT_SLOTS_KEY, false, Schema.Boolean);
  return (
    <button
      type="button"
      className="usage-slots-toggle"
      aria-pressed={!hidden}
      onClick={() => setHidden(!hidden)}
    >
      {hidden ? text("Empty slots: off") : text("Empty slots: shown")}
    </button>
  );
}
export function useLimitSlotsHidden() {
  return useLocalStorage(LIMIT_SLOTS_KEY, false, Schema.Boolean)[0];
}
// Lives outside the component: React Compiler cannot compile dynamic `import()` expressions.
async function openSetupDraftThread(
  router: ReturnType<typeof useRouter>,
  navigate: ReturnType<typeof useNavigate>,
  prompt: string,
) {
  const [
    { createNewThreadHandler, resolveDefaultProjectRef, readLastUsedProjectKey },
    { readProjects },
  ] = await Promise.all([import("~/hooks/useHandleNewThread"), import("~/state/entities")]);
  const project = resolveDefaultProjectRef(readProjects(), [], readLastUsedProjectKey());
  if (project)
    await createNewThreadHandler(router)(project, { prompt, forceNew: true, envMode: "local" });
  else await navigate({ to: "/new", search: { prompt } });
}

function LimitSlot({
  index,
  candidates,
  initial,
}: {
  readonly index: number;
  readonly candidates: readonly string[];
  readonly initial: number;
}) {
  const text = useUiText();
  const navigate = useNavigate();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState(initial);
  const front = useRef<HTMLButtonElement>(null);
  const back = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Move DOM focus after inert changes so keyboard users stay on the visible face.
  useLayoutEffect(() => {
    if (open) front.current?.focus();
    else if (wasOpen.current) back.current?.focus();
    wasOpen.current = open;
  }, [open]);
  const id = candidates[position] ?? "custom";
  const custom = id === "custom";
  const label = custom
    ? text("Custom model / API")
    : (providerClients.get(ProviderDriverKind.make(id))?.label ?? id);
  const number = String(index + 1).padStart(2, "0");
  const openSetupDraft = async () => {
    const prompt = text("Help me connect {provider}, then check its usage limits.", {
      provider: custom ? text("a custom model") : label,
    });
    await openSetupDraftThread(router, navigate, prompt);
  };
  const goSettings = () =>
    void navigate({
      to: "/settings/providers",
      search: custom ? {} : { instanceId: defaultInstanceIdForDriver(ProviderDriverKind.make(id)) },
    });
  return (
    <section data-limit-slot data-open={open || undefined} className="usage-limit-flip">
      <div className="usage-limit-flip-inner">
        <button
          ref={back}
          type="button"
          className="usage-slot-back"
          inert={open}
          aria-hidden={open}
          aria-label={text("Empty slot {number}, flip to see a recommendation", { number })}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              event.stopPropagation();
              setOpen(true);
            }
          }}
          onClick={() => {
            setOpen(true);
            front.current?.focus();
          }}
        >
          <span className="usage-slot-stars" aria-hidden>
            {Array.from({ length: 26 }, (_, i) => (
              <i
                key={i}
                style={{
                  left: `${(i * 37 + 9) % 97}%`,
                  top: `${(i * 53 + 7) % 97}%`,
                  opacity: 0.25 + (i % 6) / 10,
                }}
              />
            ))}
          </span>
          <svg className="usage-slot-spark" viewBox="0 0 24 24" aria-hidden>
            <path
              d="M12 0c.6 6.2 5.8 11.4 12 12-6.2.6-11.4 5.8-12 12-.6-6.2-5.8-11.4-12-12C6.2 11.4 11.4 6.2 12 0z"
              fill="currentColor"
            />
          </svg>
          <span className="usage-slot-number">{text("Empty slot {number}", { number })}</span>
          <span className="usage-slot-holo usage-slot-compass" aria-hidden>
            <svg viewBox="0 0 130 130" className="usage-compass-svg">
              <circle
                cx="65"
                cy="65"
                r="54"
                fill="none"
                className="usage-compass-outer"
                strokeWidth="1"
                strokeDasharray="2 3"
              />
              <circle
                cx="65"
                cy="65"
                r="39"
                fill="none"
                className="usage-compass-mid"
                strokeWidth="2"
                strokeDasharray="115 140"
                transform="rotate(-65 65 65)"
              />
              <circle
                cx="65"
                cy="65"
                r="24"
                fill="none"
                className="usage-compass-inner"
                strokeWidth="2"
                strokeDasharray="68 140"
                transform="rotate(25 65 65)"
              />
              <circle cx="65" cy="65" r="6" className="usage-compass-core" />
              <circle cx="101" cy="49" r="4" className="usage-compass-node-a" />
              <circle cx="40" cy="24" r="3.5" className="usage-compass-node-b" />
            </svg>
            <b>T3</b>
          </span>
          <span className="usage-slot-caption">
            <strong>{text("Room for one more model")}</strong>
            <small>{text("Flip to see what to connect next")}</small>
          </span>
          <span className="usage-slot-hint">{text("Click to flip")}</span>
        </button>
        <div className="usage-slot-front" inert={!open} aria-hidden={!open}>
          <div className="usage-slot-top">
            <div className="usage-slot-logo">
              {custom ? (
                "API"
              ) : (
                <UsageLimitBrand driver={ProviderDriverKind.make(id)} label={label} large />
              )}
            </div>
            <button
              ref={front}
              type="button"
              aria-label={text("Collapse recommendation")}
              onClick={() => {
                setOpen(false);
                back.current?.focus();
              }}
            >
              <XIcon size={12} />
            </button>
          </div>
          <h4>{label}</h4>
          <span>
            {custom
              ? text("OpenAI-compatible endpoints, local models and ACP agents")
              : (PITCH[id]?.[0] ?? label)}
          </span>
          <p>
            {custom
              ? text(
                  "Have an API key or a local model? Ask AI to help configure it and check the limits.",
                )
              : text(
                  PITCH[id]?.[1] ??
                    "Connect this supported provider and check its available limits.",
                )}
          </p>
          <div className="usage-slot-actions">
            <button
              type="button"
              className="usage-slot-primary"
              onClick={() => void openSetupDraft()}
            >
              {text("Ask AI to connect it")}
            </button>
            <div>
              <button type="button" onClick={goSettings}>
                {text("Manual setup")}
              </button>
              {position < candidates.length - 1 ? (
                <button type="button" onClick={() => setPosition(position + 1)}>
                  {text("Try another")}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
