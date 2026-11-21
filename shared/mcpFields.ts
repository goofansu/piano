export const MCP_FIELDS = ["name", "config"] as const;
export type McpField = (typeof MCP_FIELDS)[number];
