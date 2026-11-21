# MCP setup in Piano

## Boundaries

- `features/mcp/server/McpSetup.ts` owns this policy; Pi owns configuration parsing and validation, OAuth and
  credential storage (INV-01/02/11/12). The browser never receives an `Authorization` value.
- Pi exports neither its MCP config writer, its validator nor its sign-in flow publicly, so
  `McpConfigEntries` and `McpSetup` import the pinned `dist` helpers. Recheck these imports on
  every Pi upgrade.
- OAuth failure details can contain token responses, so the browser receives only a generic
  message.
