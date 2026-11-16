import { Schema } from "effect";
import { draftFields, proposalFields } from "./drafts.ts";

export const UserSkill = Schema.Struct({
  name: Schema.String,
  description: Schema.String,
  file: Schema.String,
  disableModelInvocation: Schema.Boolean,
});
export type UserSkill = typeof UserSkill.Type;

export const UserSkillCreate = Schema.Struct({
  ...draftFields,
  disableModelInvocation: Schema.optional(Schema.Boolean),
});
export type UserSkillCreate = typeof UserSkillCreate.Type;

export const UserSkillUpdate = Schema.Struct({
  ...UserSkillCreate.fields,
  previous: Schema.String,
});
export type UserSkillUpdate = typeof UserSkillUpdate.Type;

export const UserSkillProposal = Schema.Struct({
  ...proposalFields,
  disableModelInvocation: Schema.Boolean,
});
export type UserSkillProposal = typeof UserSkillProposal.Type;
