import { call, type RequestOptions } from "../../../../web/src/shared/transport/api.ts";
import { composerEndpoints } from "../../contracts/composer/http.ts";

export const slashCommands = async (cwd: string, options?: RequestOptions) =>
  (await call(composerEndpoints.slashCommands, { body: { cwd } }, options)).commands;

export const sessionCommands = async (
  workspaceId: string,
  sessionId: string,
  options?: RequestOptions,
) =>
  (await call(composerEndpoints.sessionCommands, { query: { workspaceId, sessionId } }, options))
    .commands;
