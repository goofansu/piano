import { mcpEndpoints } from "../../../../shared/features/mcp/http.ts";
import type { McpSetupRequest } from "../../../../shared/features/mcp/mcp.ts";
import { call, signInApi, type RequestOptions } from "../../shared/transport/api.ts";

export const mcpSetup = async (options?: RequestOptions) =>
  (await call(mcpEndpoints.mcpSetup, {}, options)).state;

export const changeMcpSetup = (request: McpSetupRequest) =>
  call(mcpEndpoints.changeMcpSetup, { body: request });

export const mcpLogin = signInApi(mcpEndpoints.mcpLogin);
