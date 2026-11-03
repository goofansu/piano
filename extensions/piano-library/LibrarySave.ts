/**
 * One save of a skill or a prompt, as the browser's Settings page saves it: Piano's proposal first
 * (the file it would write, or the refusal the save would get), then the user's decision, then
 * Piano's own HTTP endpoints. Nothing is written without the user's
 * Save, and a cancellation or a stop writes nothing (INV-04, INV-11). No Pi here: the extension
 * supplies the dialog and the request, so a test supplies them too.
 */
import { DRAFT_FIELDS, isName, NAME_RULE } from "../../shared/drafts.ts";
import { type Endpoint, Endpoints, readRefusal } from "../../shared/http.ts";
import {
  LIBRARY_REACH,
  type LibraryChange,
  type LibraryKind,
  type LibraryProposal,
  type LibraryResult,
  proposalDialog,
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
    propose: Endpoints.proposeUserSkill,
    create: Endpoints.createUserSkill,
    update: Endpoints.updateUserSkill,
  },
  prompt: {
    list: Endpoints.prompts,
    propose: Endpoints.proposePrompt,
    create: Endpoints.createPrompt,
    update: Endpoints.updatePrompt,
  },
} satisfies Record<LibraryKind, Record<"list" | "propose" | "create" | "update", Endpoint>>;

interface Saved {
  name: string;
  file: string;
  disableModelInvocation?: boolean;
}

/** What Piano answers a proposal with (`UserSkillProposal`, `PromptProposal`). */
interface Planned {
  change: LibraryChange;
  name: string;
  file: string;
  previous?: string;
}

/** A refusal's sentence, as the Settings page reads it from the server's answer. */
async function refusal(response: Response, fallback: string) {
  const { error, field } = readRefusal(await response.json().catch(() => undefined), fallback);
  return { detail: error, field };
}

/** The save tool's result for a refused request, with its draft field when it names one. */
async function refusedBy(
  kind: LibraryKind,
  name: string,
  response: Response,
  endpoint: Endpoint,
): Promise<LibraryResult> {
  const fallback = typeof endpoint.fallback === "string" ? endpoint.fallback : "Could not save.";
  const { detail, field } = await refusal(response, fallback);
  const known = DRAFT_FIELDS.find((draftField) => draftField === field);
  return known
    ? { status: "refused", kind, name, field: known, detail }
    : { status: "refused", kind, name, detail };
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
  // Piano says what the save would write, or refuses it as the save would, before anything is
  // asked: the user is never asked to approve a save Piano would refuse.
  const proposed = await deps.request(endpoints.propose.path, {
    method: endpoints.propose.method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(draft),
    signal,
  });
  if (!proposed.ok) return refusedBy(kind, name, proposed, endpoints.propose);
  const planned = (await proposed.json()) as Planned;
  const proposal: LibraryProposal =
    planned.change === "update" && planned.previous !== undefined
      ? {
          kind,
          change: "update",
          name: planned.name,
          file: planned.file,
          previous: planned.previous,
        }
      : { kind, change: "create", name: planned.name, file: planned.file };

  if (signal?.aborted) return { status: "cancelled", kind, name: proposal.name };
  const dialog = proposalDialog(proposal);
  const approved = await deps.confirm(dialog.title, dialog.message, signal);
  // A reply racing a stop is never taken as approval.
  if (!approved || signal?.aborted) return { status: "cancelled", kind, name: proposal.name };

  const endpoint = proposal.change === "update" ? endpoints.update : endpoints.create;
  // The draft the proposal was made from: Piano writes the file it proposed, settings kept.
  const saved = {
    name: proposal.name,
    description: draft.description,
    instructions: draft.instructions,
    ...(kind === "skill" && draft.disableModelInvocation !== undefined
      ? { disableModelInvocation: draft.disableModelInvocation }
      : {}),
  };
  // An update replaces only the file the user approved a change to: one changed since is refused.
  const body = proposal.previous !== undefined ? { ...saved, previous: proposal.previous } : saved;
  // Once approved, the save is not abandoned half-way: the user's Save is carried out.
  const response = await deps.request(endpoint.path, {
    method: endpoint.method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) return refusedBy(kind, proposal.name, response, endpoint);
  const written = (await response.json()) as Saved;
  return {
    status: "saved",
    kind,
    change: proposal.change,
    name: proposal.name,
    file: written.file,
    reach: `${LIBRARY_REACH}. Running sessions, this one included, load it when their Pi next starts.`,
  };
}
