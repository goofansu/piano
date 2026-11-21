import { Schema } from "effect";
import { endpoint } from "../../../../shared/endpoint.ts";
import { SessionPullRequestLink } from "../../../../shared/wire.ts";

export const PullRequest = Schema.Struct({
  url: Schema.String,
  repo: Schema.String,
  number: Schema.Number,
  title: Schema.String,
  state: Schema.Literals(["open", "draft", "merged", "closed"]),
  checks: Schema.Literals(["none", "unknown", "pending", "success", "failure"]),
  review: Schema.Literals(["none", "approved", "changes_requested", "review_required"]),
  author: Schema.optional(Schema.String),
  head: Schema.optional(Schema.String),
  base: Schema.optional(Schema.String),
  headRepo: Schema.optional(Schema.String),
  baseRepo: Schema.optional(Schema.String),
  additions: Schema.optional(Schema.Number),
  deletions: Schema.optional(Schema.Number),
  changedFiles: Schema.optional(Schema.Number),
  at: Schema.optional(Schema.String),
});
export type PullRequest = typeof PullRequest.Type;

export const SessionPullRequest = Schema.Struct({
  link: Schema.NullOr(SessionPullRequestLink),
  pullRequest: Schema.NullOr(PullRequest),
  error: Schema.optional(Schema.String),
});
export type SessionPullRequest = typeof SessionPullRequest.Type;
export const SessionPullRequestAction = Schema.Union([
  Schema.Struct({ action: Schema.Literal("link"), url: Schema.String }),
  Schema.Struct({ action: Schema.Literal("remove") }),
  Schema.Struct({ action: Schema.Literal("discover") }),
]);
export type SessionPullRequestAction = typeof SessionPullRequestAction.Type;

export const pullRequestEndpoints = {
  sessionPullRequest: endpoint({
    method: "GET",
    path: "/api/session/pull-request",
    query: ["workspaceId", "sessionId"],
    response: SessionPullRequest,
    noStore: true,
    refused: 400,
    fallback: "Could not load the pull request.",
  }),
  changeSessionPullRequest: endpoint({
    method: "PUT",
    path: "/api/session/pull-request",
    query: ["workspaceId", "sessionId"],
    body: SessionPullRequestAction,
    invalid: "Invalid pull request request.",
    response: SessionPullRequest,
    noStore: true,
    refused: 400,
    fallback: "Could not load the pull request.",
  }),
} as const;
