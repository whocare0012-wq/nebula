import { useUiText } from "~/i18n/useUiText";

import {
  buildTraitsTriggerDisplay,
  getDescriptorStringValue,
  isReasoningControl,
  selectableProviderOptionChoices,
} from "@t3tools/client-runtime/model-traits";
import type { ProviderOptionDescriptor, RuntimeMode } from "@t3tools/contracts";
import type { EffortDisplay } from "@t3tools/contracts/settings";
import { getProviderOptionCurrentLabel } from "@t3tools/shared/model";
import { CheckIcon, GaugeIcon, ChevronRightIcon, WorkflowIcon } from "lucide-react";
import {
  type ComponentProps,
  type KeyboardEvent,
  type ReactNode,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { observeResize } from "~/lib/observeResize";
import { cn } from "~/lib/utils";
import "./composerV9.css";
import {
  Menu,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRadioItemIndicator,
  MenuTrigger,
} from "../ui/menu";
import { Switch } from "../ui/switch";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ComposerControl, type ComposerControlSize } from "./ComposerControl";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { useComposerMenuState } from "./useComposerMenuState";
import type { RuntimeModeOption } from "./ComposerFooterControls";
import { CosmicEffortSlider, cosmicColorAtRatio } from "./CosmicEffortSlider";
import {
  composerFloatingLayerProps,
  takeOpenTarget,
  useComposerMenuProps,
} from "./composerEventScope";
import { EffortGlyph, FastBolt, resolveEffortGlyph } from "./EffortGlyph";
import { DockedPickerContext } from "./ProviderModelPicker";
import {
  getTraitsSectionVisibility,
  type TraitsSelectionInput,
  ULTRATHINK_IN_BODY_NOTE,
  useTraitsSelection,
} from "./TraitsPicker";

type SelectDescriptor = Extract<ProviderOptionDescriptor, { type: "select" }>;
type BooleanDescriptor = Extract<ProviderOptionDescriptor, { type: "boolean" }>;

/** Service tiers, Claude's Fast mode, and Ultracode sit in the footer, not the column. */
function splitSpeed(
  selects: ReadonlyArray<SelectDescriptor>,
  toggles: ReadonlyArray<BooleanDescriptor>,
) {
  const speedSelect = selects.find((descriptor) => descriptor.id === "serviceTier") ?? null;
  const fastToggle = toggles.find((descriptor) => descriptor.id === "fastMode") ?? null;
  const ultracodeToggle = toggles.find((descriptor) => descriptor.id === "ultracode") ?? null;
  return {
    speedSelect,
    fastToggle,
    ultracodeToggle,
    columnSelects: selects.filter((descriptor) => descriptor !== speedSelect),
    columnToggles: toggles.filter(
      (descriptor) => descriptor !== fastToggle && descriptor !== ultracodeToggle,
    ),
  };
}

type ColumnControl =
  | { kind: "select"; descriptor: SelectDescriptor }
  | { kind: "boolean"; descriptor: BooleanDescriptor };

/**
 * The column lists the model's reasoning levels under the header that names it. Other options,
 * such as an agent's session mode, sit below as one row each.
 */
function columnControls(
  selects: ReadonlyArray<SelectDescriptor>,
  toggles: ReadonlyArray<BooleanDescriptor>,
) {
  const { columnSelects, columnToggles } = splitSpeed(selects, toggles);
  const controls: ReadonlyArray<ColumnControl> = [
    ...columnSelects.map((descriptor) => ({ kind: "select" as const, descriptor })),
    ...columnToggles.map((descriptor) => ({ kind: "boolean" as const, descriptor })),
  ];
  const effort = controls.find((control) => isReasoningControl(control.descriptor)) ?? null;
  return { effort, others: controls.filter((control) => control !== effort) };
}

/** A small glowing dot coloured like the effort slider at this level (V9 model chip). */
function CosmicLevelDot(props: { ratio: number }) {
  const color = cosmicColorAtRatio(props.ratio);
  return (
    <span
      aria-hidden="true"
      data-cosmic-level-dot
      style={{ background: color, boxShadow: `0 0 6px ${color}` }}
    />
  );
}

