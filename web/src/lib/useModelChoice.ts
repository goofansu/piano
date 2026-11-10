import type { SessionAction, StartOptions, ThinkingLevel } from "@shared/wire";
import { useState } from "react";
import type { ModelCatalogView } from "@/lib/modelCatalogs";
import { emptyChoice, type ModelChange, type ModelTarget, modelChoice } from "@/lib/modelChoice";

/**
 * Everything the composer's model picker reads and does for one target. The page hands it to
 * DraftEditor whole, and ModelSelect renders from it, so a new picker action changes `modelChoice`,
 * this hook and the picker, not the pages between them.
 */
export interface ModelControl {
  /** The directory's catalog with its refresh and saved defaults (`useModelCatalog`). */
  models: ModelCatalogView;
  model: string | undefined;
  effort: ThinkingLevel;
  /** The New page has no directory yet, so there is no catalog to wait for. */
  noDirectory: boolean;
  chooseModel: (model: string) => void;
  chooseEffort: (level: ThinkingLevel) => void;
  /** Returns the model and effort to Pi's defaults for new sessions. */
  chooseDefaults: () => void;
}

/**
 * The composer picker's state for one target: React state around `modelChoice`, which decides
 * which target a pick belongs to and what a change means.
 */
export function useModelChoice(
  models: ModelCatalogView,
  target: ModelTarget,
  act?: (action: SessionAction) => void,
  ready = true,
): ModelControl & {
  /** Sends with the start options; a send that consumed its input clears the pick it carried. */
  submit: (send: (start: StartOptions) => boolean) => void;
  start: StartOptions;
  consume: () => void;
} {
  const [held, setHeld] = useState(() => emptyChoice(target));
  const choice = modelChoice(held, models.catalog, target, ready);
  const apply = (change: ModelChange) => {
    if (change.kind === "act") act?.(change.action);
    else setHeld(change.held);
  };
  return {
    models,
    model: choice.model,
    effort: choice.effort,
    noDirectory: target.kind === "new" && !target.cwd,
    submit: (send) => setHeld(choice.submit(send)),
    start: choice.start,
    consume: () => setHeld((now) => (now === held ? choice.submit(() => true) : now)),
    chooseModel: (model) => apply(choice.chooseModel(model)),
    chooseEffort: (level) => apply(choice.chooseEffort(level)),
    chooseDefaults: () => {
      for (const change of choice.chooseDefaults()) apply(change);
    },
  };
}
