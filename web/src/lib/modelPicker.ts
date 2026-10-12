/**
 * What the model picker shows for one moment: the model it displays, its trigger label, whether
 * the trigger (and so Mod+/) can open it, the models a search leaves, and whether the shown
 * selection is, or can be saved as, Pi's default for new sessions. Pure and React-free;
 * ModelSelect renders from it and keeps focus, keys, refresh tracking and the save request.
 */
import type { ModelCatalog, ModelChoice, ThinkingLevel } from "@shared/wire";
import { levelsFor } from "./modelChoice.ts";

/** What decides whether the picker can open; the trigger and the Mod+/ shortcut both read it. */
export interface ModelPickerAvailability {
  /** The editor, and so the picker, takes no input. */
  disabled: boolean;
  /** The directory's catalog: `null` until Pi answers. */
  catalog: Pick<ModelCatalog, "models"> | null;
  /** The picker offers a refresh that could find models. */
  canRefresh: boolean;
}

/**
 * The picker opens when the editor takes input and the catalog has a model to pick or can be
 * refreshed to find one.
 */
export const modelPickerEnabled = (s: ModelPickerAvailability): boolean =>
  !s.disabled && !!s.catalog && (s.catalog.models.length > 0 || s.canRefresh);

export interface ModelPickerInput extends ModelPickerAvailability {
  catalog: ModelCatalog | null;
  /** The selected model, if any; Pi's default model stands in when it is absent. */
  value: string | undefined;
  effort: ThinkingLevel;
  /** The search box's text. */
  query: string;
  /** No directory is chosen yet, so there is no catalog to wait for. */
  noDirectory: boolean;
  /** A model the user just chose; a hosted session reports it back asynchronously. */
  chosen: string | null;
  /** Saving the defaults is in flight. */
  saving: boolean;
}

export interface ModelPickerView {
  /** The model the picker shows and checks, or "" when there is none. */
  shown: string;
  /** The trigger's text: the shown model's last path segment, or why there is none. */
  label: string;
  /** The label is a placeholder while the catalog loads. */
  shimmer: boolean;
  triggerEnabled: boolean;
  /** Catalog models matching the search literally, in catalog order. */
  visibleModels: readonly ModelChoice[];
  /** What the list says when no model is visible. */
  emptyText: string;
  /** Efforts the shown model accepts. */
  levels: ThinkingLevel[];
  /** Off while a chosen model has not been shown yet, so its efforts are not known. */
  effortEnabled: boolean;
  /** The shown model and effort are already Pi's defaults for new sessions. */
  isDefault: boolean;
  canSaveDefault: boolean;
  saveLabel: string;
}

export function modelPickerView(s: ModelPickerInput): ModelPickerView {
  const { catalog } = s;
  const shown = s.value || catalog?.defaultModel || "";
  const models = catalog?.models ?? [];
  // Literal matching avoids unrelated fuzzy hits and preserves catalog order.
  const needle = s.query.trim().toLowerCase();
  const visibleModels = needle
    ? models.filter((m) =>
        [m.ref, m.id, m.provider, m.name ?? ""].some((text) => text.toLowerCase().includes(needle)),
      )
    : models;
  const waitingForModel = s.chosen !== null && s.chosen !== shown;
  const isDefault =
    !!shown && shown === catalog?.defaultModel && s.effort === catalog.defaultThinkingLevel;
  const label = !catalog
    ? s.noDirectory
      ? "Model"
      : "Loading models"
    : catalog.error
      ? "No models"
      : shown
        ? (shown.split("/").pop() ?? shown)
        : "Model";
  return {
    shown,
    label,
    shimmer: !catalog && !s.noDirectory,
    triggerEnabled: modelPickerEnabled(s),
    visibleModels,
    emptyText: catalog?.error ? "No models available." : "No model matches.",
    levels: levelsFor(catalog, shown),
    effortEnabled: !s.disabled && !waitingForModel,
    isDefault,
    canSaveDefault:
      !s.disabled && !waitingForModel && !s.saving && !isDefault && !!shown && !catalog?.error,
    saveLabel: isDefault ? "Default for new sessions" : "Use for new sessions",
  };
}