/** Translated tier label for the effort tier pill inside the model trigger. */
function CosmicTierPill(props: { ratio: number | null; word: string }) {
  const uiText = useUiText();
  const label = uiText(props.word);
  return (
    <Tooltip>
      <TooltipTrigger render={<span data-v9-cosmic-tier-pill />}>
        {props.ratio !== null ? <CosmicLevelDot ratio={props.ratio} /> : null}
        <span data-composer-control-label className="max-w-20 truncate">
          {label}
        </span>
      </TooltipTrigger>
      <TooltipPopup side="top">
        {uiText("Reasoning effort · {level}", { level: label })}
      </TooltipPopup>
    </Tooltip>
  );
}

/**
 * What the model trigger shows after the model name: the effort word (or bars, per the
 * Appearance setting), a bolt for Fast, a workflow icon for Ultracode, and other traits such as a
 * context window.
 */
export function describeComposerEffort(
  traits: TraitsSelectionInput | null,
  effortDisplay: EffortDisplay,
  size: ComposerControlSize,
): { suffix: ReactNode; detail: string | null } {
  if (!traits) return { suffix: null, detail: null };
  const visibility = getTraitsSectionVisibility(traits);
  if (!visibility.hasAnyControls) return { suffix: null, detail: null };
  const modelSelection =
    traits.instanceId && traits.model
      ? { instanceId: traits.instanceId, model: traits.model, options: traits.modelOptions ?? [] }
      : null;
  const primary = visibility.primarySelectDescriptor;
  const display = buildTraitsTriggerDisplay({
    descriptors: visibility.descriptors,
    primarySelectDescriptorId: primary?.id ?? null,
    ultrathinkPromptControlled: visibility.ultrathinkPromptControlled,
    modelSelection,
    reportedModelSelection: traits.reportedModelSelection,
  });
  // The same reasoning control the column lists, wherever the agent put it among its options.
  const reasoning =
    columnControls(visibility.selectDescriptors, visibility.booleanDescriptors).effort
      ?.descriptor ?? null;
  const ultrathink = visibility.ultrathinkPromptControlled && reasoning === primary;
  const glyph =
    reasoning?.type === "select"
      ? resolveEffortGlyph(
          reasoning,
          ultrathink
            ? "ultrathink"
            : getDescriptorStringValue(reasoning, modelSelection, traits.reportedModelSelection),
        )
      : null;
  // Workflow levels such as Ultracode always show their name; the setting names every level.
  const word = glyph
    ? (glyph.special ?? (effortDisplay === "label" ? glyph.label : null))
    : !reasoning
      ? null
      : reasoning.type === "boolean"
        ? `${reasoning.label} ${reasoning.currentValue === true ? "On" : "Off"}`
        : ultrathink
          ? "Ultrathink"
          : (getProviderOptionCurrentLabel(
              reasoning,
              modelSelection,
              traits.reportedModelSelection,
            ) ?? (reasoning.id === "thinking" ? reasoning.label : null));
  // Where the picker's cosmic slider sits for this level, so the chip's dot matches its colour.
  const sliderRatio = (() => {
    if (reasoning?.type !== "select" || ultrathink) return null;
    const choices = selectableProviderOptionChoices(reasoning);
    if (choices.length < 2) return null;
    const current = getDescriptorStringValue(
      reasoning,
      modelSelection,
      traits.reportedModelSelection,
    );
    const index = choices.findIndex((choice) => choice.id === current);
    return index < 0 ? null : index / (choices.length - 1);
  })();
  const fast = display.speedLabel === "Fast" || display.speedLabel === "Ultrafast";
  // Agent options such as modes live in the picker; the trigger adds only the context window.
  const contextWindow =
    visibility.contextWindowDescriptor &&
    getProviderOptionCurrentLabel(
      visibility.contextWindowDescriptor,
      modelSelection,
      traits.reportedModelSelection,
    );
  if (!word && !glyph && sliderRatio === null && !fast && !display.ultracode && !contextWindow)
    return { suffix: null, detail: display.label };
  return {
    detail: display.label,
    suffix: (
      <span
        className={cn(
          "flex shrink-0 items-center gap-1.5 text-muted-foreground group-hover/model-trigger:text-foreground group-data-pressed/model-trigger:text-foreground group-data-popup-open/model-trigger:text-foreground",
          size === "sm" && "-ms-0.5",
        )}
      >
        {word ? (
          <CosmicTierPill ratio={sliderRatio} word={word} />
        ) : glyph ? (
          <>
            {sliderRatio !== null ? <CosmicLevelDot ratio={sliderRatio} /> : null}
            <EffortGlyph count={glyph.count} filled={glyph.filled} size={size} />
          </>
        ) : sliderRatio !== null ? (
          <CosmicLevelDot ratio={sliderRatio} />
        ) : null}
        {fast ? <FastBolt ultra={display.speedLabel === "Ultrafast"} /> : null}
        {display.ultracode ? (
          <WorkflowIcon aria-hidden="true" data-composer-control-icon className="size-3" />
        ) : null}
        {contextWindow ? (
          <span
            // A label, so icon-only footers drop it; compacted rows drop it before the model.
            data-composer-control-label
            data-composer-secondary-trait
            className="max-w-24 truncate text-xs"
          >
            {contextWindow}
          </span>
        ) : null}
      </span>
    ),
  };
}

