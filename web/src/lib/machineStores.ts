import type { Notify } from "./client.ts";
import { createDrafts, type Drafts } from "./messageDraft.ts";
import { createModelCatalogs, type ModelCatalogs } from "./modelCatalogs.ts";
import { createQuestionReplies, type QuestionReplies } from "./piDialogs.ts";

export interface MachineStores {
  drafts: Drafts;
  questions: QuestionReplies;
  catalogs: ModelCatalogs;
}

/** One page-memory partition per configured identity; identical remote cwd/IDs never share stores. */
export function createMachineStores(local: MachineStores, notify: Notify) {
  const stores = new Map<string, MachineStores>([["local", local]]);
  return (id: string): MachineStores => {
    let current = stores.get(id);
    if (!current) {
      current = {
        drafts: createDrafts(),
        questions: createQuestionReplies(),
        // Deliberately not persisted; remote catalogs never seed from Local's cwd cache.
        catalogs: createModelCatalogs({
          storage: { read: () => ({}), write: () => {} },
          notify,
          saveDefaults: async () => {
            throw new Error("Defaults are managed on the remote Piano.");
          },
        }),
      };
      stores.set(id, current);
    }
    return current;
  };
}
