import { Schema } from "effect";
import { checkDraft, type FieldCheck, REQUEST_FIELD_MAX } from "./drafts.ts";

/** The editor fields a refused create can belong to; a refusal without one is about the create as a whole. */
export const USER_SKILL_FIELDS = ["name", "description", "instructions"] as const;
export type UserSkillField = (typeof USER_SKILL_FIELDS)[number];

/** A skill created in Piano, as Settings › Skills lists it. */
export const UserSkill = Schema.Struct({
  name: Schema.String,
  description: Schema.String,
  /** SKILL.md exactly as saved, front matter included: View shows and copies it. */
  file: Schema.String,
  /** `disable-model-invocation`: Pi loads the skill only for `/skill:<name>`, never on its own. */
  disableModelInvocation: Schema.Boolean,
});
export type UserSkill = typeof UserSkill.Type;

export const UserSkillCreate = Schema.Struct({
  name: Schema.String.check(Schema.isMaxLength(REQUEST_FIELD_MAX)),
  description: Schema.String.check(Schema.isMaxLength(REQUEST_FIELD_MAX)),
  instructions: Schema.String.check(Schema.isMaxLength(REQUEST_FIELD_MAX)),
  disableModelInvocation: Schema.optional(Schema.Boolean),
});
export type UserSkillCreate = typeof UserSkillCreate.Type;

/** What `checkSkillDraft` decides: each field against its limit, and what creating it saves. */
export interface SkillDraftCheck extends Record<UserSkillField, FieldCheck> {
  /** The name is filled but breaks the name rule. */
  malformedName: boolean;
  /** The first field the server refuses, with what it says. */
  problem: { field: UserSkillField; detail: string } | undefined;
  /** The trimmed draft, when it can be saved. */
  saved: Required<UserSkillCreate> | undefined;
}

/** The shared draft rule (`checkDraft`), every field required. */
export function checkSkillDraft(draft: UserSkillCreate): SkillDraftCheck {
  const check = checkDraft(
    { name: draft.name, description: draft.description, text: draft.instructions },
    { textLabel: "instructions" },
  );
  const { trimmed, problem } = check;
  return {
    name: check.name,
    description: check.description,
    instructions: check.text,
    malformedName: check.malformedName,
    problem: problem && {
      ...problem,
      field: problem.field === "text" ? "instructions" : problem.field,
    },
    saved: problem
      ? undefined
      : {
          name: trimmed.name,
          description: trimmed.description,
          instructions: trimmed.text,
          disableModelInvocation: draft.disableModelInvocation === true,
        },
  };
}