const COLUMN_ROW =
  "flex h-8 w-full shrink-0 cursor-pointer items-center gap-2 rounded-sm px-2 text-left text-sm text-foreground outline-none hover:bg-foreground/[0.09] focus-visible:bg-foreground/[0.09] disabled:cursor-not-allowed disabled:opacity-64";
const COLUMN_LABEL = "px-2 pt-1.5 pb-1 font-medium text-muted-foreground text-xs";

function ColumnRow(props: {
  label: string;
  /** Shown on hover; the column is too narrow to print it under the label. */
  description?: string | undefined;
  selected: boolean;
  /** The column's one tab stop: the selected level, else the first when none shows as selected. */
  tabStop: boolean;
  isDefault?: boolean | undefined;
  disabled?: boolean;
  onPick: () => void;
}) {
  const uiText = useUiText();
  const rowProps = {
    type: "button",
    role: "radio",
    "aria-checked": props.selected,
    disabled: props.disabled,
    "data-effort-row": true,
    // Focus lands on a level after a model pick, and a typed letter finds one by its label.
    "data-effort-level": props.label,
    // Up and Down move between rows.
    tabIndex: props.tabStop ? 0 : -1,
    className: COLUMN_ROW,
    onClick: props.onPick,
  } as const;
  const content = (
    <>
      <span className="min-w-0 flex-1 truncate">{props.label}</span>
      {props.selected ? (
        <>
          {props.isDefault ? <span className="sr-only">{uiText("Default")}</span> : null}
          <CheckIcon aria-hidden="true" className="size-3.5" />
        </>
      ) : props.isDefault ? (
        <span className="text-muted-foreground/70 text-xs">{uiText("Default")}</span>
      ) : null}
    </>
  );
  if (!props.description) return <button {...rowProps}>{content}</button>;
  return (
    <Tooltip>
      <TooltipTrigger render={<button {...rowProps} />}>{content}</TooltipTrigger>
      <TooltipPopup side="right" className="max-w-56">
        {props.description}
      </TooltipPopup>
    </Tooltip>
  );
}

function moveBetweenRows(event: KeyboardEvent<HTMLElement>) {
  const arrow = event.key === "ArrowDown" || event.key === "ArrowUp";
  if (
    !arrow &&
    (event.key.length !== 1 ||
      event.key.trim() === "" ||
      event.ctrlKey ||
      event.altKey ||
      event.metaKey ||
      event.nativeEvent.isComposing)
  )
    return;
  // An option's side menu is a React child here, but it moves through its own items.
  if (!event.currentTarget.contains(event.target as Node)) return;
  const rows = Array.from(
    event.currentTarget.querySelectorAll<HTMLButtonElement>("[data-effort-row]:not(:disabled)"),
  );
  const index = rows.findIndex((row) => row === document.activeElement);
  const next = arrow
    ? rows[Math.min(rows.length - 1, Math.max(0, index + (event.key === "ArrowDown" ? 1 : -1)))]
    : [...rows.slice(index + 1), ...rows.slice(0, index + 1)].find((row) =>
        row.dataset.effortLevel?.toLowerCase().startsWith(event.key.toLowerCase()),
      );
  if (!next) return;
  event.preventDefault();
  event.stopPropagation();
  next.focus();
  next.scrollIntoView({ block: "nearest" });
}

