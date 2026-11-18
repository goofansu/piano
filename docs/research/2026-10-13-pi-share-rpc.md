# Pi `/share` and RPC

## Scope and answer

Inspected Piano's installed `@earendil-works/pi-coding-agent` **1.1.0** on 2026-10-13. This is a version-specific source inspection, not a claim about later upstream releases. No sessions were published, credentials accessed, or model calls made. No background research agent was available, so inspection was performed directly.

**Built-in `/share` is not available in RPC mode.** The RPC command union has no share command; the documented `get_commands` behavior explicitly excludes built-in TUI commands and says they will not execute when sent through `prompt`. RPC does expose `export_html`, which creates a local file, not a hosted link. [1][2][3]

## What interactive `/share` actually does

The implementation is in the interactive-mode module, not a reusable RPC operation. [4]

1. Exports the **current branch** as JSONL, with a trailing `pi.share` entry containing the current system prompt and tool names, descriptions, and parameter schemas. [4][5]
2. If a Radius provider and credential are available, posts that JSONL to `/v1/artifacts` with **`visibility=organization`**, returning the artifact's `canonical_url`. This is not an explicit public publication. An attempted Radius upload failure reports an error; it does not fall back to GitHub. [4]
3. If Radius is unavailable or has no credential, checks `gh auth status`, exports HTML, and runs `gh gist create --public=false`. The resulting secret/unlisted gist is linked through `https://pi.dev/session/#<gistId>` by default (`PI_SHARE_VIEWER_URL` can override the viewer base). Do not treat an unlisted link as an authorization boundary. [4][6]
4. Removes its temporary export folder afterward. [4]

**Important scope difference:** the Radius JSONL export uses `getBranch()`, whereas HTML export embeds `getEntries()` plus the leaf ID, system prompt, and tool schemas. HTML can therefore contain other branches, not just the conversation currently displayed. [5][7]

## RPC integration implication

The available primitive is:

```json
{"id":"export-1","type":"export_html","outputPath":"/tmp/session.html"}
```

Successful response:

```json
{"id":"export-1","type":"response","command":"export_html","success":true,"data":{"path":"/tmp/session.html"}}
```

The path is on the Pi subprocess host. Uploading this file and returning a public URL would be additional integration behavior, not invoking Pi's built-in `/share`. Sending `{"type":"prompt","message":"/share"}` is not a supported shortcut. A custom extension command is a separate possibility: RPC supports invoking registered extension commands through `prompt`, but that does not expose the built-in command. [1][3]

For a future Piano action, decide explicitly whether the intended result is organization-only, unlisted-link access, or public publishing. Require review/confirmation of the exported content and scope: Pi's own docs warn that sessions may contain prompts, tool arguments, command output, file contents, and credentials exposed in the conversation. [8] No implementation or deployment is included in this research.

## Primary sources

Links below point to the exact installed package inspected; these are dependency files, not committed source snapshots.

1. [RPC command reference](../../node_modules/@earendil-works/pi-coding-agent/docs/rpc-commands.md): `prompt`, `export_html`, and `get_commands`.
2. [RPC protocol types](../../node_modules/@earendil-works/pi-coding-agent/dist/modes/rpc/rpc-types.d.ts): `RpcCommand`.
3. [RPC dispatch](../../node_modules/@earendil-works/pi-coding-agent/dist/modes/rpc/rpc-mode.js): `prompt` forwards to `session.prompt`; `export_html` calls `session.exportToHtml`.
4. [Interactive sharing implementation](../../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/session-share.js): `shareSession`, `tryShareViaRadius`, `shareViaGist`, `createShareTrailingEntries`.
5. [JSONL export implementation](../../node_modules/@earendil-works/pi-coding-agent/dist/core/session-export.js): `serializeSessionBranch`.
6. [Viewer URL configuration](../../node_modules/@earendil-works/pi-coding-agent/dist/config.js): `getShareViewerUrl`.
7. [HTML export implementation](../../node_modules/@earendil-works/pi-coding-agent/dist/core/export-html/index.js): `exportSessionToHtml`.
8. [Slash commands and sharing warning](../../node_modules/@earendil-works/pi-coding-agent/docs/slash-commands.md).

Verification: documentation/source review only. No application behavior changed, so no unit tests, browser run, or build were needed. Upload success, hosted viewer behavior, and account-specific permissions were not exercised.
