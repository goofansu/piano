import { Schema } from "effect";
import { endpoint } from "../../../../shared/endpoint.ts";
import { ChangesScope, Workspace } from "../../../../shared/wire.ts";

export const CHANGES_INITIAL_PATCH_BYTES = 120_000;
export const CHANGES_FILE_PATCH_BYTES = 1024 * 1024;
export const CHANGES_ANSWER_BYTES = 4 * 1024 * 1024;
export const ChangeFile = Schema.Struct({
  path: Schema.String,
  additions: Schema.Number,
  deletions: Schema.Number,
  binary: Schema.Boolean,
  staged: Schema.optional(Schema.Literal(true)),
});
export type ChangeFile = typeof ChangeFile.Type;
export const ComparisonTarget = Schema.Struct({
  name: Schema.String,
  ref: Schema.String,
  commit: Schema.String,
  from: Schema.Literals(["pull-request", "worktree", "remote-default", "assumed"]),
});
export type ComparisonTarget = typeof ComparisonTarget.Type;
export const Comparison = Schema.Struct({
  scope: ChangesScope,
  base: Schema.String,
  target: Schema.optional(ComparisonTarget),
});
export type Comparison = typeof Comparison.Type;
export const ScopeAvailability = Schema.Struct({
  scope: ChangesScope,
  available: Schema.Boolean,
  reason: Schema.optional(Schema.String),
  target: Schema.optional(ComparisonTarget),
});
export type ScopeAvailability = typeof ScopeAvailability.Type;
export const LocalWork = Schema.Struct({
  commitsNotPushed: Schema.NullOr(Schema.Number),
  uncommitted: Schema.Boolean,
});
export type LocalWork = typeof LocalWork.Type;
export const WorkspaceChanges = Schema.Struct({
  workspace: Workspace,
  observedAt: Schema.String,
  result: Schema.Union([
    Schema.Struct({
      status: Schema.Literal("ready"),
      head: Schema.NullOr(Schema.String),
      branch: Schema.NullOr(Schema.String),
      pullRequestFromBranch: Schema.Boolean,
      comparison: Comparison,
      scopes: Schema.Array(ScopeAvailability),
      local: LocalWork,
      files: Schema.Array(ChangeFile),
      diff: Schema.String,
      truncated: Schema.Boolean,
    }),
    Schema.Struct({
      status: Schema.Literal("unavailable"),
      head: Schema.NullOr(Schema.String),
      branch: Schema.NullOr(Schema.String),
      pullRequestFromBranch: Schema.Boolean,
      scope: ChangesScope,
      detail: Schema.String,
      scopes: Schema.Array(ScopeAvailability),
      local: LocalWork,
    }),
    Schema.Struct({ status: Schema.Literal("error"), detail: Schema.String }),
  ]),
});
export type WorkspaceChanges = typeof WorkspaceChanges.Type;

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
