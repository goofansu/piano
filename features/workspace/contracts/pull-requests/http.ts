import { endpoint } from "../../../../shared/endpoint.ts";
import { SessionPullRequest, SessionPullRequestAction } from "../../../../shared/wire.ts";

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
