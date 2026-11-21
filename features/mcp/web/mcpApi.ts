import { call, signInApi, type RequestOptions } from "../../../web/src/shared/transport/api.ts";
import { mcpEndpoints } from "../contracts/http.ts";
import type { McpSetupRequest } from "../contracts/mcp.ts";

export const mcpSetup = async (options?: RequestOptions) =>
  (await call(mcpEndpoints.mcpSetup, {}, options)).state;

export const changeMcpSetup = (request: McpSetupRequest) =>
  call(mcpEndpoints.changeMcpSetup, { body: request });

export const mcpLogin = signInApi(mcpEndpoints.mcpLogin);
