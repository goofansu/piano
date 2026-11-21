import { saveDefaults } from "../features/models/modelApi.ts";
import {
  browserCatalogStorage,
  type CatalogStorage,
  createModelCatalogs,
  type ModelCatalogs,
} from "../features/models/modelCatalogs.ts";
import { createDrafts, type Drafts } from "../features/sessions/composer/messageDraft.ts";
import {
  createQuestionReplies,
  type QuestionReplies,
} from "../features/sessions/dialogs/piDialogs.ts";
import type { Notify } from "./client.ts";

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
