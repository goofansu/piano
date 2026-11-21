import { Schema } from "effect";
import { endpoint } from "../../../shared/endpoint.ts";
import { signInEndpoints } from "../../../shared/signInEndpoints.ts";
import { McpSetupChange, McpSetupRequest, McpSetupState } from "./mcp.ts";

const McpReply = Schema.Struct({ state: McpSetupState });

export const mcpEndpoints = {
  mcpSetup: endpoint({
    method: "GET",
    path: "/api/settings/mcp",
    response: McpReply,
    noStore: true,
    redact: false,
    fallback: "Could not load MCP servers.",
  }),
  changeMcpSetup: endpoint({
    method: "POST",
    path: "/api/settings/mcp",
    body: McpSetupRequest,
    invalid: "Invalid MCP setup action.",
    response: McpSetupChange,
    noStore: true,
    refused: 409,
    redact: false,
    fallback: "Could not change MCP setup.",
  }),
  mcpLogin: signInEndpoints("/api/settings/mcp/login"),
} as const;
