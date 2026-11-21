import { Schema } from "effect";
import { DRAFT_FIELDS, type DraftField } from "../../../shared/session/libraryTools.ts";

export const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const NAME_MAX = 64;
export const NAME_RULE =
  "Use lowercase letters, numbers and single hyphens, not at the start or end.";
export const DESCRIPTION_MAX = 1024;
export const TEXT_MAX = 20_000;
export const REQUEST_FIELD_MAX = 2 * TEXT_MAX;

export const isName = (name: string) => name.length <= NAME_MAX && NAME.test(name);

export const draftFields = {
  name: Schema.String.check(Schema.isMaxLength(REQUEST_FIELD_MAX)),
  description: Schema.String.check(Schema.isMaxLength(REQUEST_FIELD_MAX)),
  instructions: Schema.String.check(Schema.isMaxLength(REQUEST_FIELD_MAX)),
};
export type Draft = Record<DraftField, string>;

export const proposalFields = {
  change: Schema.Literals(["create", "update"]),
  name: Schema.String,
  file: Schema.String,
  previous: Schema.optional(Schema.String),
};

export interface FieldCheck {
  length: number;
  max: number;
  over: boolean;
}

export interface DraftCheck extends Record<DraftField, FieldCheck> {
  malformedName: boolean;
  problem: { field: DraftField; detail: string } | undefined;
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
