/**
 * Prompts created in Piano: Pi prompt templates kept in Piano's own folder, which every Pi child
 * Piano starts loads with `--prompt-template`. Settings lists only these; Pi's own prompt folders
 * stay Pi's (the composer still offers every template Pi loads).
 */
import { Schema } from "effect";
import { SKILL_DESCRIPTION_MAX, SKILL_NAME, SKILL_NAME_MAX, SKILL_NAME_RULE } from "./skills.ts";

/** The command name: the file's name without `.md`, typed after `/` in the composer. It follows a
 * skill's name rule and limit, as Settings › Skills checks them. */
export const PROMPT_NAME_MAX = SKILL_NAME_MAX;
export const PROMPT_NAME_RULE = SKILL_NAME_RULE;
export const isPromptName = (name: string) =>
  name.length <= PROMPT_NAME_MAX && SKILL_NAME.test(name);
/** A skill's description limit, in characters. */
export const PROMPT_DESCRIPTION_MAX = SKILL_DESCRIPTION_MAX;
/** The longest prompt Piano saves, in characters; Pi sets no limit. */
export const PROMPT_BODY_MAX = 20_000;

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

/** Bounds one request's raw fields; `checkPromptDraft` applies each field's limit to its trimmed text. */
const REQUEST_FIELD_MAX = 2 * PROMPT_BODY_MAX;
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

export interface PromptFieldCheck {
  length: number;
  max: number;
  over: boolean;
}

/** What `checkPromptDraft` decides: each field against its limit, and what creating it saves. */
export interface PromptDraftCheck extends Record<PromptField, PromptFieldCheck> {
  /** The name is filled but breaks the skill name rule. */
  malformedName: boolean;
  /** The trimmed draft, when the name and prompt are filled, every field is within its limit and
   * the name is well formed. */
  saved: PromptCreate | undefined;
}

const MAX: Record<PromptField, number> = {
  name: PROMPT_NAME_MAX,
  description: PROMPT_DESCRIPTION_MAX,
  argumentHint: PROMPT_ARGUMENT_HINT_MAX,
  body: PROMPT_BODY_MAX,
};

/**
 * The one rule for creating a prompt, as the New prompt dialog enables Create prompt and the server
 * accepts it: every field trimmed, the name and prompt filled, none over its limit, and the name in
 * a skill's form. Only whether the name is free is left to the server.
 */
export function checkPromptDraft(draft: PromptCreate): PromptDraftCheck {
  const trimmed: Record<PromptField, string> = {
    name: draft.name.trim(),
    description: draft.description?.trim() ?? "",
    argumentHint: draft.argumentHint?.trim() ?? "",
    body: draft.body.trim(),
  };
  const check = (field: PromptField): PromptFieldCheck => ({
    length: trimmed[field].length,
    max: MAX[field],
    over: trimmed[field].length > MAX[field],
  });
  const checks = {
    name: check("name"),
    description: check("description"),
    argumentHint: check("argumentHint"),
    body: check("body"),
  };
  const malformedName = !!trimmed.name && !isPromptName(trimmed.name);
  const savable =
    !malformedName &&
    !!trimmed.name &&
    !!trimmed.body &&
    PROMPT_FIELDS.every((field) => !checks[field].over);
  const saved = savable
    ? {
        name: trimmed.name,
        body: trimmed.body,
        ...(trimmed.description ? { description: trimmed.description } : {}),
        ...(trimmed.argumentHint ? { argumentHint: trimmed.argumentHint } : {}),
      }
    : undefined;
  return { ...checks, malformedName, saved };
}
