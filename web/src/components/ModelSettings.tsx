import type { ModelCatalog, SessionDefaults, ThinkingLevel } from "@shared/wire";
import { AlertCircleIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { clampEffort, levelsFor } from "@/components/EffortSelect";
import { ModelSelect } from "@/components/ModelSelect";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldTitle } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";

export function ModelSettings() {
  const [loaded, setLoaded] = useState<{ defaults: SessionDefaults; catalog: ModelCatalog }>();
  const [draft, setDraft] = useState<SessionDefaults>();
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
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
  const catalog = loaded?.catalog ?? null;
  const model = draft?.model ?? catalog?.defaultModel;
  const effort = clampEffort(levelsFor(catalog, model), draft?.thinkingLevel ?? "medium");
  const save = async () => {
    if (!draft || saving) return;
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/settings/defaults", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...draft, thinkingLevel: effort }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not save defaults.");
      setDraft(result.defaults);
      setLoaded(previous => previous ? { ...previous, defaults: result.defaults } : previous);
      toast.success("Defaults saved for new sessions.");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not save defaults. Try again.");
    } finally { setSaving(false); }
  };
  const chooseModel = (ref: string) => setDraft(value => value && {
    ...value, model: ref, thinkingLevel: clampEffort(levelsFor(catalog, ref), value.thinkingLevel),
  });
  const chooseEffort = (thinkingLevel: ThinkingLevel) => setDraft(value => value && { ...value, thinkingLevel });
  const changed = draft && loaded && (draft.model !== loaded.defaults.model || effort !== loaded.defaults.thinkingLevel);
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
      <span className="sr-only">Loading defaults…</span><Skeleton className="h-10 w-full" />
    </div> : <form onSubmit={event => { event.preventDefault(); void save(); }}>
      <FieldGroup>
        <Field orientation="responsive" data-disabled={saving} aria-labelledby="default-model-label">
          <FieldTitle id="default-model-label">Model and effort</FieldTitle>
          <ModelSelect catalog={catalog} value={draft.model} onChange={chooseModel} effort={effort} onEffortChange={chooseEffort} disabled={saving} />
        </Field>
        {catalog?.error ? <FieldDescription>Could not load models. <Button type="button" variant="link" size="sm" onClick={() => setRevision(value => value + 1)}>Retry</Button></FieldDescription>
          : !catalog?.models.length && <FieldDescription>Sign in to a provider to choose a model.</FieldDescription>}
        <Field orientation="horizontal">
          <Button type="submit" disabled={!changed || saving}>{saving && <Spinner data-icon="inline-start" />}Save</Button>
        </Field>
      </FieldGroup>
    </form>}
  </>;
}
