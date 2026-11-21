import { Schema } from "effect";
import { endpoint } from "../../../../shared/endpoint.ts";
import { ChangesScope, WorkspaceChanges } from "../../../../shared/wire.ts";

export const changesEndpoints = {
  sessionChanges: endpoint({
    method: "POST",
    path: "/api/session/changes",
    query: ["workspaceId", "sessionId"],
    body: Schema.Struct({ scope: Schema.optional(ChangesScope) }),
    invalid: "Invalid changes request.",
    response: WorkspaceChanges,
    fallback: (status) =>
      `Changes request failed (${status}). Refresh folders or inspect the server.`,
  }),
  sessionChangedFile: endpoint({
    method: "POST",
    path: "/api/session/changes/file",
    query: ["workspaceId", "sessionId"],
    body: Schema.Struct({ path: Schema.String, scope: ChangesScope }),
    invalid: "File path and scope are required in the request body.",
    response: WorkspaceChanges,
    fallback: (status) => `File request failed (${status}).`,
  }),
  setSessionChangesScope: endpoint({
    method: "PUT",
    path: "/api/session/changes",
    query: ["workspaceId", "sessionId"],
    body: Schema.Struct({ scope: Schema.NullOr(ChangesScope) }),
    invalid: "Invalid changes scope.",
    response: WorkspaceChanges,
    noStore: true,
    refused: 409,
    fallback: "Could not save the comparison.",
  }),
} as const;
