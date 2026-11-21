import { call, type RequestOptions } from "../../../../web/src/shared/transport/api.ts";
import {
  type SessionPullRequestAction,
  pullRequestEndpoints,
} from "../../contracts/pull-requests/http.ts";

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
