import type { ModelCatalog, SessionAction, StartOptions, ThinkingLevel } from "@shared/wire";

const ALL: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

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

export interface ModelPick {
  model?: string;
  thinkingLevel?: ThinkingLevel;
}

export interface HeldChoice {
  readonly scope: string;
  readonly pick: ModelPick;
}

export interface ModelSelection {
  model: string | undefined;
  effort: ThinkingLevel;
}

export type ModelChange =
  | { kind: "act"; action: SessionAction }
  | { kind: "hold"; held: HeldChoice };

export interface ModelChoice extends ModelSelection {
  start: StartOptions;
  chooseModel: (model: string) => ModelChange;
  chooseEffort: (level: ThinkingLevel) => ModelChange;
  chooseDefaults: () => ModelChange[];
  submit: (send: (start: StartOptions) => boolean) => HeldChoice;
}

const scopeOf = (target: ModelTarget): string =>
  target.kind === "new"
    ? `new\0${target.cwd}`
    : `session\0${target.cwd}\0${target.sessionId}\0${target.hosted}`;

export const emptyChoice = (target: ModelTarget): HeldChoice => ({
  scope: scopeOf(target),
  pick: {},
});

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
    chooseDefaults: () => {
      const defaults = piDefaults(catalog);
      if (!defaults) return [];
      const { model, thinkingLevel } = defaults;
      return effective.kind === "session" && effective.hosted
        ? [
            { kind: "act", action: { _tag: "set_model", model } },
            { kind: "act", action: { _tag: "set_thinking_level", level: thinkingLevel } },
          ]
        : [change(defaults, { _tag: "set_model", model })];
    },
    submit: (send) => (send(start) ? { scope, pick: {} } : held),
  };
}

export function levelsFor(
  catalog: ModelCatalog | null,
  model: string | undefined,
): ThinkingLevel[] {
  const m = catalog?.models.find((x) => x.ref === model);
  return m ? [...m.thinkingLevels] : ALL;
}

export function clampEffort(levels: ThinkingLevel[], wanted: ThinkingLevel): ThinkingLevel {
  if (levels.includes(wanted)) return wanted;
  const below = ALL.slice(0, ALL.indexOf(wanted)).filter((l) => levels.includes(l));
  return below[below.length - 1] ?? levels[0] ?? "off";
}

export function piDefaults(
  catalog: ModelCatalog | null,
): { model: string; thinkingLevel: ThinkingLevel } | undefined {
  const model = catalog?.defaultModel;
  const wanted = level(catalog?.defaultThinkingLevel);
  if (!model || !wanted || !catalog.models.some((m) => m.ref === model)) return undefined;
  return { model, thinkingLevel: clampEffort(levelsFor(catalog, model), wanted) };
}

const level = (value: string | undefined): ThinkingLevel | undefined =>
  ALL.includes(value as ThinkingLevel) ? (value as ThinkingLevel) : undefined;

const pickedModel = (catalog: ModelCatalog | null, pick: ModelPick) =>
  pick.model && (!catalog || catalog.models.some((m) => m.ref === pick.model))
    ? pick.model
    : undefined;

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