function EffortLevels(props: { traits: TraitsSelectionInput }) {
  const traits = useTraitsSelection(props.traits);
  const { effort, others } = columnControls(traits.selectDescriptors, traits.booleanDescriptors);
  if (traits.modelIsUnavailable) {
    return (
      <>
        {traits.descriptors.map((descriptor) => {
          const value = traits.currentLabel(descriptor);
          return value ? (
            <div key={descriptor.id}>
              <div className={COLUMN_LABEL}>{descriptor.label}</div>
              <div className="px-2 pb-1.5 text-muted-foreground/80 text-xs">{value}</div>
            </div>
          ) : null;
        })}
      </>
    );
  }
  if (!effort && others.length === 0) return <NoEffortRow />;
  // Ultrathink in the prompt locks the levels; the first option then holds the tab stop.
  const locked =
    effort?.descriptor.id === traits.primarySelectDescriptor?.id && traits.ultrathinkInBodyText;
  return (
    <>
      {effort ? <EffortRows control={effort} traits={traits} locked={locked} /> : null}
      {others.length > 0 ? (
        <div
          className={cn("flex flex-col gap-0.5", effort && "mt-1 border-t border-border/70 pt-1")}
        >
          {others.map((control, index) =>
            control.kind === "boolean" ? (
              <OptionSwitchRow
                key={control.descriptor.id}
                descriptor={control.descriptor}
                traits={traits}
                tabStop={(!effort || locked) && index === 0}
              />
            ) : (
              <OptionMenuRow
                key={control.descriptor.id}
                descriptor={control.descriptor}
                traits={traits}
                tabStop={(!effort || locked) && index === 0}
              />
            ),
          )}
        </div>
      ) : null}
    </>
  );
}

type TraitsSelection = ReturnType<typeof useTraitsSelection>;

function EffortRows(props: { control: ColumnControl; traits: TraitsSelection; locked: boolean }) {
  const uiText = useUiText();
  const { control, traits } = props;
  const { descriptor } = control;
  if (control.kind === "boolean") {
    return (
      <div role="radiogroup" aria-label={descriptor.label} className="flex flex-col gap-0.5">
        {([true, false] as const).map((value) => (
          <ColumnRow
            key={String(value)}
            label={value ? uiText("On") : uiText("Off")}
            selected={(control.descriptor.currentValue === true) === value}
            tabStop={(control.descriptor.currentValue === true) === value}
            onPick={() => traits.changeBoolean(descriptor.id, value)}
          />
        ))}
      </div>
    );
  }
  const { locked } = props;
  const value = traits.selectValue(control.descriptor);
  const choices = selectableProviderOptionChoices(control.descriptor);
  // An "Ultrathink:" prefix selects a level the column does not offer.
  const shown = choices.some((option) => option.id === value);
  const asSlider = choices.length >= 2;
  return (
    // With the slider, the level radios live in its tier scale, which carries the group role so the
    // slider-style switcher (its own radiogroup) is not nested inside this one.
    <div
      role={asSlider ? undefined : "radiogroup"}
      aria-label={asSlider ? undefined : descriptor.label}
      className="flex flex-col gap-0.5"
    >
      {locked ? (
        <div className="px-2 pb-1.5 text-muted-foreground/80 text-xs">
          {uiText(ULTRATHINK_IN_BODY_NOTE)}
        </div>
      ) : null}
      {asSlider ? (
        <CosmicEffortSlider
          label={descriptor.label}
          options={choices}
          value={value}
          disabled={locked}
          onChange={(nextId) => traits.changeSelect(control.descriptor, nextId)}
        >
          {/* V9 tier scale: the level radios themselves, laid out under the track. */}
          <div role="radiogroup" aria-label={descriptor.label} data-cosmic-tier-scale>
            {choices.map((option, index) => {
              const selected = option.id === value;
              const translatedLabel = uiText(option.label);
              return (
                <HintButton
                  key={option.id}
                  hint={option.description}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={
                    option.isDefault
                      ? uiText("{label} (Default)", { label: translatedLabel })
                      : translatedLabel
                  }
                  disabled={locked}
                  data-effort-row
                  // A typed letter finds a level by this label, as in the list layout.
                  data-effort-level={translatedLabel}
                  tabIndex={(shown ? selected : index === 0) ? 0 : -1}
                  onClick={() => traits.changeSelect(control.descriptor, option.id)}
                  onKeyDown={(event) => {
                    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
                    const step = event.key === "ArrowRight" ? 1 : -1;
                    const next = choices[index + step];
                    if (!next) return;
                    event.preventDefault();
                    event.stopPropagation();
                    traits.changeSelect(control.descriptor, next.id);
                    const sibling =
                      step > 0
                        ? event.currentTarget.nextElementSibling
                        : event.currentTarget.previousElementSibling;
                    (sibling as HTMLElement | null)?.focus();
                  }}
                >
                  {translatedLabel}
                </HintButton>
              );
            })}
          </div>
        </CosmicEffortSlider>
      ) : null}
      {asSlider
        ? null
        : choices.map((option, index) => (
            <ColumnRow
              key={option.id}
              label={option.label}
              selected={option.id === value}
              tabStop={shown ? option.id === value : index === 0}
              description={option.description}
              isDefault={option.isDefault}
              disabled={locked}
              onPick={() => traits.changeSelect(control.descriptor, option.id)}
            />
          ))}
    </div>
  );
}

