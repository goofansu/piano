import type { ModelCatalog, SessionAction, ThinkingLevel } from "@shared/wire";
import { useState } from "react";
import { type ModelChange, type ModelPick, type ModelTarget, pickEffort, pickModel, selectModel, startOptions } from "@/lib/modelChoice";

/**
 * The composer picker's state for one target. The user's pick belongs to `scope` (a session, or the
 * New page's directory) and starts empty when the scope changes; reconnecting keeps it.
 */
export function useModelChoice(catalog: ModelCatalog | null, target: ModelTarget, scope: string, act?: (action: SessionAction) => void) {
  const [held, setHeld] = useState<{ scope: string; pick: ModelPick }>({ scope, pick: {} });
  const pick = held.scope === scope ? held.pick : {};
  const apply = (change: ModelChange) => {
    if (change.kind === "act") act?.(change.action);
    else setHeld({ scope, pick: change.pick });
  };
  return {
    ...selectModel(catalog, target, pick),
    start: () => startOptions(catalog, target, pick),
    onModelChange: (model: string) => apply(pickModel(target, pick, model)),
    onEffortChange: (level: ThinkingLevel) => apply(pickEffort(target, pick, level)),
  };
}
