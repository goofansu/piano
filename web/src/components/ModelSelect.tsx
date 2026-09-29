import { useState } from "react";
import { CheckIcon, ChevronDownIcon } from "lucide-react";
import type { ModelCatalog, ModelChoice } from "@shared/wire";
import { cn } from "cn";
import { picker } from "@/lib/styles";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

interface Props {
  catalog: ModelCatalog | null;
  value: string | undefined;
  onChange: (ref: string) => void;
  disabled?: boolean;
}

/** Searchable model picker (fuzzy, via cmdk). Every model pi can use, in pi's own order; pi's default preselected. */
export function ModelSelect({ catalog, value, onChange, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const want = value || catalog?.defaultModel || "";
  const models = catalog?.models ?? [];
  const label = !catalog ? "Loading models" : catalog.error ? "No models" : want ? want.split("/").pop() : "Model";

  const item = (m: ModelChoice) => (
    <CommandItem
      key={m.ref}
      value={m.ref}
      keywords={[m.id, m.provider, m.name ?? ""]}
      onSelect={() => {
        onChange(m.ref);
        setOpen(false);
      }}
    >
      <CheckIcon className={cn("size-4 shrink-0", m.ref === want ? "opacity-100" : "opacity-0")} />
      <span className="min-w-0 flex-1 truncate">
        <span className="text-ink-3">{m.provider}/</span>
        {m.id}
      </span>
      {m.ref === catalog?.defaultModel && <span className="text-ink-3">default</span>}
    </CommandItem>
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" role="combobox" aria-expanded={open} aria-label="Model" disabled={disabled || !models.length} className={picker} title={want}>
          <span className="truncate">{label}</span>
          <ChevronDownIcon className="size-3.5 text-ink-3" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[360px] p-0">
        <Command>
          <CommandInput placeholder="Search models" autoFocus />
          <CommandList className="max-h-72">
            <CommandEmpty>No model matches.</CommandEmpty>
            <CommandGroup>{models.map(item)}</CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
