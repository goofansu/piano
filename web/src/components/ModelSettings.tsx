import type { SessionDefaults, ThinkingLevel } from "@shared/wire";
import { AlertCircleIcon, RefreshCwIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { clampEffort, levelsFor } from "@/components/EffortSelect";
import { ModelSelect } from "@/components/ModelSelect";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldContent, FieldDescription, FieldGroup, FieldTitle } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { cachedModelDefaults, loadModelDefaults, saveModelDefaults } from "@/lib/modelDefaults";

export function ModelSettings() {
  const [loaded, setLoaded] = useState(cachedModelDefaults);
  const [draft, setDraft] = useState<SessionDefaults | undefined>(() => cachedModelDefaults()?.defaults);
  const edited = useRef(false);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState("");
  const [errorOperation, setErrorOperation] = useState<"load" | "save">("load");
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  useEffect(() => {
    if (revision === 0 && cachedModelDefaults()) return;
    const controller = new AbortController();
    setError("");
    setRefreshing(true);
    void loadModelDefaults(controller.signal, revision > 0).then(result => {
      if (!controller.signal.aborted) {
        setLoaded(result);
        if (!edited.current) setDraft(result.defaults);
      }
    }).catch(error => {
      if (!controller.signal.aborted) {
        setErrorOperation("load");
        setError(error instanceof Error ? error.message : "Could not load defaults.");
      }
    }).finally(() => { if (!controller.signal.aborted) setRefreshing(false); });
    return () => controller.abort();
  }, [revision]);
  const catalog = loaded?.catalog ?? null;
  const model = draft?.model ?? catalog?.defaultModel;
  const effort = clampEffort(levelsFor(catalog, model), draft?.thinkingLevel ?? "medium");
  const save = async () => {
    if (!draft || saving || refreshing) return;
    setSaving(true); setError("");
    try {
      const defaults = await saveModelDefaults({ ...draft, thinkingLevel: effort });
      edited.current = false;
      setDraft(defaults);
      setLoaded(previous => previous ? { ...previous, defaults } : previous);
      toast.success("Defaults saved for new sessions.");
    } catch (error) {
      setErrorOperation("save");
      setError(error instanceof Error ? error.message : "Could not save defaults. Try again.");
    } finally { setSaving(false); }
  };
  const chooseModel = (ref: string) => {
    edited.current = true;
    setDraft(value => value && { ...value, model: ref, thinkingLevel: clampEffort(levelsFor(catalog, ref), value.thinkingLevel) });
  };
  const chooseEffort = (thinkingLevel: ThinkingLevel) => {
    edited.current = true;
    setDraft(value => value && { ...value, thinkingLevel });
  };
  const changed = draft && loaded && (draft.model !== loaded.defaults.model || effort !== loaded.defaults.thinkingLevel);
  return <>
    {error && <Alert variant="destructive">
      <AlertCircleIcon />
      <AlertTitle>{errorOperation === "save" ? "Could not save defaults" : "Could not load defaults"}</AlertTitle>
      <AlertDescription>
        <p>{error}</p>
        {errorOperation === "load" && <Button variant="outline" size="sm" disabled={refreshing} onClick={() => setRevision(value => value + 1)}>Retry</Button>}
      </AlertDescription>
    </Alert>}
    {!draft ? !error && <div role="status" className="flex flex-col gap-4">
      <span className="sr-only">Loading defaults…</span><Skeleton className="h-10 w-full" />
    </div> : <form onSubmit={event => { event.preventDefault(); void save(); }}>
      <FieldGroup>
        <Field data-disabled={saving} aria-labelledby="default-model-label">
          <FieldTitle id="default-model-label">Model and effort</FieldTitle>
          <FieldContent className="items-start">
            <ModelSelect variant="outline" catalog={catalog} value={draft.model} onChange={chooseModel} effort={effort} onEffortChange={chooseEffort} disabled={saving} />
          </FieldContent>
        </Field>
        {!catalog?.models.length && <FieldDescription>Sign in to a provider to choose a model.</FieldDescription>}
        <Field orientation="horizontal">
          <Button type="submit" disabled={!changed || saving || refreshing}>{saving && <Spinner data-icon="inline-start" />}Save</Button>
          <Button type="button" variant="outline" aria-label="Refresh" disabled={saving || refreshing} onClick={() => setRevision(value => value + 1)}>
            {refreshing ? <Spinner data-icon="inline-start" /> : <RefreshCwIcon data-icon="inline-start" />}Refresh
          </Button>
        </Field>
      </FieldGroup>
    </form>}
  </>;
}
