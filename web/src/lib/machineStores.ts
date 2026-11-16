import { saveDefaults } from "./api.ts";
import type { Notify } from "./client.ts";
import { isLocalId } from "./machine.ts";
import { createDrafts, type Drafts } from "./messageDraft.ts";
import {
  browserCatalogStorage,
  type CatalogStorage,
  createModelCatalogs,
  type ModelCatalogs,
} from "./modelCatalogs.ts";
import { createQuestionReplies, type QuestionReplies } from "./piDialogs.ts";
import { createPreviewObservation, type PreviewObservation } from "./previewObservation.ts";

export interface MachineStores {
  drafts: Drafts;
  questions: QuestionReplies;
  catalogs: ModelCatalogs;
  previews?: PreviewObservation;
}

export function createMachineStores(
  notify: Notify,
  catalogStorage: (machineId: string) => CatalogStorage = browserCatalogStorage,
) {
  const stores = new Map<string, MachineStores>();
  return (id: string): MachineStores => {
    let current = stores.get(id);
    if (!current) {
      current = {
        drafts: createDrafts(),
        questions: createQuestionReplies(),
        catalogs: createModelCatalogs({
          storage: catalogStorage(id),
          notify,
          saveDefaults: (model, effort) => saveDefaults(model, effort, { machineId: id }),
        }),
        ...(isLocalId(id) && { previews: createPreviewObservation() }),
      };
      stores.set(id, current);
    }
    return current;
  };
}
