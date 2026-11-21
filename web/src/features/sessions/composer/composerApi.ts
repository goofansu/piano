import { composerEndpoints } from "../../../../../shared/features/sessions/composer/http.ts";
import { call, type RequestOptions } from "../../../shared/transport/api.ts";

export const slashCommands = async (cwd: string, options?: RequestOptions) =>
  (await call(composerEndpoints.slashCommands, { body: { cwd } }, options)).commands;

export const sessionCommands = async (
  workspaceId: string,
  sessionId: string,
  options?: RequestOptions,
) =>
  (await call(composerEndpoints.sessionCommands, { query: { workspaceId, sessionId } }, options))
    .commands;
