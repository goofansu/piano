import type { ModelCatalog, ModelChoice, ThinkingLevel } from "@shared/wire";
import { levelsFor, piDefaults } from "./modelChoice.ts";

export interface ModelPickerAvailability {
  disabled: boolean;
  catalog: Pick<ModelCatalog, "models"> | null;
  canRefresh: boolean;
}

export const modelPickerEnabled = (s: ModelPickerAvailability): boolean =>
  !s.disabled && !!s.catalog && (s.catalog.models.length > 0 || s.canRefresh);

export interface ModelPickerInput extends ModelPickerAvailability {
  catalog: ModelCatalog | null;
  value: string | undefined;
  effort: ThinkingLevel;
  query: string;
  openingModel?: string;
  noDirectory: boolean;
  chosen: string | null;
  saving: boolean;
}

export interface ModelPickerView {
  shown: string;
  label: string;
  shimmer: boolean;
  triggerEnabled: boolean;
  visibleModels: readonly ModelChoice[];
  emptyText: string;
  levels: ThinkingLevel[];
  effortEnabled: boolean;
  isDefault: boolean;
  canSaveDefault: boolean;
  canUseDefault: boolean;
  defaultLabel: string | null;
}

export function modelPickerView(s: ModelPickerInput): ModelPickerView {
  const { catalog } = s;
  const shown = s.value || catalog?.defaultModel || "";
  const models = catalog?.models ?? [];
  const needle = s.query.trim().toLowerCase();
  const visibleModels = needle
    ? models.filter((m) =>
        [m.ref, m.id, m.provider, m.name ?? ""].some((text) => text.toLowerCase().includes(needle)),
      )
    : [
        ...models.filter((m) => m.ref === s.openingModel),
        ...models.filter((m) => m.ref !== s.openingModel),
      ];
  const waitingForModel = s.chosen !== null && s.chosen !== shown;
  const defaults = piDefaults(catalog);
  const isDefault = !!shown && shown === defaults?.model && s.effort === defaults.thinkingLevel;
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
    canUseDefault: !s.disabled && !waitingForModel && !isDefault && !catalog?.error && !!defaults,
    defaultLabel: defaults
      ? `${defaults.model.split("/").pop() ?? defaults.model} · ${defaults.thinkingLevel}`
      : null,
  };
}
