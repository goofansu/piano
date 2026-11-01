/**
 * Prompts created in Piano: Pi prompt templates kept in Piano's own folder, which every Pi child
 * Piano starts loads with `--prompt-template`. Settings lists only these; Pi's own prompt folders
 * stay Pi's (the composer still offers every template Pi loads).
 */
import { Schema } from "effect";
import { checkDraft, type FieldCheck, REQUEST_FIELD_MAX } from "./drafts.ts";

/** A prompt as Pi reads it: its command name and description. */
export const Prompt = Schema.Struct({
  name: Schema.String,
  /** The front matter's description or, as Pi falls back, the body's first non-empty line cut at 60 characters. */
  description: Schema.String,
  /** The template file exactly as saved, front matter included: View shows and copies it. */
  file: Schema.String,
});
export type Prompt = typeof Prompt.Type;

export const PromptCreate = Schema.Struct({
  name: Schema.String.check(Schema.isMaxLength(REQUEST_FIELD_MAX)),
  description: Schema.String.check(Schema.isMaxLength(REQUEST_FIELD_MAX)),
  instructions: Schema.String.check(Schema.isMaxLength(REQUEST_FIELD_MAX)),
});
export type PromptCreate = typeof PromptCreate.Type;

/** The editor fields a refused create can belong to; a refusal without one is about the create as a whole. */
export const PROMPT_FIELDS = ["name", "description", "instructions"] as const;
export type PromptField = (typeof PROMPT_FIELDS)[number];

/** What `checkPromptDraft` decides: each field against its limit, and what creating it saves. */
export interface PromptDraftCheck extends Record<PromptField, FieldCheck> {
  /** The name is filled but breaks the name rule. */
  malformedName: boolean;
  /** The first field the server refuses, with what it says. */
  problem: { field: PromptField; detail: string } | undefined;
  /** The trimmed draft, when it can be saved. */
  saved: PromptCreate | undefined;
}

/** The shared draft rule (`checkDraft`), with a prompt's field names. */
export function checkPromptDraft(draft: PromptCreate): PromptDraftCheck {
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
      : { name: trimmed.name, description: trimmed.description, instructions: trimmed.text },
  };
}
