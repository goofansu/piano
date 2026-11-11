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
  /**
   * The selected session's app, observed for the rail, Preview and its commands. Local's only: a
   * remote's apps stay on its own Piano (ADR 0004), so its sessions show no app and no Open or Stop,
   * though their snapshots carry the peer's preview.
   */
  previews?: PreviewObservation;
}

/**
 * One partition per configured identity, Local's built like any other: identical cwd/IDs on two
 * machines never share stores. Drafts and question replies last for this page; each machine's
 * catalogs outlive a reload in its own storage. Only Local observes previews.
 */
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
        // The machine's own storage: its catalogs never seed from another machine's cwd cache.
        catalogs: createModelCatalogs({
          storage: catalogStorage(id),
          notify,
          // The machine's own Pi settings; its catalogs then show the new default.
          saveDefaults: (model, effort) => saveDefaults(model, effort, { machineId: id }),
        }),
        ...(isLocalId(id) && { previews: createPreviewObservation() }),
      };
      stores.set(id, current);
    }
    return current;
  };
}
