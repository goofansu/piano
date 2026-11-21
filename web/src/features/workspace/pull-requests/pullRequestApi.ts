import { pullRequestEndpoints } from "../../../../../shared/features/workspace/pull-requests/http.ts";
import type { SessionPullRequestAction } from "../../../../../shared/wire.ts";
import { call, type RequestOptions } from "../../../shared/transport/api.ts";

export const sessionPullRequest = (
  workspaceId: string,
  sessionId: string,
  action: SessionPullRequestAction | undefined,
  options?: RequestOptions,
) =>
  action
    ? call(
        pullRequestEndpoints.changeSessionPullRequest,
        { query: { workspaceId, sessionId }, body: action },
        options,
      )
    : call(pullRequestEndpoints.sessionPullRequest, { query: { workspaceId, sessionId } }, options);
