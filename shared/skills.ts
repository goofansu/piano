import { Schema } from "effect";

/** The Agent Skills name rule Pi checks: lowercase letters, digits and single hyphens between them. */
export const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SKILL_NAME_MAX = 64;
export const SKILL_DESCRIPTION_MAX = 1024;
/** Bounds one request, not a rule of the format: a skill's body is read only when Pi loads it. */
export const SKILL_INSTRUCTIONS_MAX = 100_000;

/** A skill Piano created in the user's skills directory, as Settings › Skills lists it. */
export const UserSkill = Schema.Struct({
  name: Schema.String,
  description: Schema.String,
});
export type UserSkill = typeof UserSkill.Type;

export const UserSkillCreate = Schema.Struct({
  name: Schema.String.check(Schema.isMaxLength(SKILL_NAME_MAX)),
  description: Schema.String.check(Schema.isMaxLength(SKILL_DESCRIPTION_MAX)),
  instructions: Schema.String.check(Schema.isMaxLength(SKILL_INSTRUCTIONS_MAX)),
});
export type UserSkillCreate = typeof UserSkillCreate.Type;

/** The editor fields a refused create can belong to; a refusal without one is about the create as a whole. */
export const USER_SKILL_FIELDS = ["name", "description", "instructions"] as const;
export type UserSkillField = (typeof USER_SKILL_FIELDS)[number];
