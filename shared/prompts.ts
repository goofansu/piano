/**
 * Prompts created in Piano: Pi prompt templates kept in Piano's own folder, which every Pi child
 * Piano starts loads with `--prompt-template`. Settings lists only these; Pi's own prompt folders
 * stay Pi's (the composer still offers every template Pi loads). A new prompt follows the draft
 * rule a skill does (`checkDraft` in `drafts.ts`).
 */
import { Schema } from "effect";
import { draftFields } from "./drafts.ts";

/** A prompt as Pi reads it: its command name and description. */
export const Prompt = Schema.Struct({
  name: Schema.String,
  /** The front matter's description or, as Pi falls back, the body's first non-empty line cut at 60 characters. */
  description: Schema.String,
  /** The template file exactly as saved, front matter included: View shows and copies it. */
  file: Schema.String,
});
export type Prompt = typeof Prompt.Type;

export const PromptCreate = Schema.Struct(draftFields);
export type PromptCreate = typeof PromptCreate.Type;
