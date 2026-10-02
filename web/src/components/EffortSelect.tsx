import { GaugeIcon } from "lucide-react";
import type { ModelCatalog, ThinkingLevel } from "@shared/wire";
import { cn } from "cn";
import { picker } from "@/lib/styles";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

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

/** Reasoning effort picker, styled as a quiet control for the composer footer. Shows only what the model accepts. */
export function EffortSelect({ value, onChange, levels, defaultLevel, disabled }: Props) {
  const single = levels.length <= 1;
  return (
    <Select value={value} onValueChange={(v) => onChange(v as ThinkingLevel)} disabled={disabled || single}>
      <SelectTrigger
        size="sm"
        className={cn(picker, "border-0 bg-transparent shadow-none focus-visible:ring-2 focus-visible:ring-ring", single && "disabled:opacity-100 [&_svg:last-child]:hidden")}
        aria-label="Effort"
        title={single ? "This model does not reason" : undefined}
      >
        <GaugeIcon className="size-3.5 text-ink-3" />
        <SelectValue>{value}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {levels.map((l) => (
          <SelectItem key={l} value={l}>
            <span className="flex-1">{l}</span>
            {l === defaultLevel && <span className="text-ink-3">default</span>}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
