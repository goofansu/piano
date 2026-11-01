/**
 * Prompts created in Piano: Pi prompt templates kept in Piano's own folder, which every Pi child
 * Piano starts loads with `--prompt-template`. Settings lists only these; Pi's own prompt folders
 * stay Pi's (the composer still offers every template Pi loads).
 */
import { Schema } from "effect";

/** The command name: the file's name without `.md`, typed after `/` in the composer. */
export const PROMPT_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
/** The longest prompt body Piano saves, in characters. */
export const PROMPT_BODY_MAX = 64 * 1024;

/** A prompt as Pi reads it: its command name, description and argument hint. */
export const Prompt = Schema.Struct({
  name: Schema.String,
  /** The front matter's description or, as Pi falls back, the body's first non-empty line. */
  description: Schema.String,
  argumentHint: Schema.optional(Schema.String),
});
export type Prompt = typeof Prompt.Type;

export const PromptCreate = Schema.Struct({
  name: Schema.String.check(Schema.isMaxLength(64)),
  description: Schema.optional(Schema.String.check(Schema.isMaxLength(1000))),
  argumentHint: Schema.optional(Schema.String.check(Schema.isMaxLength(200))),
  body: Schema.String.check(Schema.isMaxLength(PROMPT_BODY_MAX)),
});
export type PromptCreate = typeof PromptCreate.Type;

/** The editor fields a refusal can name. */
export const PROMPT_FIELDS = ["name", "body"] as const;
export type PromptField = (typeof PROMPT_FIELDS)[number];
