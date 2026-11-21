export const DRAFT_FIELDS = ["name", "description", "instructions"] as const;
export type DraftField = (typeof DRAFT_FIELDS)[number];

export const SAVE_SKILL_TOOL = "piano_save_skill";
export const SAVE_PROMPT_TOOL = "piano_save_prompt";

export type LibraryKind = "skill" | "prompt";
export type LibraryChange = "create" | "update";

export interface LibraryKindWords {
  readonly kind: LibraryKind;
  readonly Noun: string;
  readonly fileLabel: string;
}

export const LIBRARY_KINDS = {
  skill: { kind: "skill", Noun: "Skill", fileLabel: "SKILL.md" },
  prompt: { kind: "prompt", Noun: "Prompt", fileLabel: "file" },
} as const satisfies { readonly [K in LibraryKind]: LibraryKindWords & { readonly kind: K } };

export const libraryKindOf = (tool: string): LibraryKind | undefined =>
  tool === SAVE_SKILL_TOOL ? "skill" : tool === SAVE_PROMPT_TOOL ? "prompt" : undefined;

export interface LibraryProposal {
  readonly kind: LibraryKind;
  readonly change: LibraryChange;
  readonly name: string;
  readonly file: string;
  readonly previous?: string;
}

export const proposalTitle = ({
  kind,
  change,
  name,
}: Pick<LibraryProposal, "kind" | "change" | "name">) =>
  `${change === "create" ? "New" : "Update"} ${kind}: ${name}`;

const PROPOSAL = "piano.library-proposal";

export const proposalDialog = (proposal: LibraryProposal) => ({
  title: proposalTitle(proposal),
  message: JSON.stringify({ type: PROPOSAL, ...proposal }),
});

const recordOf = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

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

export const LIBRARY_REACH = "In sessions started from now";

export type LibraryResult =
  | {
      readonly status: "saved";
      readonly kind: LibraryKind;
      readonly change: LibraryChange;
      readonly name: string;
      readonly file: string;
      readonly reach: string;
    }
  | { readonly status: "cancelled"; readonly kind: LibraryKind; readonly name: string }
  | {
      readonly status: "refused";
      readonly kind: LibraryKind;
      readonly name: string;
      readonly field?: DraftField;
      readonly detail: string;
    };

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
