/**
 * The one rule a skill and a prompt created in Piano share: a name in the Agent Skills form, a
 * description and the text itself (a skill's instructions, a prompt's body), each trimmed and within
 * its limit. The New skill and New prompt dialogs enable
 * Create by this check, and the server refuses by it; only whether a name is free is left to the
 * server.
 */

/** The Agent Skills name rule Pi checks: lowercase letters, digits and single hyphens between them. */
export const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const NAME_MAX = 64;
/** Why a name breaks `NAME`, as both dialogs and the server say it. */
export const NAME_RULE =
  "Use lowercase letters, numbers and single hyphens, not at the start or end.";
export const DESCRIPTION_MAX = 1024;
/** As project instructions: the text is read whole each time Pi loads it. */
export const TEXT_MAX = 20_000;
/** Bounds one request's raw fields; `checkDraft` applies each field's limit to its trimmed text. */
export const REQUEST_FIELD_MAX = 2 * TEXT_MAX;

/** A name Piano can save, and so the only names a delete may reach: it keeps a path in its folder. */
export const isName = (name: string) => name.length <= NAME_MAX && NAME.test(name);

export type DraftField = "name" | "description" | "text";

export interface FieldCheck {
  length: number;
  max: number;
  over: boolean;
}

export interface DraftCheck {
  name: FieldCheck;
  description: FieldCheck;
  text: FieldCheck;
  /** The name is filled but breaks `NAME`. */
  malformedName: boolean;
  /** The first field the server refuses, with what it says; none when the draft can be saved. */
  problem: { field: DraftField; detail: string } | undefined;
  trimmed: Record<DraftField, string>;
}

const fieldCheck = (saved: string, max: number): FieldCheck => ({
  length: saved.length,
  max,
  over: saved.length > max,
});

export function checkDraft(
  draft: Record<DraftField, string>,
  options: {
    /** What a blank text is called in "Enter …": "instructions", "the prompt". */
    textLabel: string;
  },
): DraftCheck {
  const trimmed = {
    name: draft.name.trim(),
    description: draft.description.trim(),
    text: draft.text.trim(),
  };
  const checks = {
    name: fieldCheck(trimmed.name, NAME_MAX),
    description: fieldCheck(trimmed.description, DESCRIPTION_MAX),
    text: fieldCheck(trimmed.text, TEXT_MAX),
  };
  const malformedName = !!trimmed.name && !NAME.test(trimmed.name);
  const missing: Record<DraftField, string> = {
    name: "Enter a name.",
    description: "Enter a description.",
    text: `Enter ${options.textLabel}.`,
  };
  const problem = (["name", "description", "text"] as const)
    .map((field) => {
      if (!trimmed[field]) return { field, detail: missing[field] };
      if (checks[field].over)
        return {
          field,
          detail: `Keep it to ${checks[field].max.toLocaleString("en")} characters.`,
        };
      if (field === "name" && malformedName) return { field, detail: NAME_RULE };
      return undefined;
    })
    .find((found) => !!found);
  return { ...checks, malformedName, problem, trimmed };
}
