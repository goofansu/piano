import type { ModelCatalog, SessionDefaults, ThinkingLevel } from "@shared/wire";
import { AlertCircleIcon, ChevronsUpDownIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { PickerCheck, PickerContent, PickerSearch } from "@/components/Picker";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from "@/components/ui/command";
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldTitle } from "@/components/ui/field";
import { Popover, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

const LEVELS: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

export function ModelSettings() {
  const [loaded, setLoaded] = useState<{ defaults: SessionDefaults; catalog: ModelCatalog }>();
  const [draft, setDraft] = useState<SessionDefaults>();
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    void fetch("/api/settings/defaults", { signal: controller.signal }).then(async response => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not load defaults.");
      if (!controller.signal.aborted) { setLoaded(result); setDraft(result.defaults); }
    }).catch(error => {
      if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Could not load defaults.");
    });
    return () => controller.abort();
  }, [revision]);
  const save = async () => {
    if (!draft || saving) return;
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/settings/defaults", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(draft) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not save defaults.");
      setDraft(result.defaults);
      setLoaded(previous => previous ? { ...previous, defaults: result.defaults } : previous);
      toast.success("Defaults saved for new sessions.");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not save defaults. Try again.");
    } finally { setSaving(false); }
  };
  const models = loaded?.catalog.models ?? [];
  const needle = query.trim().toLowerCase();
  const visible = models.filter(model => [model.ref, model.name ?? ""].some(text => text.toLowerCase().includes(needle)));
  const changed = draft && loaded && (draft.model !== loaded.defaults.model || draft.thinkingLevel !== loaded.defaults.thinkingLevel);
  return <>
    {error && <Alert variant="destructive">
      <AlertCircleIcon />
      <AlertTitle>{loaded ? "Could not save defaults" : "Could not load defaults"}</AlertTitle>
      <AlertDescription>
        <p>{error}</p>
        {!loaded && <Button variant="outline" size="sm" onClick={() => setRevision(value => value + 1)}>Retry</Button>}
      </AlertDescription>
    </Alert>}
    {!draft ? !error && <div role="status" className="flex flex-col gap-4">
      <span className="sr-only">Loading defaults…</span><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" />
    </div> : <form onSubmit={event => { event.preventDefault(); void save(); }}>
      <FieldGroup>
        <Field data-disabled={saving}>
          <FieldLabel htmlFor="default-model">Default model</FieldLabel>
          <Popover open={open} onOpenChange={next => { setOpen(next); setQuery(""); }}>
            <PopoverTrigger asChild>
              <Button id="default-model" type="button" variant="outline" role="combobox" aria-expanded={open} disabled={saving || !models.length} className="w-full justify-between" title={draft.model}>
                <span className="truncate">{draft.model ?? "Automatic (Pi chooses)"}</span><ChevronsUpDownIcon data-icon="inline-end" />
              </Button>
            </PopoverTrigger>
            <PickerContent aria-label="Default model" searchRef={search}>
              <Command shouldFilter={false}>
                <PickerSearch ref={search} value={query} onValueChange={setQuery} placeholder="Search models" aria-label="Search default models" />
                <CommandList>
                  <CommandEmpty>No model matches.</CommandEmpty>
                  <CommandGroup>{visible.map(model => <CommandItem key={model.ref} value={model.ref} onSelect={() => { setDraft(value => value && { ...value, model: model.ref }); setOpen(false); }}>
                    <span className="min-w-0 flex-1 break-words">{model.ref}</span><PickerCheck selected={draft.model === model.ref} />
                  </CommandItem>)}</CommandGroup>
                </CommandList>
              </Command>
            </PickerContent>
          </Popover>
          {loaded?.catalog.error ? <FieldDescription>Could not load models. <Button type="button" variant="link" size="sm" onClick={() => setRevision(value => value + 1)}>Retry</Button></FieldDescription>
            : !models.length && <FieldDescription>Sign in to a provider to choose a model.</FieldDescription>}
        </Field>
        <Field data-disabled={saving}>
          <FieldTitle id="default-effort-label">Default effort</FieldTitle>
          <ToggleGroup type="single" variant="outline" spacing={1} value={draft.thinkingLevel} disabled={saving} aria-labelledby="default-effort-label"
            onValueChange={level => { if (level) setDraft(value => value && { ...value, thinkingLevel: level as ThinkingLevel }); }} className="flex-wrap">
            {LEVELS.map(level => <ToggleGroupItem key={level} value={level}>{level}</ToggleGroupItem>)}
          </ToggleGroup>
          <FieldDescription>Pi limits effort to what the selected model supports.</FieldDescription>
        </Field>
        <Field orientation="horizontal">
          <Button type="submit" disabled={!changed || saving}>{saving && <Spinner data-icon="inline-start" />}Save defaults</Button>
        </Field>
      </FieldGroup>
    </form>}
  </>;
}
