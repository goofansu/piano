/**
 * One save of a skill or a prompt, as the browser's Settings page saves it: the draft rule first,
 * then the user's decision, then Piano's own HTTP endpoints. Nothing is written without the user's
 * Save, and a cancellation or a stop writes nothing (INV-04, INV-11). No Pi here: the extension
 * supplies the dialog and the request, so a test supplies them too.
 */
import { checkDraft, isName, NAME_RULE } from "../../shared/drafts.ts";
import { type Endpoint, Endpoints } from "../../shared/http.ts";
import {
  LIBRARY_REACH,
  type LibraryKind,
  type LibraryProposal,
  type LibraryResult,
  promptFile,
  proposalDialog,
  skillFile,
} from "../../shared/library.ts";

export interface LibraryDraft {
  name: string;
  description: string;
  instructions: string;
  /** Skills only; an update that omits it keeps the saved skill's. */
  disableModelInvocation?: boolean;
}

export interface LibraryDeps {
  /** A request to the Piano that started this Pi, with its Origin: a path and the request's init. */
  request: (path: string, init: RequestInit) => Promise<Response>;
  /** The user's decision on the proposal; true only for Save. */
  confirm: (title: string, message: string, signal: AbortSignal | undefined) => Promise<boolean>;
}

const ENDPOINTS = {
  skill: {
    list: Endpoints.userSkills,
    create: Endpoints.createUserSkill,
    update: Endpoints.updateUserSkill,
  },
  prompt: {
    list: Endpoints.prompts,
    create: Endpoints.createPrompt,
    update: Endpoints.updatePrompt,
  },
} satisfies Record<LibraryKind, Record<"list" | "create" | "update", Endpoint>>;

interface Saved {
  name: string;
  file: string;
  disableModelInvocation?: boolean;
}

/** A refusal's sentence, as the Settings page reads it from the server's answer. */
async function refusal(response: Response, fallback: string) {
  try {
    const body = (await response.json()) as { error?: unknown; field?: unknown };
    return {
      detail: typeof body.error === "string" && body.error ? body.error : fallback,
      field: typeof body.field === "string" ? body.field : undefined,
    };
  } catch {
    return { detail: fallback, field: undefined };
  }
}

/** Read only Piano's catalog, by name; never accept a filesystem path or search Pi's other resources. */
export async function readFromLibrary(
  kind: LibraryKind,
  name: string,
  request: LibraryDeps["request"],
  signal: AbortSignal | undefined,
) {
  if (!isName(name)) return { status: "refused" as const, kind, name, detail: NAME_RULE };
  const response = await request(ENDPOINTS[kind].list.path, { method: "GET", signal });
  if (!response.ok) throw new Error((await refusal(response, `Could not load ${kind}s.`)).detail);
  const existing = ((await response.json()) as (Saved & { description: string })[]).find(
    (item) => item.name === name,
  );
  if (!existing) return { status: "not_found" as const, kind, name };
  return {
    status: "found" as const,
    kind,
    name,
    description: existing.description,
    file: existing.file,
    ...(kind === "skill" ? { disableModelInvocation: existing.disableModelInvocation } : {}),
  };
}

export async function saveToLibrary(
  kind: LibraryKind,
  draft: LibraryDraft,
  deps: LibraryDeps,
  signal: AbortSignal | undefined,
): Promise<LibraryResult> {
  const endpoints = ENDPOINTS[kind];
  const name = draft.name.trim();
  // The rule Settings and the server apply, before anything is asked.
  const check = checkDraft(draft);
  if (!check.saved) {
    const problem = check.problem ?? { field: "name" as const, detail: "Could not save." };
    return { status: "refused", kind, name, field: problem.field, detail: problem.detail };
  }
  const saved = check.saved;
  const listed = await deps.request(endpoints.list.path, { method: "GET", signal });
  if (!listed.ok) throw new Error((await refusal(listed, `Could not load ${kind}s.`)).detail);
  const existing = ((await listed.json()) as Saved[]).find((item) => item.name === saved.name);
  const disableModelInvocation =
    draft.disableModelInvocation ?? existing?.disableModelInvocation ?? false;
  const file =
    kind === "skill" ? skillFile({ ...saved, disableModelInvocation }) : promptFile(saved);
  const proposal: LibraryProposal = existing
    ? { kind, change: "update", name: saved.name, file, previous: existing.file }
    : { kind, change: "create", name: saved.name, file };

  if (signal?.aborted) return { status: "cancelled", kind, name: saved.name };
  const dialog = proposalDialog(proposal);
  const approved = await deps.confirm(dialog.title, dialog.message, signal);
  // A reply racing a stop is never taken as approval.
  if (!approved || signal?.aborted) return { status: "cancelled", kind, name: saved.name };

  const endpoint = existing ? endpoints.update : endpoints.create;
  const body = kind === "skill" ? { ...saved, disableModelInvocation } : saved;
  // Once approved, the save is not abandoned half-way: the user's Save is carried out.
  const response = await deps.request(endpoint.path, {
    method: endpoint.method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const fallback = typeof endpoint.fallback === "string" ? endpoint.fallback : "Could not save.";
    const { detail, field } = await refusal(response, fallback);
    const known = field === "name" || field === "description" || field === "instructions";
    return known
      ? { status: "refused", kind, name: saved.name, field, detail }
      : { status: "refused", kind, name: saved.name, detail };
  }
  const written = (await response.json()) as Saved;
  return {
    status: "saved",
    kind,
    change: proposal.change,
    name: saved.name,
    file: written.file,
    reach: `${LIBRARY_REACH}. Running sessions, this one included, load it when their Pi next starts.`,
  };
}
