import type { ModelCatalog, ModelChoice, ThinkingLevel } from "@shared/wire";
import { cn } from "cn";
import { CheckIcon, RefreshCwIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { EffortSelect, levelsFor } from "@/components/EffortSelect";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { picker } from "@/lib/styles";

interface Props {
  catalog: ModelCatalog | null;
  value: string | undefined;
  onChange: (ref: string) => void;
  effort: ThinkingLevel;
  onEffortChange: (level: ThinkingLevel) => void;
  disabled?: boolean;
  /** Re-probe Pi for models, e.g. after adding a provider or logging in. */
  onRefresh?: () => void;
  /** No directory is chosen yet, so there is no catalog to wait for. */
  noDirectory?: boolean;
}

/** One settings trigger: the model label yields space before the effort or primary action does. */
export function ModelSelect({ catalog, value, onChange, effort, onEffortChange, disabled, onRefresh, noDirectory }: Props) {
  const [open, setOpen] = useState(false);
  // A refresh ends when a newer catalog arrives for this directory.
  const [refreshing, setRefreshing] = useState<string | null>(null);
  useEffect(() => { if (refreshing !== null && catalog?.fetchedAt !== refreshing) setRefreshing(null); }, [catalog?.fetchedAt, refreshing]);
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
  const label = !catalog ? (noDirectory ? "Model" : "Loading models") : catalog.error ? "No models" : want ? want.split("/").pop() : "Model";

  const item = (m: ModelChoice) => (
    <CommandItem
      key={m.ref}
      value={m.ref}
      onSelect={() => onChange(m.ref)}
    >
      <span className="min-w-0 flex-1 whitespace-normal break-words [overflow-wrap:anywhere]">
        <span className="text-ink-3">{m.provider}/</span>
        {m.id}
      </span>
      <CheckIcon className={cn("ml-auto", m.ref === want ? "opacity-100" : "opacity-0")} />
    </CommandItem>
  );

  return (
    <Popover open={open} onOpenChange={next => { setOpen(next); setQuery(""); }}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost" size="sm" aria-haspopup="dialog" aria-expanded={open}
          aria-label={`Model: ${want || label}; effort: ${effort}`}
          disabled={disabled || (!models.length && !onRefresh) || !catalog}
          className={cn(picker, "h-11 min-w-0 max-w-none shrink justify-end md:h-8")}
          title={want}
        >
          <span className={cn("min-w-0 truncate", !catalog && !noDirectory && "shimmer")}>{label}</span>
          <span className="shrink-0 text-ink-3 max-[360px]:hidden" aria-hidden>·</span>
          <span className="shrink-0 text-ink-3 max-[360px]:hidden" aria-hidden>{effort}</span>
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
          <div className="flex items-center border-b border-line [&>[data-slot=command-input-wrapper]]:flex-1 [&>[data-slot=command-input-wrapper]]:border-b-0">
            <CommandInput ref={search} value={query} onValueChange={setQuery} aria-label="Search models" placeholder="Search models" />
            {onRefresh && (
              <Button
                variant="ghost" size="icon-sm" aria-label="Refresh models" title="Refresh models"
                disabled={refreshing !== null}
                onClick={() => { setRefreshing(catalog?.fetchedAt ?? ""); onRefresh(); }}
                className="mr-1 shrink-0 text-ink-3"
              >
                {refreshing !== null ? <Spinner /> : <RefreshCwIcon aria-hidden />}
              </Button>
            )}
          </div>
          <CommandList className="max-h-[min(16rem,40dvh)]">
            <CommandEmpty>{catalog?.error ? "No models available." : "No model matches."}</CommandEmpty>
            <CommandGroup>{visibleModels.map(item)}</CommandGroup>
          </CommandList>
        </Command>
        <Separator />
        <div className="p-3">
          <EffortSelect value={effort} onChange={onEffortChange} levels={levelsFor(catalog, want)} defaultLevel={catalog?.defaultThinkingLevel} disabled={disabled} />
        </div>
      </PopoverContent>
    </Popover>
  );
}
