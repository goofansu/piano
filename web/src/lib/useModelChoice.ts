import type { ModelCatalog, SessionAction, ThinkingLevel } from "@shared/wire";
import { useState } from "react";
import {
  type ModelChange,
  type ModelPick,
  type ModelTarget,
  pickEffort,
  pickModel,
  selectModel,
  startOptions,
} from "@/lib/modelChoice";

/**
 * The composer picker's state for one target. The user's pick belongs to `scope` (a session, or the
 * New page's directory) and starts empty when the scope changes; reconnecting keeps it.
 */
export function useModelChoice(
  catalog: ModelCatalog | null,
  target: ModelTarget,
  scope: string,
  act?: (action: SessionAction) => void,
  ready = true,
) {
  const [held, setHeld] = useState<{ scope: string; pick: ModelPick }>({ scope, pick: {} });
  const pick = held.scope === scope ? held.pick : {};
  // An offline choice stays draft-local through reconnect, until the next explicit send.
  // Carry it with that input so the server applies it before submitting, not in a racing request.
  const local = !ready || pick.model !== undefined || pick.thinkingLevel !== undefined;
  const effectiveTarget =
    local && target.kind === "session" ? { ...target, hosted: false } : target;
  const apply = (change: ModelChange) => {
    if (change.kind === "act") act?.(change.action);
    else setHeld({ scope, pick: change.pick });
  };
  return {
    ...selectModel(catalog, effectiveTarget, pick),
    start: () => startOptions(catalog, effectiveTarget, pick),
    submitted: () => setHeld({ scope, pick: {} }),
    onModelChange: (model: string) => apply(pickModel(effectiveTarget, pick, model)),
    onEffortChange: (level: ThinkingLevel) => apply(pickEffort(effectiveTarget, pick, level)),
  };
}
