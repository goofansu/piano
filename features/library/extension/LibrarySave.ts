import { type Endpoint, readRefusal } from "../../../shared/endpoint.ts";
import { DRAFT_FIELDS } from "../../../shared/session/libraryTools.ts";
import {
  LIBRARY_REACH,
  type LibraryChange,
  type LibraryKind,
  type LibraryProposal,
  type LibraryResult,
  proposalDialog,
} from "../../../shared/session/libraryTools.ts";
import { isName, NAME_RULE } from "../contracts/drafts.ts";
import { libraryEndpoints } from "../contracts/http.ts";

export interface LibraryDraft {
  name: string;
  description: string;
  instructions: string;
  disableModelInvocation?: boolean;
}

export interface LibraryDeps {
  request: (path: string, init: RequestInit) => Promise<Response>;
  confirm: (title: string, message: string, signal: AbortSignal | undefined) => Promise<boolean>;
}

const ENDPOINTS = {
  skill: libraryEndpoints.skills,
  prompt: libraryEndpoints.prompts,
} satisfies Record<LibraryKind, Record<"list" | "propose" | "create" | "update", Endpoint>>;

interface Saved {
  name: string;
  file: string;
  disableModelInvocation?: boolean;
}

interface Planned {
  change: LibraryChange;
  name: string;
  file: string;
  previous?: string;
}

async function refusal(response: Response, fallback: string) {
  const { error, field } = readRefusal(await response.json().catch(() => undefined), fallback);
  return { detail: error, field };
}

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
  if (!approved || signal?.aborted) return { status: "cancelled", kind, name: proposal.name };

  const endpoint = proposal.change === "update" ? endpoints.update : endpoints.create;
  const saved = {
    name: proposal.name,
    description: draft.description,
    instructions: draft.instructions,
    ...(kind === "skill" && draft.disableModelInvocation !== undefined
      ? { disableModelInvocation: draft.disableModelInvocation }
      : {}),
  };
  const body = proposal.previous !== undefined ? { ...saved, previous: proposal.previous } : saved;
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
