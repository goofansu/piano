import type { ModelCatalog, SessionDefaults } from "@shared/wire";

export interface ModelDefaults {
  defaults: SessionDefaults;
  catalog: ModelCatalog;
}

// A browser-memory projection only. Pi remains authoritative for saved defaults.
let cached: ModelDefaults | undefined;
let generation = 0;

export const cachedModelDefaults = () => cached;

export function invalidateModelDefaults(): void {
  generation++;
  cached = undefined;
}

export async function loadModelDefaults(signal: AbortSignal, refresh = false): Promise<ModelDefaults> {
  if (!refresh && cached) return cached;
  const started = generation;
  const response = await fetch(`/api/settings/defaults${refresh ? "?refresh=true" : ""}`, { signal });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Could not load defaults.");
  if (result.catalog.error) throw new Error("Could not load models. Try again.");
  if (!signal.aborted && started === generation) cached = result;
  return result;
}

export async function saveModelDefaults(defaults: SessionDefaults): Promise<SessionDefaults> {
  const response = await fetch("/api/settings/defaults", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(defaults) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Could not save defaults.");
  invalidateModelDefaults();
  return result.defaults;
}
