import { changesEndpoints } from "../../../../../shared/features/workspace/changes/http.ts";
import type { ChangesScope } from "../../../../../shared/wire.ts";
import { call, type RequestOptions } from "../../../shared/transport/api.ts";

export const sessionChanges = (
  workspaceId: string,
  sessionId: string,
  scope: ChangesScope | undefined,
  options?: RequestOptions,
) =>
  call(
    changesEndpoints.sessionChanges,
    { query: { workspaceId, sessionId }, body: scope ? { scope } : {} },
    options,
  );

export const sessionChangedFile = (
  workspaceId: string,
  sessionId: string,
  body: { path: string; scope: ChangesScope },
  options?: RequestOptions,
) =>
  call(changesEndpoints.sessionChangedFile, { query: { workspaceId, sessionId }, body }, options);

export const setSessionChangesScope = (
  workspaceId: string,
  sessionId: string,
  scope: ChangesScope | null,
  options?: RequestOptions,
) =>
  call(
    changesEndpoints.setSessionChangesScope,
    { query: { workspaceId, sessionId }, body: { scope } },
    options,
  );