const OPTION_ROW = cn(COLUMN_ROW, "h-auto py-1");

/** An option's name over its current value. */
function OptionRowText(props: { label: string; value: string }) {
  return (
    <span className="flex min-w-0 flex-1 flex-col">
      <span className="truncate text-muted-foreground text-xs">{props.label}</span>
      <span className="truncate">{props.value}</span>
    </span>
  );
}

/**
 * One select besides reasoning, such as an agent's session mode. It names the current choice and
 * opens the rest beside the column, so any number of options leaves the levels in place.
 */
function OptionMenuRow(props: {
  descriptor: SelectDescriptor;
  traits: TraitsSelection;
  /** Holds the column's tab stop when the model has no levels. */
  tabStop: boolean;
}) {
  const uiText = useUiText();
  const { descriptor, traits } = props;
  const [open, setOpen] = useState(false);
  const popupRef = useRef<HTMLDivElement>(null);
  const choices = selectableProviderOptionChoices(descriptor);
  const value = traits.selectValue(descriptor);
  const current = choices.find((choice) => choice.id === value)?.label ?? "";
  return (
    <Menu
      open={open}
      // A modal menu would cover the picker, so the next click there would only close it.
      modal={false}
      onOpenChange={setOpen}
      onOpenChangeComplete={(isOpen) => {
        if (!isOpen) return;
        const checked = popupRef.current?.querySelector<HTMLElement>(
          '[role="menuitemradio"][aria-checked="true"]',
        );
        checked?.focus({ preventScroll: true });
        checked?.scrollIntoView({ block: "nearest" });
      }}
    >
      {/* No hover opening: an opened menu takes focus, which would steal typing from search. */}
      <MenuTrigger
        render={
          <button
            type="button"
            data-effort-row
            tabIndex={props.tabStop ? 0 : -1}
            aria-label={`${descriptor.label}: ${current}`}
            className={cn(OPTION_ROW, "data-popup-open:bg-foreground/[0.09]")}
            onKeyDown={(event) => {
              if (event.key !== "ArrowRight") return;
              event.preventDefault();
              event.stopPropagation();
              setOpen(true);
            }}
          />
        }
      >
        <OptionRowText label={descriptor.label} value={current} />
        <ChevronRightIcon
          aria-hidden="true"
          className="-me-1 size-3.5 shrink-0 text-muted-foreground"
        />
      </MenuTrigger>
      <MenuPopup
        ref={popupRef}
        side="right"
        align="start"
        sideOffset={6}
        // A full-width column on phones leaves no room beside it, so fall below or above.
        collisionAvoidance={{ fallbackAxisSide: "end" }}
        className="max-w-72"
        data-model-picker-option-menu
        {...composerFloatingLayerProps}
        onKeyDown={(event) => {
          if (event.key !== "ArrowLeft") return;
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
        }}
      >
        <MenuRadioGroup
          aria-label={descriptor.label}
          value={value}
          onValueChange={(next: string) => {
            if (next !== value) traits.changeSelect(descriptor, next);
          }}
        >
          {choices.map((choice) => (
            <MenuRadioItem key={choice.id} value={choice.id} closeOnClick>
              <span className="flex items-center gap-3">
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">{choice.label}</span>
                  {choice.description ? (
                    <span className="line-clamp-2 text-muted-foreground text-xs">
                      {choice.description}
                    </span>
                  ) : null}
                </span>
                {choice.isDefault ? (
                  <span className="text-muted-foreground/70 text-xs">{uiText("Default")}</span>
                ) : null}
                <MenuRadioItemIndicator />
              </span>
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuPopup>
    </Menu>
  );
}

/** A two-state option toggles in place; a menu would add a click for nothing. */
function OptionSwitchRow(props: {
  descriptor: BooleanDescriptor;
  traits: TraitsSelection;
  tabStop: boolean;
}) {
  const { descriptor, traits } = props;
  const checked = descriptor.currentValue === true;
  return (
    <label className={cn(OPTION_ROW, "has-focus-visible:bg-foreground/[0.09]")}>
      <OptionRowText label={descriptor.label} value={checked ? "On" : "Off"} />
      <Switch
        size="sm"
        checked={checked}
        onCheckedChange={(next) => traits.changeBoolean(descriptor.id, next)}
        aria-label={descriptor.label}
        data-effort-row
        tabIndex={props.tabStop ? 0 : -1}
      />
    </label>
  );
}

function NoEffortRow() {
  const uiText = useUiText();
  return (
    <div className="flex h-8 items-center px-2 text-muted-foreground text-sm">
      {uiText("No effort levels")}
    </div>
  );
}

/** The model picker's embedded cosmic slider + extra model options (V9 single-column layout). */
export function ComposerEffortColumn(props: { traits: TraitsSelectionInput | null }) {
  return (
    <div
      className="flex min-h-0 flex-col gap-1"
      // Capture, so Up and Down on an option row move rows instead of opening its menu.
      onKeyDownCapture={moveBetweenRows}
    >
      {props.traits ? <EffortLevels traits={props.traits} /> : <NoEffortRow />}
    </div>
  );
}

const FOOTER_SEGMENT =
  "flex h-6 cursor-pointer items-center justify-center gap-1 px-2 text-muted-foreground text-xs outline-none first:rounded-l-md last:rounded-r-md hover:text-foreground data-checked:bg-input/72 data-checked:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset";

function SpeedSegment(props: {
  checked: boolean;
  label: string;
  description?: string | undefined;
  onPick: () => void;
}) {
  const uiText = useUiText();
  const buttonProps = {
    type: "button",
    role: "radio",
    "aria-checked": props.checked,
    "data-checked": props.checked || undefined,
    className: FOOTER_SEGMENT,
    onClick: props.onPick,
  } as const;
  const content = (
    <>
      {props.label === "Fast" || props.label === "Ultrafast" ? (
        <FastBolt ultra={props.label === "Ultrafast"} />
      ) : null}
      {uiText(props.label)}
    </>
  );
  if (!props.description) return <button {...buttonProps}>{content}</button>;
  return (
    <Tooltip>
      <TooltipTrigger render={<button {...buttonProps} />}>{content}</TooltipTrigger>
      <TooltipPopup side="top">{props.description}</TooltipPopup>
    </Tooltip>
  );
}

function SpeedControl(props: { traits: TraitsSelectionInput }) {
  const traits = useTraitsSelection(props.traits);
  const { speedSelect, fastToggle } = splitSpeed(
    traits.selectDescriptors,
    traits.booleanDescriptors,
  );
  if (traits.modelIsUnavailable || (!speedSelect && !fastToggle)) return null;
  return (
    <div
      role="radiogroup"
      aria-label={speedSelect?.label ?? fastToggle?.label}
      className="flex rounded-lg bg-input/40 p-0.5"
    >
      {speedSelect
        ? selectableProviderOptionChoices(speedSelect).map((option) => (
            <SpeedSegment
              key={option.id}
              checked={option.id === traits.selectValue(speedSelect)}
              label={option.label}
              description={option.description}
              onPick={() => traits.changeSelect(speedSelect, option.id)}
            />
          ))
        : fastToggle
          ? ([false, true] as const).map((value) => (
              <SpeedSegment
                key={String(value)}
                checked={(fastToggle.currentValue === true) === value}
                label={value ? "Fast" : "Standard"}
                onPick={() => traits.changeBoolean(fastToggle.id, value)}
              />
            ))
          : null}
    </div>
  );
}

function UltracodeControl(props: { traits: TraitsSelectionInput }) {
  const traits = useTraitsSelection(props.traits);
  const { ultracodeToggle } = splitSpeed(traits.selectDescriptors, traits.booleanDescriptors);
  if (traits.modelIsUnavailable || !ultracodeToggle) return null;
  const on = ultracodeToggle.currentValue === true;
  return (
    <div className="flex rounded-lg bg-input/40 p-0.5">
      <button
        type="button"
        aria-pressed={on}
        data-checked={on || undefined}
        className={FOOTER_SEGMENT}
        onClick={() => traits.changeBoolean(ultracodeToggle.id, !on)}
      >
        <WorkflowIcon aria-hidden="true" className="size-3" />
        {ultracodeToggle.label}
      </button>
    </div>
  );
}

/** A button with an optional hover hint, using the app tooltip instead of a native title. */
function HintButton(props: ComponentProps<"button"> & { hint?: string | undefined }) {
  const { hint, children, ...buttonProps } = props;
  if (!hint) return <button {...buttonProps}>{children}</button>;
  return (
    <Tooltip>
      <TooltipTrigger render={<button {...buttonProps} />}>{children}</TooltipTrigger>
      <TooltipPopup side="top" className="max-w-56">
        {hint}
      </TooltipPopup>
    </Tooltip>
  );
}

const V9_PERMISSION_ORDER: ReadonlyArray<RuntimeMode> = [
  "full-access",
  "auto",
  "approval-required",
];

function selectInlinePermissionOptions(
  options: ReadonlyArray<RuntimeModeOption>,
  runtimeMode: RuntimeMode,
): ReadonlyArray<RuntimeModeOption> {
  const byMode = new Map(options.map((option) => [option.mode, option]));
  const ordered: RuntimeModeOption[] = [];
  for (const mode of V9_PERMISSION_ORDER) {
    const found = byMode.get(mode);
    if (found) ordered.push(found);
  }
  // Keep any non-standard active mode (e.g. auto-accept-edits) visible if currently selected.
  if (!ordered.some((option) => option.mode === runtimeMode)) {
    const active = byMode.get(runtimeMode);
    if (active) ordered.push(active);
  }
  return ordered.length > 0 ? ordered : options;
}

/**
 * V9: access permission as an always-visible 3-segment sliding control in the picker footer.
 * The default mode stays out of the composer footer, so this is where it is changed.
 */
function InlinePermissions(props: {
  runtimeMode: RuntimeMode;
  options: ReadonlyArray<RuntimeModeOption>;
  onChange: (mode: RuntimeMode) => void;
}) {
  const uiText = useUiText();
  const segRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLSpanElement>(null);
  const mountedRef = useRef(false);
  const visibleOptions = selectInlinePermissionOptions(props.options, props.runtimeMode);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- measures the active radio button to position the V9 sliding .seg-pill
  useLayoutEffect(() => {
    const seg = segRef.current;
    const pill = pillRef.current;
    if (!seg || !pill || visibleOptions.length === 0) return;

    const positionPill = (instant: boolean) => {
      const active =
        seg.querySelector<HTMLButtonElement>(
          `[data-composer-permission-option="${props.runtimeMode}"]`,
        ) ?? seg.querySelector<HTMLButtonElement>("[data-composer-permission-option]");
      if (!active || active.offsetWidth <= 0) {
        pill.style.opacity = "0";
        return;
      }
      if (instant) pill.style.transition = "none";
      pill.style.opacity = "1";
      pill.style.width = `${active.offsetWidth}px`;
      pill.style.transform = `translateX(${active.offsetLeft}px)`;
      if (instant) {
        void pill.offsetHeight;
        pill.style.transition = "";
      }
    };

    positionPill(!mountedRef.current);
    mountedRef.current = true;
    const stopObserve = observeResize(seg, () => positionPill(true));
    return stopObserve;
  }, [props.runtimeMode, visibleOptions.length]);

  if (visibleOptions.length === 0) return null;
  return (
    <div data-v9-perm-row>
      <span data-v9-perm-label>{uiText("Access (default stays out of the footer)")}</span>
      <div
        ref={segRef}
        role="radiogroup"
        aria-label={uiText("Permissions")}
        data-composer-permissions-segment
      >
        <span ref={pillRef} aria-hidden="true" data-v9-seg-pill />
        {visibleOptions.map((option, index) => {
          const checked = option.mode === props.runtimeMode;
          const disabled = Boolean(option.disabledReason);
          return (
            <HintButton
              key={option.mode}
              hint={option.disabledReason ?? uiText(option.description)}
              type="button"
              role="radio"
              aria-checked={checked}
              disabled={disabled}
              data-cosmic-chip-on={checked || undefined}
              data-composer-permission-option={option.mode}
              tabIndex={checked ? 0 : -1}
              className="disabled:opacity-50"
              onClick={() => {
                if (!checked) props.onChange(option.mode);
              }}
              onKeyDown={(event) => {
                if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
                const step = event.key === "ArrowRight" ? 1 : -1;
                let nextIndex = index + step;
                while (visibleOptions[nextIndex]?.disabledReason) nextIndex += step;
                const next = visibleOptions[nextIndex];
                if (!next) return;
                event.preventDefault();
                event.stopPropagation();
                props.onChange(next.mode);
                const group = event.currentTarget.parentElement;
                requestAnimationFrame(() =>
                  group
                    ?.querySelector<HTMLButtonElement>(
                      `[data-composer-permission-option="${next.mode}"]`,
                    )
                    ?.focus(),
                );
              }}
            >
              {uiText(option.label)}
            </HintButton>
          );
        })}
      </div>
    </div>
  );
}

/** The model picker's footer: speed stays one click away; permissions are a V9 3-segment row. */
export function ComposerPickerFooter(props: {
  traits: TraitsSelectionInput | null;
  runtimeMode: RuntimeMode;
  runtimeModeOptions: ReadonlyArray<RuntimeModeOption>;
  onRuntimeModeChange: (mode: RuntimeMode) => void;
}) {
  return (
    <div className="flex flex-col">
      {props.traits ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 empty:hidden">
          <SpeedControl traits={props.traits} />
          <UltracodeControl traits={props.traits} />
        </div>
      ) : null}
      <InlinePermissions
        runtimeMode={props.runtimeMode}
        options={props.runtimeModeOptions}
        onChange={props.onRuntimeModeChange}
      />
    </div>
  );
}

/** Keep model selection small; parameter controls have their own keyboard-accessible popup. */
export function ComposerEffortMenu(props: {
  traits: TraitsSelectionInput | null;
  modelLabel: string;
  suffix: ReactNode;
  detail: string | null;
  size: ComposerControlSize;
  hidden: boolean;
  disabled: boolean;
  ownsModeShortcut: boolean;
  runtimeMode: RuntimeMode;
  runtimeModeOptions: ReadonlyArray<RuntimeModeOption>;
  onRuntimeModeChange: (mode: RuntimeMode) => void;
}) {
  const uiText = useUiText();
  const [open, setOpen] = useComposerMenuState(props.hidden || props.disabled);
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const floatingProps = useComposerMenuProps();
  const focusTarget = (target: "effort" | "permissions" | null) => {
    if (target === "permissions") {
      popup.current
        ?.querySelector<HTMLButtonElement>('[data-composer-permission-option][aria-checked="true"]')
        ?.focus({ preventScroll: true });
      return;
    }
    const selected = popup.current?.querySelector<HTMLElement>(
      '[data-effort-level][aria-checked="true"]:not(:disabled)',
    );
    const first = popup.current?.querySelector<HTMLElement>(
      "[data-effort-row]:not(:disabled), [data-composer-permission-option]:not(:disabled)",
    );
    (selected ?? first)?.focus({ preventScroll: true });
  };
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      onOpenChangeComplete={(isOpen) => {
        if (!isOpen) return;
        focusTarget(takeOpenTarget(trigger.current));
      }}
    >
      <PopoverTrigger
        render={
          <ComposerControl
            ref={trigger}
            size={props.size}
            disabled={props.disabled}
            aria-label={uiText("Model options")}
            title={props.detail ?? uiText("Model options")}
            className="shrink-0 gap-1 px-1.5"
            onClick={(event) => {
              if (!open) return;
              const target = takeOpenTarget(trigger.current);
              if (!target) return;
              (
                event as typeof event & { preventBaseUIHandler?: () => void }
              ).preventBaseUIHandler?.();
              focusTarget(target);
            }}
            data-composer-shortcut={
              props.ownsModeShortcut ? "composer.effort composer.mode" : "composer.effort"
            }
          />
        }
      >
        {props.suffix ?? <GaugeIcon className="size-3.5" />}
      </PopoverTrigger>
      <PopoverPopup
        {...floatingProps}
        ref={popup}
        padding="none"
        align="end"
        className="w-76 max-w-[calc(100vw-2rem)]"
        data-model-parameters-menu
      >
        <DockedPickerContext value={{ modelLabel: props.modelLabel }}>
          <div className="flex max-h-86.5 flex-col">
            <ComposerEffortColumn traits={props.traits} />
            <ComposerPickerFooter
              traits={props.traits}
              runtimeMode={props.runtimeMode}
              runtimeModeOptions={props.runtimeModeOptions}
              onRuntimeModeChange={props.onRuntimeModeChange}
            />
          </div>
        </DockedPickerContext>
      </PopoverPopup>
    </Popover>
  );
}
