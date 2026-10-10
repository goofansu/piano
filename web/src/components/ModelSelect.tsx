import type { ModelCatalog, ModelChoice, ThinkingLevel } from "@shared/wire";
import { cn } from "cn";
import { ChevronDownIcon, RefreshCwIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { EffortSelect, levelsFor } from "@/components/EffortSelect";
import { IconButton } from "@/components/IconButton";
import { PickerCheck, PickerContent, PickerSearch } from "@/components/Picker";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { saveDefaults } from "@/lib/api";
import { picker } from "@/lib/styles";

interface Props {
  catalog: ModelCatalog | null;
  value: string | undefined;
  onChange: (ref: string) => void;
  effort: ThinkingLevel;
  onEffortChange: (level: ThinkingLevel) => void;
  disabled?: boolean;
  /** Bordered control for standalone forms; composers retain the quiet trigger. */
  variant?: "ghost" | "outline";
  /** Re-probe Pi for models, e.g. after adding a provider or logging in. */
  onRefresh?: () => void;
  /** HTTP-backed catalogs can finish a refresh without replacing the snapshot on failure. */
  isRefreshing?: boolean;
  /** No directory is chosen yet, so there is no catalog to wait for. */
  noDirectory?: boolean;
}

/** One settings trigger: the model label yields space before the effort or primary action does. */
export function ModelSelect({ catalog, value, onChange, effort, onEffortChange, disabled, variant = "ghost", onRefresh, isRefreshing, noDirectory }: Props) {
  const [open, setOpen] = useState(false);
  // A refresh ends when a newer catalog arrives for this directory.
  const [refreshing, setRefreshing] = useState<string | null>(null);
  const refreshPending = isRefreshing ?? (refreshing !== null);
  useEffect(() => { if (refreshing !== null && catalog?.fetchedAt !== refreshing) setRefreshing(null); }, [catalog?.fetchedAt, refreshing]);
  const [query, setQuery] = useState("");
  useEffect(() => {
    if (!open) return;
    const dismiss = () => setOpen(false);
    window.addEventListener("blur", dismiss);
    return () => window.removeEventListener("blur", dismiss);
  }, [open]);
  const search = useRef<HTMLInputElement>(null);
  const want = value || catalog?.defaultModel || "";
  const models = catalog?.models ?? [];
  // Literal matching avoids unrelated fuzzy hits and preserves catalog order.
  const needle = query.trim().toLowerCase();
  const visibleModels = needle ? models.filter(m => [m.ref, m.id, m.provider, m.name ?? ""].some(text => text.toLowerCase().includes(needle))) : models;
  const [saving, setSaving] = useState(false);
  const isDefault = !!want && want === catalog?.defaultModel && effort === catalog.defaultThinkingLevel;
  // Pi owns the saved defaults; its catalog invalidation updates every picker's default.
  const saveDefault = async () => {
    setSaving(true);
    try {
      await saveDefaults(want, effort);
      toast.success("Defaults saved for new sessions.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save defaults. Try again.");
    } finally { setSaving(false); }
  };
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
      <PickerCheck selected={m.ref === want} />
    </CommandItem>
  );

  return (
    <Popover open={open} onOpenChange={next => { setOpen(next); setQuery(""); }}>
      <PopoverTrigger asChild>
        <Button
          variant={variant === "outline" ? "outline-transparent" : variant} size={variant === "outline" ? "default" : "sm"} aria-haspopup="dialog" aria-expanded={open}
          aria-label={`Model: ${want || label}; effort: ${effort}`}
          title={want}
          disabled={disabled || (!models.length && !onRefresh) || !catalog}
          className={cn("min-w-0 shrink font-mono", variant === "outline" ? "max-w-full justify-start" : [picker, "max-w-none justify-end"])}
        >
          <span className={cn("min-w-0 truncate", !catalog && !noDirectory && "shimmer")}>{label}</span>
          <span className="shrink-0 text-ink-3 max-[360px]:hidden" aria-hidden>·</span>
          <span className="shrink-0 text-ink-3 max-[360px]:hidden" aria-hidden>{effort}</span>
          {variant === "outline" && <ChevronDownIcon data-icon="inline-end" aria-hidden />}
        </Button>
      </PopoverTrigger>
      <PickerContent aria-label="Model and effort" className="font-mono" searchRef={search}>
        <Command shouldFilter={false}>
          <PickerSearch ref={search} value={query} onValueChange={setQuery} aria-label="Search models" placeholder="Search models">
            {onRefresh && (
              <IconButton
                label="Refresh models"
                disabled={disabled || refreshPending}
                onClick={() => { if (isRefreshing === undefined) setRefreshing(catalog?.fetchedAt ?? ""); onRefresh(); }}
              >
                {refreshPending ? <Spinner /> : <RefreshCwIcon aria-hidden />}
              </IconButton>
            )}
          </PickerSearch>
          <CommandList className="max-h-[min(16rem,40dvh)]">
            <CommandEmpty>{catalog?.error ? "No models available." : "No model matches."}</CommandEmpty>
            <CommandGroup>{visibleModels.map(item)}</CommandGroup>
          </CommandList>
        </Command>
        <Separator />
        <div className="flex flex-col gap-3 p-3">
          <EffortSelect value={effort} onChange={onEffortChange} levels={levelsFor(catalog, want)} defaultLevel={catalog?.defaultThinkingLevel} disabled={disabled} />
          <Button variant="outline" size="sm" disabled={disabled || saving || isDefault || !want || !!catalog?.error} onClick={() => void saveDefault()}>
            {saving && <Spinner data-icon="inline-start" />}{isDefault ? "Default for new sessions" : "Use for new sessions"}
          </Button>
        </div>
      </PickerContent>
    </Popover>
  );
}
