# Radius setup in Piano

A Radius organization owner/admin must enable **Web search** separately in Radius; installation
does not change organization permissions or billing settings. See
[Radius's official setup guide](https://radius.earendil.com/docs/extensions).

## Boundaries

- `server/features/radius/RadiusSetup.ts` owns the narrow setup policy (INV-01/02/11/12); provider OAuth
  continues to use `ProviderLogin`.
- Pi does not export its provider-auth MCP writer publicly, so the adapter imports the locked
  helper through `McpConfigEntries`. Recheck it on every Pi upgrade; see
  [MCP setup](mcp-setup.md#boundaries).
- Conflicting names, duplicate endpoints, malformed configuration, disabled/hidden servers and
  custom package filters are not silently overwritten by setup.
- Pi's helper does not coordinate writes from external editors/processes; do not edit the same
  `mcp.json` concurrently.
