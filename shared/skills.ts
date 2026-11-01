import { Schema } from "effect";

/** The Agent Skills name rule Pi checks: lowercase letters, digits and single hyphens between them. */
export const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SKILL_NAME_MAX = 64;
/** Why a name breaks `SKILL_NAME`, as the New skill dialog and the server both say it. */
export const SKILL_NAME_RULE =
  "Use lowercase letters, numbers and single hyphens, not at the start or end.";
export const SKILL_DESCRIPTION_MAX = 1024;
/** As project instructions: a SKILL.md body is read whole each time Pi loads the skill. */
export const SKILL_INSTRUCTIONS_MAX = 20_000;
/** Bounds one request's raw fields; `checkSkillDraft` applies each field's limit to its trimmed text. */
const REQUEST_FIELD_MAX = 2 * SKILL_INSTRUCTIONS_MAX;

/** The editor fields a refused create can belong to; a refusal without one is about the create as a whole. */
export const USER_SKILL_FIELDS = ["name", "description", "instructions"] as const;
export type UserSkillField = (typeof USER_SKILL_FIELDS)[number];

/** A skill Piano created in the user's skills directory, as Settings › Skills lists it. */
export const UserSkill = Schema.Struct({
  name: Schema.String,
  description: Schema.String,
  /** The SKILL.md body, shown read-only for copying: Piano does not edit a skill. */
  instructions: Schema.String,
  /** `disable-model-invocation`: Pi loads the skill only for `/skill:<name>`, never on its own. */
  onlyWhenNamed: Schema.Boolean,
});
export type UserSkill = typeof UserSkill.Type;

export const UserSkillCreate = Schema.Struct({
  name: Schema.String.check(Schema.isMaxLength(REQUEST_FIELD_MAX)),
  description: Schema.String.check(Schema.isMaxLength(REQUEST_FIELD_MAX)),
  instructions: Schema.String.check(Schema.isMaxLength(REQUEST_FIELD_MAX)),
  onlyWhenNamed: Schema.optional(Schema.Boolean),
});
export type UserSkillCreate = typeof UserSkillCreate.Type;

export interface SkillFieldCheck {
  length: number;
  max: number;
  over: boolean;
}

/** What `checkSkillDraft` decides: each field against its limit, and what creating it saves. */
export interface SkillDraftCheck {
  name: SkillFieldCheck;
  description: SkillFieldCheck;
  instructions: SkillFieldCheck;
  /** The name is filled but breaks `SKILL_NAME`. */
  malformedName: boolean;
  /** The trimmed draft, when every field is filled and within its limit and the name is well formed. */
  saved: Required<UserSkillCreate> | undefined;
}

const fieldCheck = (saved: string, max: number): SkillFieldCheck => ({
  length: saved.length,
  max,
  over: saved.length > max,
});

/**
 * The one rule for creating a skill, as the New skill dialog enables Create skill and the server
 * accepts it: every field trimmed, none blank, none over its limit, and the name in Agent Skills
 * form. Only whether the name is free is left to the server.
 */
export function checkSkillDraft(draft: UserSkillCreate): SkillDraftCheck {
  const trimmed = {
    name: draft.name.trim(),
    description: draft.description.trim(),
    instructions: draft.instructions.trim(),
  };
  const checks = {
    name: fieldCheck(trimmed.name, SKILL_NAME_MAX),
    description: fieldCheck(trimmed.description, SKILL_DESCRIPTION_MAX),
    instructions: fieldCheck(trimmed.instructions, SKILL_INSTRUCTIONS_MAX),
  };
  const malformedName = !!trimmed.name && !SKILL_NAME.test(trimmed.name);
  const savable =
    !malformedName && USER_SKILL_FIELDS.every((field) => trimmed[field] && !checks[field].over);
  const saved = savable ? { ...trimmed, onlyWhenNamed: draft.onlyWhenNamed === true } : undefined;
  return { ...checks, malformedName, saved };
}
