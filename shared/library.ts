/**
 * Piano's two save tools as both ends read them: `piano-library` (the bundled extension) asks the
 * user through a Pi `confirm` dialog whose title and message this module writes, and the browser
 * tells that dialog from any other one by the same functions, as it does `ask_user`'s
 * (`askUser.ts`). The result the tool returns, which Pi stores, is read here too, for the
 * transcript row and the toast. The file a save writes is spelled here once, so the proposal shows
 * exactly what the server saves (`UserSkills`, `Prompts`).
 */
import { DRAFT_FIELDS, type Draft, type DraftField } from "./drafts.ts";

export const SAVE_SKILL_TOOL = "piano_save_skill";
export const SAVE_PROMPT_TOOL = "piano_save_prompt";

export type LibraryKind = "skill" | "prompt";
/** Whether a save makes a new skill or prompt or replaces one Piano created. */
export type LibraryChange = "create" | "update";

export const libraryKindOf = (tool: string): LibraryKind | undefined =>
  tool === SAVE_SKILL_TOOL ? "skill" : tool === SAVE_PROMPT_TOOL ? "prompt" : undefined;

/** A skill's trimmed draft and its one flag, as `skillFile` writes it. */
export interface SkillDraft extends Draft {
  disableModelInvocation: boolean;
}

/**
 * A skill's SKILL.md. Double-quoted YAML scalars accept JSON string syntax, so the name and
 * description stay strings: unquoted, a name such as `123` or `true` would read back as a number
 * or a boolean.
 */
export const skillFile = ({
  name,
  description,
  instructions,
  disableModelInvocation,
}: SkillDraft) =>
  [
    "---",
    `name: ${JSON.stringify(name)}`,
    `description: ${JSON.stringify(description)}`,
    // Pi's default is to let the model load the skill, so only the exception is written.
    ...(disableModelInvocation ? ["disable-model-invocation: true"] : []),
    "---",
    "",
    `${instructions.trimEnd()}\n`,
  ].join("\n");

/** A prompt template: front matter (JSON strings are YAML strings), then the instructions. A prompt
 * always has a description, so the front matter is never empty and instructions starting with `---`
 * stay the instructions. */
export const promptFile = ({
  description,
  instructions,
}: Pick<Draft, "description" | "instructions">) =>
  [
    "---",
    `description: ${JSON.stringify(description.trim())}`,
    "---",
    `${instructions.trim()}\n`,
  ].join("\n");

/** What the proposal card shows: the file as it would be saved and, for an update, the file it
 * replaces. */
export interface LibraryProposal {
  readonly kind: LibraryKind;
  readonly change: LibraryChange;
  readonly name: string;
  readonly file: string;
  /** The file saved now; present exactly for an update. */
  readonly previous?: string;
}

/** "New skill: name", "Update prompt: name": the dialog's title and the card's. */
export const proposalTitle = ({
  kind,
  change,
  name,
}: Pick<LibraryProposal, "kind" | "change" | "name">) =>
  `${change === "create" ? "New" : "Update"} ${kind}: ${name}`;

const PROPOSAL = "piano.library-proposal";

/** The dialog the tool raises: Pi's `confirm`, the proposal as JSON in its message. */
export const proposalDialog = (proposal: LibraryProposal) => ({
  title: proposalTitle(proposal),
  message: JSON.stringify({ type: PROPOSAL, ...proposal }),
});

const recordOf = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

/** The proposal a dialog carries; undefined for any dialog `proposalDialog` did not write. */
export function readProposal(dialog: {
  method: string;
  title?: string;
  message?: string;
}): LibraryProposal | undefined {
  if (dialog.method !== "confirm" || !dialog.message) return;
  let fields: Record<string, unknown> | undefined;
  try {
    fields = recordOf(JSON.parse(dialog.message));
  } catch {
    return;
  }
  if (!fields || fields.type !== PROPOSAL) return;
  const { kind, change, name, file, previous } = fields;
  if (kind !== "skill" && kind !== "prompt") return;
  if (change !== "create" && change !== "update") return;
  if (typeof name !== "string" || typeof file !== "string") return;
  if (change === "update" ? typeof previous !== "string" : previous !== undefined) return;
  const proposal: LibraryProposal =
    change === "update"
      ? { kind, change, name, file, previous: previous as string }
      : { kind, change, name, file };
  if (dialog.title !== proposalTitle(proposal)) return;
  return proposal;
}

/** Where a saved skill or prompt applies, as the row's Details say it. */
export const LIBRARY_REACH = "In sessions started from now";

/** What a save tool returns, which Pi stores as the call's result. */
export type LibraryResult =
  | {
      readonly status: "saved";
      readonly kind: LibraryKind;
      readonly change: LibraryChange;
      readonly name: string;
      /** The file as saved, which View shows. */
      readonly file: string;
      /** Where it applies, for the agent to relay. */
      readonly reach: string;
    }
  | { readonly status: "cancelled"; readonly kind: LibraryKind; readonly name: string }
  | {
      readonly status: "refused";
      readonly kind: LibraryKind;
      readonly name: string;
      /** The draft field the refusal belongs to; absent for one about the save as a whole. */
      readonly field?: DraftField;
      /** The sentence Settings shows for the same refusal. */
      readonly detail: string;
    };

/** A stored result; undefined unless it is one a save tool returns. */
export function libraryResult(value: unknown): LibraryResult | undefined {
  const result = recordOf(value);
  if (!result) return;
  const { status, kind, name } = result;
  if ((kind !== "skill" && kind !== "prompt") || typeof name !== "string") return;
  if (status === "cancelled") return { status, kind, name };
  if (status === "saved") {
    const { change, file, reach } = result;
    if (change !== "create" && change !== "update") return;
    if (typeof file !== "string" || typeof reach !== "string") return;
    return { status, kind, change, name, file, reach };
  }
  if (status === "refused" && typeof result.detail === "string") {
    const field = DRAFT_FIELDS.find((known) => known === result.field);
    return field
      ? { status, kind, name, field, detail: result.detail }
      : { status, kind, name, detail: result.detail };
  }
  return;
}

/** The result of a finished save call, from its tool name and its output text (JSON). */
export function storedLibraryResult(tool: string, output: string | undefined) {
  const kind = libraryKindOf(tool);
  if (!kind || !output) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    return;
  }
  const result = libraryResult(parsed);
  return result?.kind === kind ? result : undefined;
}

/** The toast a save ends with, as the Settings page says it for the same change. */
export const savedToast = (kind: LibraryKind, change: LibraryChange) =>
  `${kind === "skill" ? "Skill" : "Prompt"} ${change === "create" ? "created" : "saved"}`;
