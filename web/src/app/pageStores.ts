import {
  saveDefaults,
  browserCatalogStorage,
  type CatalogStorage,
  createModelCatalogs,
  type ModelCatalogs,
} from "../../../features/models/web/index.ts";
import {
  createDrafts,
  type Drafts,
  createQuestionReplies,
  type QuestionReplies,
} from "../../../features/sessions/web/index.ts";
import type { Notify } from "../shared/state/client.ts";

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
