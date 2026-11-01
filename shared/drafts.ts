/**
 * The one rule a skill and a prompt created in Piano share: a name in the Agent Skills form, a
 * description and instructions, each trimmed and within its limit. The New skill and New prompt
 * dialogs enable Create by this check, and the server refuses by it; only whether a name is free is
 * left to the server.
 */
import { Schema } from "effect";

/** The Agent Skills name rule Pi checks: lowercase letters, digits and single hyphens between them. */
export const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const NAME_MAX = 64;
/** Why a name breaks `NAME`, as both dialogs and the server say it. */
export const NAME_RULE =
  "Use lowercase letters, numbers and single hyphens, not at the start or end.";
export const DESCRIPTION_MAX = 1024;
/** As project instructions: the instructions are read whole each time Pi loads them. */
export const TEXT_MAX = 20_000;
/** Bounds one request's raw fields; `checkDraft` applies each field's limit to its trimmed text. */
export const REQUEST_FIELD_MAX = 2 * TEXT_MAX;

/** A name Piano can save, and so the only names a delete may reach: it keeps a path in its folder. */
export const isName = (name: string) => name.length <= NAME_MAX && NAME.test(name);

/** The editor fields a refused create can belong to; a refusal without one is about the create as a whole. */
export const DRAFT_FIELDS = ["name", "description", "instructions"] as const;
export type DraftField = (typeof DRAFT_FIELDS)[number];

/** A create request's draft fields, as both the skill and the prompt create carry them. */
export const draftFields = {
  name: Schema.String.check(Schema.isMaxLength(REQUEST_FIELD_MAX)),
  description: Schema.String.check(Schema.isMaxLength(REQUEST_FIELD_MAX)),
  instructions: Schema.String.check(Schema.isMaxLength(REQUEST_FIELD_MAX)),
};
export type Draft = Record<DraftField, string>;

export interface FieldCheck {
  length: number;
  max: number;
  over: boolean;
}

/** What `checkDraft` decides: each field against its limit, and what creating it saves. */
export interface DraftCheck extends Record<DraftField, FieldCheck> {
  /** The name is filled but breaks `NAME`. */
  malformedName: boolean;
  /** The first field the server refuses, with what it says; none when the draft can be saved. */
  problem: { field: DraftField; detail: string } | undefined;
  /** The trimmed draft, when it can be saved. */
  saved: Draft | undefined;
}

const MAX: Record<DraftField, number> = {
  name: NAME_MAX,
  description: DESCRIPTION_MAX,
  instructions: TEXT_MAX,
};

const MISSING: Record<DraftField, string> = {
  name: "Enter a name.",
  description: "Enter a description.",
  instructions: "Enter instructions.",
};

const fieldCheck = (saved: string, max: number): FieldCheck => ({
  length: saved.length,
  max,
  over: saved.length > max,
});

export function checkDraft(draft: Draft): DraftCheck {
  const trimmed: Draft = {
    name: draft.name.trim(),
    description: draft.description.trim(),
    instructions: draft.instructions.trim(),
  };
  const checks = {
    name: fieldCheck(trimmed.name, MAX.name),
    description: fieldCheck(trimmed.description, MAX.description),
    instructions: fieldCheck(trimmed.instructions, MAX.instructions),
  };
  const malformedName = !!trimmed.name && !NAME.test(trimmed.name);
  const problem = DRAFT_FIELDS.map((field) => {
    if (!trimmed[field]) return { field, detail: MISSING[field] };
    if (checks[field].over)
      return { field, detail: `Keep it to ${MAX[field].toLocaleString("en")} characters.` };
    if (field === "name" && malformedName) return { field, detail: NAME_RULE };
    return undefined;
  }).find((found) => !!found);
  return { ...checks, malformedName, problem, saved: problem ? undefined : trimmed };
}
