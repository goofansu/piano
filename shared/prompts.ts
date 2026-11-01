/**
 * Prompts created in Piano: Pi prompt templates kept in Piano's own folder, which every Pi child
 * Piano starts loads with `--prompt-template`. Settings lists only these; Pi's own prompt folders
 * stay Pi's (the composer still offers every template Pi loads).
 */
import { Schema } from "effect";
import { checkDraft, type FieldCheck, REQUEST_FIELD_MAX } from "./drafts.ts";

/** A prompt as Pi reads it: its command name, description and argument hint. */
export const Prompt = Schema.Struct({
  name: Schema.String,
  /** The front matter's description or, as Pi falls back, the body's first non-empty line cut at 60 characters. */
  description: Schema.String,
  argumentHint: Schema.optional(Schema.String),
  /** The template file exactly as saved, front matter included: View shows and copies it. */
  file: Schema.String,
});
export type Prompt = typeof Prompt.Type;

export const PROMPT_ARGUMENT_HINT_MAX = 200;

export const PromptCreate = Schema.Struct({
  name: Schema.String.check(Schema.isMaxLength(REQUEST_FIELD_MAX)),
  description: Schema.optional(Schema.String.check(Schema.isMaxLength(REQUEST_FIELD_MAX))),
  argumentHint: Schema.optional(Schema.String.check(Schema.isMaxLength(REQUEST_FIELD_MAX))),
  body: Schema.String.check(Schema.isMaxLength(REQUEST_FIELD_MAX)),
});
export type PromptCreate = typeof PromptCreate.Type;

/** The editor fields a refused create can belong to; a refusal without one is about the create as a whole. */
export const PROMPT_FIELDS = ["name", "description", "argumentHint", "body"] as const;
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

/** The shared draft rule (`checkDraft`) with the description optional, plus the argument hint. */
export function checkPromptDraft(draft: PromptCreate): PromptDraftCheck {
  const check = checkDraft(
    { name: draft.name, description: draft.description ?? "", text: draft.body },
    { textLabel: "the prompt", descriptionOptional: true },
  );
  const hint = draft.argumentHint?.trim() ?? "";
  const argumentHint: FieldCheck = {
    length: hint.length,
    max: PROMPT_ARGUMENT_HINT_MAX,
    over: hint.length > PROMPT_ARGUMENT_HINT_MAX,
  };
  const problem: PromptDraftCheck["problem"] = check.problem
    ? { ...check.problem, field: check.problem.field === "text" ? "body" : check.problem.field }
    : argumentHint.over
      ? {
          field: "argumentHint",
          detail: `Keep it to ${PROMPT_ARGUMENT_HINT_MAX.toLocaleString("en")} characters.`,
        }
      : undefined;
  const { trimmed } = check;
  return {
    name: check.name,
    description: check.description,
    argumentHint,
    body: check.text,
    malformedName: check.malformedName,
    problem,
    saved: problem
      ? undefined
      : {
          name: trimmed.name,
          body: trimmed.text,
          ...(trimmed.description ? { description: trimmed.description } : {}),
          ...(hint ? { argumentHint: hint } : {}),
        },
  };
}
