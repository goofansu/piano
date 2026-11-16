import { Schema } from "effect";
import { draftFields, proposalFields } from "./drafts.ts";

export const Prompt = Schema.Struct({
  name: Schema.String,
  description: Schema.String,
  file: Schema.String,
});
export type Prompt = typeof Prompt.Type;

export const PromptCreate = Schema.Struct(draftFields);
export type PromptCreate = typeof PromptCreate.Type;

export const PromptUpdate = Schema.Struct({
  ...draftFields,
  previous: Schema.String,
});
export type PromptUpdate = typeof PromptUpdate.Type;

export const PromptProposal = Schema.Struct(proposalFields);
export type PromptProposal = typeof PromptProposal.Type;
