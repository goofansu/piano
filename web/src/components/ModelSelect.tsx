import { useEffect, useRef, useState } from "react";
import { CheckIcon, ChevronDownIcon } from "lucide-react";
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
  const [query, setQuery] = useState("");
  useEffect(() => {
    if (!open) return;
    const dismiss = () => setOpen(false);
    window.addEventListener("blur", dismiss);
    return () => window.removeEventListener("blur", dismiss);
  }, [open]);
  const content = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const want = value || catalog?.defaultModel || "";
  const models = catalog?.models ?? [];
  // Literal matching avoids unrelated fuzzy hits and preserves catalog order.
  const needle = query.trim().toLowerCase();
  const visibleModels = needle ? models.filter(m => [m.ref, m.id, m.provider, m.name ?? ""].some(text => text.toLowerCase().includes(needle))) : models;
  const label = !catalog ? "Loading models" : catalog.error ? "No models" : want ? want.split("/").pop() : "Model";

  const item = (m: ModelChoice) => (
    <CommandItem
      key={m.ref}
      value={m.ref}
      onSelect={() => onChange(m.ref)}
      className="min-h-11 md:min-h-9"
    >
      <span className="min-w-0 flex-1 whitespace-normal break-words [overflow-wrap:anywhere]">
        <span className="text-ink-3">{m.provider}/</span>
        {m.id}
      </span>
      <CheckIcon aria-hidden className={cn("size-4 shrink-0", m.ref === want ? "opacity-100" : "opacity-0")} />
    </CommandItem>
  );

  return (
    <Popover open={open} onOpenChange={next => { setOpen(next); setQuery(""); }}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost" size="sm" aria-haspopup="dialog" aria-expanded={open}
          aria-label={`Model: ${want || label}; effort: ${effort}`}
          disabled={disabled || !models.length}
          className={cn(picker, "h-11 min-w-0 max-w-none flex-1 justify-start md:h-8 md:max-w-md")}
          title={want}
        >
          <span className="min-w-0 truncate">{label}</span>
          <span className="shrink-0 text-ink-3 max-[360px]:hidden" aria-hidden>· {effort}</span>
          <ChevronDownIcon className="size-3.5 shrink-0 text-ink-3" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        ref={content} align="start" aria-label="Model and effort" tabIndex={-1}
        className="max-h-(--radix-popover-content-available-height) w-[360px] max-w-[calc(100vw-2rem)] overflow-y-auto p-0 font-mono"
        onOpenAutoFocus={event => {
          // Opening settings on a phone should not summon the software keyboard.
          event.preventDefault();
          if (window.matchMedia("(pointer: coarse)").matches) content.current?.focus({ preventScroll: true });
          else search.current?.focus({ preventScroll: true });
        }}
      >
        <Command shouldFilter={false}>
          <CommandInput ref={search} value={query} onValueChange={setQuery} aria-label="Search models" placeholder="Search models" />
          <CommandList className="max-h-[min(16rem,40dvh)]">
            <CommandEmpty>No model matches.</CommandEmpty>
            <CommandGroup>{visibleModels.map(item)}</CommandGroup>
          </CommandList>
        </Command>
        <div className="border-t border-line p-3">
          <EffortSelect value={effort} onChange={onEffortChange} levels={levelsFor(catalog, want)} defaultLevel={catalog?.defaultThinkingLevel} disabled={disabled} />
        </div>
      </PopoverContent>
    </Popover>
  );
}
