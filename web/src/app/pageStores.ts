import { saveDefaults } from "../../../features/models/web/modelApi.ts";
import {
  browserCatalogStorage,
  type CatalogStorage,
  createModelCatalogs,
  type ModelCatalogs,
} from "../../../features/models/web/modelCatalogs.ts";
import { createDrafts, type Drafts } from "../../../features/sessions/web/composer/messageDraft.ts";
import {
  createQuestionReplies,
  type QuestionReplies,
} from "../../../features/sessions/web/dialogs/piDialogs.ts";
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
