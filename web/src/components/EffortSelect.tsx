import type { ThinkingLevel } from "@shared/wire";
import { useId } from "react";
import { Field, FieldLabel } from "@/components/ui/field";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { isImeKey } from "@/lib/keys";

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
  const labelId = useId();
  return (
    // One labelled composite control: avoid native fieldset/legend intrinsic sizing in Safari.
    <Field aria-label="Effort" className="min-w-0 gap-2">
      <FieldLabel asChild>
        <span id={labelId}>Reasoning effort</span>
      </FieldLabel>
      <ToggleGroup
        aria-labelledby={labelId}
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
              if (isImeKey(event)) return;
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
            // Reserve the filled, outlined treatment for the choice, not the pointer.
            className="flex-auto px-1 text-xs hover:bg-transparent data-[state=on]:border-ink data-[state=on]:bg-muted data-[state=on]:text-ink"
          >
            {level}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </Field>
  );
}
