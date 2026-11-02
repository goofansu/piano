/** Skills created in Piano; a new one follows the draft rule a prompt does (`checkDraft` in `drafts.ts`). */
import { Schema } from "effect";
import { draftFields } from "./drafts.ts";

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
  ...draftFields,
  disableModelInvocation: Schema.optional(Schema.Boolean),
});
export type UserSkillCreate = typeof UserSkillCreate.Type;

/** An update: the new draft, and the SKILL.md it replaces as the person saw it. When `previous`
 * no longer matches the file on disk, the update is refused instead of overwriting a change the
 * person never saw; an update without it is invalid. */
export const UserSkillUpdate = Schema.Struct({
  ...UserSkillCreate.fields,
  previous: Schema.String,
});
export type UserSkillUpdate = typeof UserSkillUpdate.Type;

/** What saving a draft would do, before anyone is asked: make a new skill or replace the SKILL.md
 * of one Piano created (`previous`), and the file it would write. Disable model invocation is the
 * draft's, else the saved skill's. A draft the save would refuse gets the save's refusal instead. */
export const UserSkillProposal = Schema.Struct({
  change: Schema.Literals(["create", "update"]),
  name: Schema.String,
  file: Schema.String,
  previous: Schema.optional(Schema.String),
  disableModelInvocation: Schema.Boolean,
});
export type UserSkillProposal = typeof UserSkillProposal.Type;
