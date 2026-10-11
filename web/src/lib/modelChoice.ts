/**
 * The model and effort the composer's picker shows, decided once for the session page and the
 * New page: what the picker displays, what a change means (an action for the running Pi, or a
 * choice remembered for the first prompt), and the start options that prompt carries.
 */
import type { ModelCatalog, SessionAction, StartOptions, ThinkingLevel } from "@shared/wire";

const ALL: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

/**
 * Whose model the picker sets: a session not started yet (the New page), or a session. A hosted
 * session has a running Pi that owns its selection; an unhosted one shows what its file recorded.
 */
export type ModelTarget =
  | { kind: "new" }
  | { kind: "session"; hosted: boolean; model?: string; thinkingLevel?: string };

/** The user's own picker changes not yet sent to Pi. */
export interface ModelPick {
  model?: string;
  thinkingLevel?: ThinkingLevel;
}

/** What the picker shows. */
export interface ModelSelection {
  model: string | undefined;
  effort: ThinkingLevel;
}

/** A picker change: send `action` to the running Pi, or remember `pick` for the first prompt. */
export type ModelChange = { kind: "act"; action: SessionAction } | { kind: "pick"; pick: ModelPick };

/** Efforts a model accepts, from Pi's catalog; every level while the model is unknown. */
export function levelsFor(catalog: ModelCatalog | null, model: string | undefined): ThinkingLevel[] {
  const m = catalog?.models.find(x => x.ref === model);
  return m ? [...m.thinkingLevels] : ALL;
}

/** The wanted level if the model accepts it, else the nearest lower one, else the lowest it has. */
export function clampEffort(levels: ThinkingLevel[], wanted: ThinkingLevel): ThinkingLevel {
  if (levels.includes(wanted)) return wanted;
  const below = ALL.slice(0, ALL.indexOf(wanted)).filter(l => levels.includes(l));
  return below[below.length - 1] ?? levels[0] ?? "off";
}

const level = (value: string | undefined): ThinkingLevel | undefined =>
  ALL.includes(value as ThinkingLevel) ? value as ThinkingLevel : undefined;

/** A picked model counts while the catalog still lists it, or while the catalog is unknown. */
const pickedModel = (catalog: ModelCatalog | null, pick: ModelPick) =>
  pick.model && (!catalog || catalog.models.some(m => m.ref === pick.model)) ? pick.model : undefined;

/**
 * The picker's model and effort. A hosted session shows Pi's own selection; otherwise the user's
 * pick, then the session's recorded selection, then Pi's defaults. Effort is clamped to what the
 * shown model accepts, so switching models re-clamps it while the pick keeps the wanted level.
 */
export function selectModel(catalog: ModelCatalog | null, target: ModelTarget, pick: ModelPick): ModelSelection {
  const defaultEffort = level(catalog?.defaultThinkingLevel) ?? "medium";
  if (target.kind === "session" && target.hosted) {
    const model = target.model || catalog?.defaultModel;
    return { model, effort: level(target.thinkingLevel) ?? clampEffort(levelsFor(catalog, model), defaultEffort) };
  }
  const recorded: { model?: string; thinkingLevel?: string } = target.kind === "session" ? target : {};
  const model = pickedModel(catalog, pick) || recorded.model || catalog?.defaultModel;
  const wanted = pick.thinkingLevel ?? level(recorded.thinkingLevel) ?? defaultEffort;
  return { model, effort: clampEffort(levelsFor(catalog, model), wanted) };
}

/** Choosing a model: a hosted session switches now; otherwise the choice waits for the first prompt. */
export function pickModel(target: ModelTarget, pick: ModelPick, model: string): ModelChange {
  return target.kind === "session" && target.hosted
    ? { kind: "act", action: { _tag: "set_model", model } }
    : { kind: "pick", pick: { ...pick, model } };
}

/** Choosing an effort, under the same rule as choosing a model. */
export function pickEffort(target: ModelTarget, pick: ModelPick, level: ThinkingLevel): ModelChange {
  return target.kind === "session" && target.hosted
    ? { kind: "act", action: { _tag: "set_thinking_level", level } }
    : { kind: "pick", pick: { ...pick, thinkingLevel: level } };
}

/**
 * The start options the first prompt carries. A new session starts with exactly what the picker
 * shows. Continuing a saved session lets Pi restore its own selection, overridden only by the
 * user's deliberate picks; a hosted session is already running and takes none.
 */
export function startOptions(catalog: ModelCatalog | null, target: ModelTarget, pick: ModelPick): StartOptions {
  const shown = selectModel(catalog, target, pick);
  if (target.kind === "new") return { model: shown.model, thinkingLevel: shown.effort };
  if (target.hosted) return {};
  const model = pickedModel(catalog, pick);
  return { ...(model ? { model } : {}), ...(pick.thinkingLevel ? { thinkingLevel: shown.effort } : {}) };
}
