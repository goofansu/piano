/**
 * The model and effort the composer's picker shows, decided once for the session page and the
 * New page: what the picker displays, what a change means (an action for the running Pi, or a
 * choice held for the next prompt), the start options that prompt carries, and which target a
 * held choice belongs to.
 */
import type { ModelCatalog, SessionAction, StartOptions, ThinkingLevel } from "@shared/wire";

const ALL: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

/**
 * Whose model the picker sets: a session not started yet (the New page, in its directory), or a
 * session. A hosted session has a running Pi that owns its selection; an unhosted one shows what
 * its file recorded. `cwd` and `sessionId` name the target, so a pick never outlives it.
 */
export type ModelTarget =
  | { kind: "new"; cwd: string }
  | {
      kind: "session";
      cwd?: string;
      sessionId?: string | null;
      hosted: boolean;
      model?: string;
      thinkingLevel?: string;
    };

/** The user's own picker changes not yet sent to Pi. */
export interface ModelPick {
  model?: string;
  thinkingLevel?: ThinkingLevel;
}

/** The pick the picker holds, and the target it was made for. */
export interface HeldChoice {
  readonly scope: string;
  readonly pick: ModelPick;
}

/** What the picker shows. */
export interface ModelSelection {
  model: string | undefined;
  effort: ThinkingLevel;
}

/** A picker change: send `action` to the running Pi, or hold `held` until the next prompt. */
export type ModelChange =
  | { kind: "act"; action: SessionAction }
  | { kind: "hold"; held: HeldChoice };

/** The picker for one target, given what it holds. */
export interface ModelChoice extends ModelSelection {
  /** The start options the next prompt carries. */
  start: StartOptions;
  chooseModel: (model: string) => ModelChange;
  chooseEffort: (level: ThinkingLevel) => ModelChange;
  /**
   * Hands the start options to `send`, which reports whether it consumed the input they travel
   * with. Returns what to hold next: nothing picked once a prompt carried the pick, else the pick.
   */
  submit: (send: (start: StartOptions) => boolean) => HeldChoice;
}

/**
 * A pick belongs to one session in one hosting state, or to the New page's directory. Hosting
 * starting or stopping is a new scope, so a pick never crosses between Pi's own selection and a
 * saved one; reconnecting keeps the scope.
 */
const scopeOf = (target: ModelTarget): string =>
  target.kind === "new"
    ? `new\0${target.cwd}`
    : `session\0${target.cwd}\0${target.sessionId}\0${target.hosted}`;

/** Nothing picked for `target`. */
export const emptyChoice = (target: ModelTarget): HeldChoice => ({
  scope: scopeOf(target),
  pick: {},
});

/**
 * The picker for `target`, given what it holds; a pick made for another target is dropped. While
 * the session cannot take input (`ready` false), or once anything is picked, a session counts as
 * unhosted: the choice stays local through reconnect and travels in the next prompt's start
 * options, which the server applies before submitting, whether that prompt starts Pi or finds it
 * already running, instead of a set_model racing reconnect.
 */
export function modelChoice(
  held: HeldChoice,
  catalog: ModelCatalog | null,
  target: ModelTarget,
  ready = true,
): ModelChoice {
  const scope = scopeOf(target);
  const pick = held.scope === scope ? held.pick : {};
  const local = !ready || pick.model !== undefined || pick.thinkingLevel !== undefined;
  const effective = local && target.kind === "session" ? { ...target, hosted: false } : target;
  const change = (next: ModelPick, action: SessionAction): ModelChange =>
    effective.kind === "session" && effective.hosted
      ? { kind: "act", action }
      : { kind: "hold", held: { scope, pick: next } };
  const start = startOptions(catalog, effective, pick);
  return {
    ...selectModel(catalog, effective, pick),
    start,
    chooseModel: (model) => change({ ...pick, model }, { _tag: "set_model", model }),
    chooseEffort: (level) =>
      change({ ...pick, thinkingLevel: level }, { _tag: "set_thinking_level", level }),
    submit: (send) => (send(start) ? { scope, pick: {} } : held),
  };
}

/** Efforts a model accepts, from Pi's catalog; every level while the model is unknown. */
export function levelsFor(
  catalog: ModelCatalog | null,
  model: string | undefined,
): ThinkingLevel[] {
  const m = catalog?.models.find((x) => x.ref === model);
  return m ? [...m.thinkingLevels] : ALL;
}

/** The wanted level if the model accepts it, else the nearest lower one, else the lowest it has. */
export function clampEffort(levels: ThinkingLevel[], wanted: ThinkingLevel): ThinkingLevel {
  if (levels.includes(wanted)) return wanted;
  const below = ALL.slice(0, ALL.indexOf(wanted)).filter((l) => levels.includes(l));
  return below[below.length - 1] ?? levels[0] ?? "off";
}

const level = (value: string | undefined): ThinkingLevel | undefined =>
  ALL.includes(value as ThinkingLevel) ? (value as ThinkingLevel) : undefined;

/** A picked model counts while the catalog still lists it, or while the catalog is unknown. */
const pickedModel = (catalog: ModelCatalog | null, pick: ModelPick) =>
  pick.model && (!catalog || catalog.models.some((m) => m.ref === pick.model))
    ? pick.model
    : undefined;

/**
 * The picker's model and effort. A hosted session shows Pi's own selection; otherwise the user's
 * pick, then the session's recorded selection, then Pi's defaults. Effort is clamped to what the
 * shown model accepts, so switching models re-clamps it while the pick keeps the wanted level.
 */
function selectModel(
  catalog: ModelCatalog | null,
  target: ModelTarget,
  pick: ModelPick,
): ModelSelection {
  const defaultEffort = level(catalog?.defaultThinkingLevel) ?? "medium";
  if (target.kind === "session" && target.hosted) {
    const model = target.model || catalog?.defaultModel;
    return {
      model,
      effort: level(target.thinkingLevel) ?? clampEffort(levelsFor(catalog, model), defaultEffort),
    };
  }
  const recorded: { model?: string; thinkingLevel?: string } =
    target.kind === "session" ? target : {};
  const model = pickedModel(catalog, pick) || recorded.model || catalog?.defaultModel;
  const wanted = pick.thinkingLevel ?? level(recorded.thinkingLevel) ?? defaultEffort;
  return { model, effort: clampEffort(levelsFor(catalog, model), wanted) };
}

/**
 * The start options the next prompt carries. A new session starts with exactly what the picker
 * shows. Continuing a saved session lets Pi restore its own selection, overridden only by the
 * user's deliberate picks; a hosted session is already running and takes none.
 */
function startOptions(
  catalog: ModelCatalog | null,
  target: ModelTarget,
  pick: ModelPick,
): StartOptions {
  const shown = selectModel(catalog, target, pick);
  if (target.kind === "new") return { model: shown.model, thinkingLevel: shown.effort };
  if (target.hosted) return {};
  const model = pickedModel(catalog, pick);
  return {
    ...(model ? { model } : {}),
    ...(pick.thinkingLevel ? { thinkingLevel: shown.effort } : {}),
  };
}
