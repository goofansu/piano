import { useId } from "react";
import type { ModelCatalog, ThinkingLevel } from "@shared/wire";

const ALL: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

/** Efforts a model accepts, from Pi's catalog; every level while the model is unknown. */
export function levelsFor(catalog: ModelCatalog | null, model: string | undefined): ThinkingLevel[] {
  const m = catalog?.models.find((x) => x.ref === model);
  return m ? [...m.thinkingLevels] : ALL;
}

/** The wanted level if the model accepts it, else the nearest lower one, else the lowest it has. */
export function clampEffort(levels: ThinkingLevel[], wanted: ThinkingLevel): ThinkingLevel {
  if (levels.includes(wanted)) return wanted;
  const below = ALL.slice(0, ALL.indexOf(wanted)).filter((l) => levels.includes(l));
  return below[below.length - 1] ?? levels[0] ?? "off";
}

interface Props {
  value: ThinkingLevel;
  onChange: (level: ThinkingLevel) => void;
  levels: ThinkingLevel[];
  /** Pi's own default, marked in the list. */
  defaultLevel?: string;
  disabled?: boolean;
}

/** Native radios inside the model picker: no second popup, and only Pi-supported levels. */
export function EffortSelect({ value, onChange, levels, defaultLevel, disabled }: Props) {
  const name = useId();
  return (
    <fieldset disabled={disabled || levels.length <= 1} className="min-w-0 border-0 p-0" aria-label="Effort">
      <legend className="mb-2 text-sm font-medium text-ink-2">Reasoning effort</legend>
      <div className="flex flex-wrap gap-1">
        {levels.map(level => (
          <label key={level} className="cursor-pointer" title={level === defaultLevel ? "Default effort" : undefined}>
            <input
              type="radio"
              name={name}
              value={level}
              aria-description={level === defaultLevel ? "Default effort" : undefined}
              checked={value === level}
              onChange={() => onChange(level)}
              className="peer sr-only"
            />
            <span className="flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-line px-2 text-sm text-ink-2 transition-colors hover:bg-fill-hover peer-checked:border-brand/30 peer-checked:bg-brand-soft peer-checked:text-brand peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-disabled:cursor-default md:min-h-9">
              {level}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
