import type { ThinkingLevel } from "@shared/wire";
import { FieldLegend, FieldSet } from "@/components/ui/field";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

interface Props {
  value: ThinkingLevel;
  onChange: (level: ThinkingLevel) => void;
  onCommit?: () => void;
  levels: ThinkingLevel[];
  /** Pi's own default, marked in the list. */
  defaultLevel?: string;
  disabled?: boolean;
}

/** A toggle group inside the model picker: no second popup, and only Pi-supported levels. */
export function EffortSelect({ value, onChange, onCommit, levels, defaultLevel, disabled }: Props) {
  return (
    <FieldSet
      disabled={disabled || levels.length <= 1}
      aria-label="Effort"
      // Keep the legend in native fieldset flow rather than a browser-dependent flex layout.
      className="block min-w-0"
    >
      <FieldLegend variant="label" className="mb-2">
        Reasoning effort
      </FieldLegend>
      <ToggleGroup
        type="single"
        disabled={disabled || levels.length <= 1}
        variant="outline"
        size="sm"
        spacing={1}
        value={value}
        onValueChange={(next) => {
          if (next) onChange(next as ThinkingLevel);
        }}
        className="w-full flex-wrap"
      >
        {levels.map((level) => (
          <ToggleGroupItem
            key={level}
            value={level}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
              if (event.key === "Enter" && onCommit) {
                event.preventDefault();
                event.stopPropagation();
                if (!event.repeat) {
                  onChange(level);
                  onCommit();
                }
              }
            }}
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
