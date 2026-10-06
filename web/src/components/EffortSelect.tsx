import type { ModelCatalog, ThinkingLevel } from "@shared/wire";
import { FieldLegend, FieldSet } from "@/components/ui/field";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

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

/** A toggle group inside the model picker: no second popup, and only Pi-supported levels. */
export function EffortSelect({ value, onChange, levels, defaultLevel, disabled }: Props) {
  return (
    <FieldSet disabled={disabled || levels.length <= 1} aria-label="Effort" className="min-w-0 gap-2">
      <FieldLegend variant="label">Reasoning effort</FieldLegend>
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        spacing={1}
        value={value}
        onValueChange={(next) => { if (next) onChange(next as ThinkingLevel); }}
        className="w-full flex-wrap"
      >
        {levels.map((level) => (
          <ToggleGroupItem
            key={level}
            value={level}
            title={level === defaultLevel ? "Default effort" : undefined}
            aria-description={level === defaultLevel ? "Default effort" : undefined}
            className="flex-auto px-1 text-xs"
          >
            {level}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </FieldSet>
  );
}
