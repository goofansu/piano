# Radius: MCP versus extensions

Checked 2026-10-09 against the public first-party documentation.

## Conclusion

Radius now documents MCP as the primary integration for managing Radius from Pi, but not as an exclusive replacement for extensions. Web search remains available either through MCP or the `@earendil-works/pi-radius-web-search` extension. The documentation establishes the current setup, not when it changed or whether any older extension was removed.

## Findings

- The getting-started flow asks users to run `/login radius`, accept configuration of the Radius MCP server, and select a Radius model with `/model`. Model access and MCP tool access are distinct parts of this flow. [Getting started](https://radius.earendil.com/docs)
- Radius's MCP server exposes API operations as tools: organization settings, members, groups, budgets, models, analytics, artifacts, and web search. [Radius MCP and web search](https://radius.earendil.com/docs/extensions)
- Pi writes the server configuration to `~/.pi/agent/mcp.json`, uses the Radius provider login, and reloads the session. The documented server URL is `https://radius.pi.dev/mcp`; the auth configuration is `{ "provider": "radius" }`. Manual setup uses `/reload` and inspection uses `/mcp`. Separate authorization is also documented using `pi mcp add radius --url https://radius.pi.dev/mcp` followed by `pi mcp login radius`. [Setup](https://radius.earendil.com/docs/extensions)
- Web search is powered by Parallel Web Systems and disabled by default. An organization owner/admin must enable it. Once enabled, Pi can use it through MCP **or** an extension installed with `pi install npm:@earendil-works/pi-radius-web-search`. [Web search](https://radius.earendil.com/docs/extensions)
- The model gateway still uses Pi's native message format; these docs do not describe switching model inference to MCP. [FAQ](https://radius.earendil.com/docs/faq)

## Limits

The page retains the `/docs/extensions` URL but its title is now “Radius MCP and web search.” That is evidence of its present content, not proof of a migration date. This research did not test the live MCP server, inspect older documentation, or verify compatibility with Piano's installed Pi version.

Verification: reviewed the three cited first-party pages and the note's source links; no application code changed, so no application tests or deployment were needed.
