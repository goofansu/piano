# Pi 1.0.2 update and exe.dev effort selection

Date: October 4, 2026. This is a local-machine fix, not an upstream extension
release or completion of roadmap milestone 1. Relevant guardrails: INV-11
(private control plane) and INV-12 (tested Pi version).

## Versions

The npm registry's `latest` tag resolved to **1.0.2**, published at
`2026-10-04T00:56:19.486Z`; the tagged changelog dates it October 4, 2026.

- Terminal `pi`: updated from standalone 0.87.1 to 1.0.2 at
  `~/.local/pi-npm`. `~/.local/bin/pi` points to its launcher.
- Piano: dependency and lockfile updated from 1.0.0 to an exact 1.0.2 pin.
  Piano spawns its repository dependency, not the terminal executable.
- Node: 24.21.0. The hosted backend was restarted only after its cgroup showed
  no Pi children. Port 8000 keeps the existing private Vite frontend.

Pi 1.0.1 removed the published shrinkwrap and pinned `brace-expansion` to a fixed
version. This explains the larger dependency-tree diff. Effect remains exactly
4.0.0-rc.118; the updated Piano dependency audit reports zero vulnerabilities.

## Cause

Pi uses **`PI_CODING_AGENT_DIR`**, defaulting to `~/.pi/agent`.
`PI_AGENT_HOME` is not the variable used by this installation.

The local extension, `~/.pi/agent/extensions/exe-dev/index.ts`, discovers LLM
integrations through Reflection, reads their `/models.json`, and registers
providers such as `exe-dev-openai`. Its bundled `catalog.json` contributes
pricing and compatibility metadata, not additional routes.

Two gaps explained the missing effort choices:

1. `configFromIntegrationModel()` set `reasoning` to
   `fallback?.reasoning ?? false`. The sidecar omitted it on the default
   `gpt-5.6-sol`, most GPT models and Claude models. The current integration
   catalog did not supply equivalent Pi reasoning metadata. Piano therefore
   exposed the default as non-reasoning with only `["off"]`.
2. The extension dropped `thinkingLevelMap`. Pi excludes map entries set to
   `null`, and requires explicit entries for `xhigh`/`max`. Simply setting
   `reasoning: true` would still offer an incomplete or inaccurate list.

This was not a missing Pi effort control; upgrading Pi alone would not repair
the extension's metadata.

## Machine-local fix

- Added map preservation to the sidecar model shape and provider registration.
- Refreshed reasoning flags/maps for 52 matching sidecar entries from **Pi
  1.0.2's bundled native-provider catalog**. Added missing capability entries for
  `gpt-6.1-sol` and `claude-sonnet-5-5`. Non-reasoning models remain non-reasoning.
- Kept integration URLs, credentials, alias rewrites and existing prices
  unchanged. Only Reflection-discovered models are registered.
- Added a regression test: it failed on the missing registered map before the
  fix, then passed.

Observed after the hosted-backend restart:

| Model | Supported Pi levels |
| --- | --- |
| `gpt-5.6-sol@llm` | off, low, medium, high, xhigh, max |
| `gpt-6.1-sol@llm` | low, medium, high, xhigh, max |
| `claude-opus-5-5@llm` | low, medium, high, xhigh, max |
| `grok-4.5@llm` | low, medium, high |
| `gpt-4o@llm` | off |

There are still 47 integration models; 42 now advertise reasoning capability.
These extension edits are **outside this Git repository** and an extension
reinstall may replace them. Original files and the previous launcher target
are backed up at `~/.local/state/pi-updates/2026-10-04-pi-1.0.2/`.
The original standalone binary remains at `~/.local/pi/pi`.

## Evidence and limits

- Piano's 5 module tests, typecheck and frontend build passed on Pi 1.0.2.
- All 27 extension tests passed, including the red/green regression.
- Real terminal and repository Pi RPC processes each discovered 47 models and
  accepted `high`, `xhigh` and `max` on the tested GPT/Claude models. GPT-4o
  correctly clamped a requested `high` to `off`.
- A scratch terminal showed `/thinking` and selected `high` without a model call.
- `agent-browser` observed an isolated Piano on port 7171 selecting `high`,
  sending `Reply with exactly: PIANO102`, reading the assistant's exact reply,
  and retaining history and effort after reload. Pi's session record reported
  `thinkingLevel: "high"`.
- The hosted `/api/models` returned the corrected lists after restart. The real
  registry, settings and auth were not changed.

The scratch instance used a separate agent/session directory, only the explicit
exe.dev extension, and disabled other tools/resources. This was not exhaustive
verification of user packages, project MCP overrides, dialogs, abort races or
every model/effort. It does not establish full Pi compatibility or remote-product
security compliance.

Logs, RPC assertions and browser artifacts: `/tmp/pi-update.ELfQYU/`.
Scratch processes and generated session files were cleaned up after verification.

## Use

Exit and relaunch an old terminal Pi process to use 1.0.2. Run **`/thinking`** or
press **Shift+Tab** to cycle supported levels. `Ctrl+S` in the picker saves the
startup default; normal selection changes the current session. In a Pi 1.0.2
process, `/reload` reloads extension edits.

Reload Piano's browser page to refresh its catalog. Its backend has already
been restarted with the new dependency and extension metadata.

## Primary sources

- [npm release metadata](https://registry.npmjs.org/@earendil-works/pi-coding-agent)
- [Pi 1.0.2 changelog](https://github.com/earendil-works/pi/blob/v1.0.2/packages/coding-agent/CHANGELOG.md)
- [Pi model selection and `/thinking`](https://github.com/earendil-works/pi/blob/v1.0.2/packages/coding-agent/docs/models.md)
- [Pi custom-provider capabilities](https://github.com/earendil-works/pi/blob/v1.0.2/packages/coding-agent/docs/custom-provider.md)
- [Supported thinking-level implementation](https://github.com/earendil-works/pi/blob/v1.0.2/packages/ai/src/models.ts)
- [Agent-directory resolution](https://github.com/earendil-works/pi/blob/v1.0.2/packages/coding-agent/src/config.ts)
- [exe.dev LLM integrations](https://exe.dev/docs/integrations-llm.md)
