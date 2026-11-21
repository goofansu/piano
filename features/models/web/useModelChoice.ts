import type { ModelCatalogView } from "@features/models/web/modelCatalogs";
import {
  emptyChoice,
  type ModelChange,
  type ModelPick,
  type ModelTarget,
  modelChoice,
} from "@features/models/web/modelChoice";
import type { SessionAction, StartOptions, ThinkingLevel } from "@shared/wire";
import { useState } from "react";

export interface ModelControl {
  models: ModelCatalogView;
  model: string | undefined;
  effort: ThinkingLevel;
  noDirectory: boolean;
  chooseModel: (model: string) => void;
  chooseEffort: (level: ThinkingLevel) => void;
  chooseDefaults: () => void;
}

export function useModelChoice(
  models: ModelCatalogView,
  target: ModelTarget,
  act?: (action: SessionAction) => void,
  ready = true,
  initialPick: ModelPick = {},
): ModelControl & {
  submit: (send: (start: StartOptions) => boolean) => void;
  start: StartOptions;
  consume: () => void;
} {
  const [held, setHeld] = useState(() => ({ ...emptyChoice(target), pick: initialPick }));
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
