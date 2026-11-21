import { saveDefaults } from "./api.ts";
import type { Notify } from "./client.ts";
import { createDrafts, type Drafts } from "./messageDraft.ts";
import {
  browserCatalogStorage,
  type CatalogStorage,
  createModelCatalogs,
  type ModelCatalogs,
} from "./modelCatalogs.ts";
import { createQuestionReplies, type QuestionReplies } from "./piDialogs.ts";

export interface PageStores {
  drafts: Drafts;
  questions: QuestionReplies;
  catalogs: ModelCatalogs;
}

export function createPageStores(
  notify: Notify,
  catalogStorage: CatalogStorage = browserCatalogStorage(),
): PageStores {
  return {
    drafts: createDrafts(),
    questions: createQuestionReplies(),
    catalogs: createModelCatalogs({ storage: catalogStorage, notify, saveDefaults }),
  };
}
