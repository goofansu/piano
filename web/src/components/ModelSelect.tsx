import { useRef, useState } from "react";
import { CheckIcon, ChevronDownIcon, XIcon } from "lucide-react";
import type { ModelCatalog, ModelChoice, ThinkingLevel } from "@shared/wire";
import { cn } from "cn";
import { picker } from "@/lib/styles";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { EffortSelect, levelsFor } from "@/components/EffortSelect";

interface Props {
  catalog: ModelCatalog | null;
  value: string | undefined;
  onChange: (ref: string) => void;
  effort: ThinkingLevel;
  onEffortChange: (level: ThinkingLevel) => void;
  disabled?: boolean;
}

/** One settings trigger: the model label yields space before the effort or primary action does. */
export function ModelSelect({ catalog, value, onChange, effort, onEffortChange, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const content = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const want = value || catalog?.defaultModel || "";
  const models = catalog?.models ?? [];
  const label = !catalog ? "Loading models" : catalog.error ? "No models" : want ? want.split("/").pop() : "Model";

  const item = (m: ModelChoice) => (
    <CommandItem
      key={m.ref}
      value={m.ref}
      keywords={[m.id, m.provider, m.name ?? ""]}
      onSelect={() => onChange(m.ref)}
      className="min-h-11 md:min-h-9"
    >
      <CheckIcon className={cn("size-4 shrink-0", m.ref === want ? "opacity-100" : "opacity-0")} />
      <span className="min-w-0 flex-1 whitespace-normal break-words [overflow-wrap:anywhere]">
        <span className="text-ink-3">{m.provider}/</span>
        {m.id}
      </span>
      {m.ref === catalog?.defaultModel && <span className="text-ink-3">default</span>}
    </CommandItem>
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost" size="sm" aria-haspopup="dialog" aria-expanded={open}
          aria-label={`Model: ${want || label}; effort: ${effort}`}
          disabled={disabled || !models.length}
          className={cn(picker, "h-11 min-w-0 max-w-none flex-1 justify-start md:h-8 md:max-w-md")}
          title={want}
        >
          <span className="min-w-0 truncate">{label}</span>
          <span className="shrink-0 text-ink-3" aria-hidden>· {effort}</span>
          <ChevronDownIcon className="size-3.5 shrink-0 text-ink-3" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        ref={content} align="start" aria-label="Model and effort" tabIndex={-1}
        className="max-h-(--radix-popover-content-available-height) w-[360px] max-w-[calc(100vw-2rem)] overflow-y-auto p-0"
        onOpenAutoFocus={event => {
          // Opening settings on a phone should not summon the software keyboard.
          event.preventDefault();
          if (window.matchMedia("(pointer: coarse)").matches) content.current?.focus({ preventScroll: true });
          else search.current?.focus({ preventScroll: true });
        }}
      >
        <div className="flex items-center justify-between px-3 pt-1">
          <p className="text-sm font-medium">Model and effort</p>
          <Button variant="ghost" size="icon" className="size-11 md:size-9" aria-label="Close model picker" onClick={() => setOpen(false)}><XIcon /></Button>
        </div>
        <Command>
          <CommandInput ref={search} aria-label="Search models" placeholder="Search models" />
          <CommandList className="max-h-[min(16rem,40dvh)]">
            <CommandEmpty>No model matches.</CommandEmpty>
            <CommandGroup>{models.map(item)}</CommandGroup>
          </CommandList>
        </Command>
        <div className="border-t border-line p-3">
          <EffortSelect value={effort} onChange={onEffortChange} levels={levelsFor(catalog, want)} defaultLevel={catalog?.defaultThinkingLevel} disabled={disabled} />
        </div>
      </PopoverContent>
    </Popover>
  );
}
