import type { ModelCatalog, SessionAction, StartOptions, ThinkingLevel } from "@shared/wire";
import { useState } from "react";
import { emptyChoice, type ModelChange, type ModelTarget, modelChoice } from "@/lib/modelChoice";

/**
 * The composer picker's state for one target: React state around `modelChoice`, which decides
 * which target a pick belongs to and what a change means.
 */
export function useModelChoice(
  catalog: ModelCatalog | null,
  target: ModelTarget,
  act?: (action: SessionAction) => void,
  ready = true,
) {
  const [held, setHeld] = useState(() => emptyChoice(target));
  const choice = modelChoice(held, catalog, target, ready);
  const apply = (change: ModelChange) => {
    if (change.kind === "act") act?.(change.action);
    else setHeld(change.held);
  };
  return {
    model: choice.model,
    effort: choice.effort,
    /** Sends with the start options; a send that consumed its input clears the pick it carried. */
    submit: (send: (start: StartOptions) => boolean) => setHeld(choice.submit(send)),
    onModelChange: (model: string) => apply(choice.chooseModel(model)),
    onEffortChange: (level: ThinkingLevel) => apply(choice.chooseEffort(level)),
  };
}
