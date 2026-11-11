import { saveDefaults } from "./api.ts";
import type { Notify } from "./client.ts";
import { LOCAL } from "./machine.ts";
import { createDrafts, type Drafts } from "./messageDraft.ts";
import {
  browserCatalogStorage,
  type CatalogStorage,
  createModelCatalogs,
  type ModelCatalogs,
} from "./modelCatalogs.ts";
import { createQuestionReplies, type QuestionReplies } from "./piDialogs.ts";

export interface MachineStores {
  drafts: Drafts;
  questions: QuestionReplies;
  catalogs: ModelCatalogs;
}

/**
 * One partition per configured identity; identical remote cwd/IDs never share stores. Drafts and
 * question replies last for this page; a remote's catalogs outlive a reload in its own storage.
 */
export function createMachineStores(
  local: MachineStores,
  notify: Notify,
  catalogStorage: (machineId: string) => CatalogStorage = browserCatalogStorage,
) {
  const stores = new Map<string, MachineStores>([[LOCAL.id, local]]);
  return (id: string): MachineStores => {
    let current = stores.get(id);
    if (!current) {
      current = {
        drafts: createDrafts(),
        questions: createQuestionReplies(),
        // The remote's own storage: its catalogs never seed from Local's cwd cache.
        catalogs: createModelCatalogs({
          storage: catalogStorage(id),
          notify,
          // The remote's own Pi settings; its catalogs then show the new default.
          saveDefaults: (model, effort) => saveDefaults(model, effort, { machineId: id }),
        }),
      };
      stores.set(id, current);
    }
    return current;
  };
}
