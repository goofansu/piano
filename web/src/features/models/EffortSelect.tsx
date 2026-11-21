import type { ThinkingLevel } from "@shared/wire";
import { useId } from "react";
import { Field, FieldTitle } from "@/components/ui/field";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { isImeKey } from "@/shared/lib/keys";

interface Props {
  value: ThinkingLevel;
  onChange: (level: ThinkingLevel) => void;
  onCommit?: () => void;
  levels: ThinkingLevel[];
  defaultLevel?: string;
  disabled?: boolean;
}

export function EffortSelect({ value, onChange, onCommit, levels, defaultLevel, disabled }: Props) {
  const labelId = useId();
  return (
    // Avoid Safari's fieldset/legend intrinsic-sizing issue.
    <Field aria-label="Effort" className="min-w-0 gap-2">
      <FieldTitle id={labelId} className="leading-snug">
        Reasoning effort
      </FieldTitle>
      <ToggleGroup
        aria-labelledby={labelId}
        disabled={disabled || levels.length <= 1}
        variant="outline"
        size="sm"
        spacing={1}
        value={[value]}
        onValueChange={([next]) => {
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
            className="flex-auto px-1 text-xs hover:bg-transparent data-pressed:border-ink data-pressed:bg-muted data-pressed:text-ink"
          >
            {level}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </Field>
  );
}
