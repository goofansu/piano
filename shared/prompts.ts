/**
 * Prompts created in Piano: Pi prompt templates kept in Piano's own folder, which every Pi child
 * Piano starts loads with `--prompt-template`. Settings lists only these; Pi's own prompt folders
 * stay Pi's (the composer still offers every template Pi loads).
 */
import { Schema } from "effect";

/**
 * The command name: the file's name without `.md`, typed after `/` in the composer. A skill's name
 * rule: at most 64 lowercase letters, numbers and hyphens, not starting or ending with a hyphen.
 */
export const PROMPT_NAME = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
export const PROMPT_NAME_MAX = 64;
/** A skill's description limit, in characters. */
export const PROMPT_DESCRIPTION_MAX = 1024;
/** The longest prompt Piano saves, in characters; Pi sets no limit. */
export const PROMPT_BODY_MAX = 20_000;

/** A prompt as Pi reads it: its command name, description and argument hint. */
export const Prompt = Schema.Struct({
  name: Schema.String,
  /** The front matter's description or, as Pi falls back, the body's first non-empty line cut at 60 characters. */
  description: Schema.String,
  argumentHint: Schema.optional(Schema.String),
  /** The prompt itself, after the front matter, as Pi expands it. */
  body: Schema.String,
});
export type Prompt = typeof Prompt.Type;

export const PromptCreate = Schema.Struct({
  name: Schema.String.check(Schema.isMaxLength(PROMPT_NAME_MAX)),
  description: Schema.optional(Schema.String.check(Schema.isMaxLength(PROMPT_DESCRIPTION_MAX))),
  argumentHint: Schema.optional(Schema.String.check(Schema.isMaxLength(200))),
  body: Schema.String.check(Schema.isMaxLength(PROMPT_BODY_MAX)),
});
export type PromptCreate = typeof PromptCreate.Type;

/** The editor fields a refusal can name. */
export const PROMPT_FIELDS = ["name", "body"] as const;
export type PromptField = (typeof PROMPT_FIELDS)[number];
