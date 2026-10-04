# Shelley token display — 2026-10-04

Reviewed directly in this session; subagents are uninstalled. Source discovery used
[exe.dev's announcement](https://blog.exe.dev/shelley), which identifies the official
[boldsoftware/shelley repository](https://github.com/boldsoftware/shelley).
Inspected source pin: `fe1c6c1fb2743a8d6eb89fbc0017fe88b940f8fb`.

- [ContextUsageBar.vue](https://github.com/boldsoftware/shelley/blob/fe1c6c1fb2743a8d6eb89fbc0017fe88b940f8fb/ui/src/vue/components/ContextUsageBar.vue#L89-L126)
  renders a token-count button (`15k`), not a used/maximum fraction. Its comment
  explicitly says the maximum context size is not displayed in the readout.
  Clicking opens details; the accessible name spells out context usage and tokens.
- [formatTokenCount](https://github.com/boldsoftware/shelley/blob/fe1c6c1fb2743a8d6eb89fbc0017fe88b940f8fb/ui/src/utils/tokenCostGraph.ts#L505-L510)
  keeps counts below 1,000 raw, rounds thousands to whole `k`, and uses one decimal
  for `M`/`B`. It switches units at 999,500 and 999,500,000 to avoid displaying a
  rounded 1,000k/1,000.0M. Examples: `999`, `12k`, `1.0M`, `3.4M`.
- Its readout is not conditional on the agent working: that flag is used for
  an optional warning popup, not to hide the count. Source inspection only;
  no Shelley instance or authenticated page was accessed.

Piano adopts the compact count and a keyboard/touch-accessible details popover,
while keeping Pi authoritative for usage (INV-01/03). The displayed value does
not disappear on settlement. Missing or post-compaction unknown usage is `—`,
with an explicit unavailable explanation; zero is displayed as `0`. A known
context window and cost can still appear in details. This change does not derive
an authoritative context count from saved-history text or retain stale counts
across compaction. It does not port Shelley's graph/compaction features.

Verification: eight module/format tests, typecheck and an isolated build passed.
`node test/browser-composer.mjs /tmp/piano-token-evidence/green` used
`npx agent-browser` on scratch backend/Vite processes (7171/7172). Before the
change, the saved-session unknown-usage assertion failed because the control was
absent; afterwards, unknown usage remained visible, settled usage displayed `2k`
and `42k`, and pointer-clicked details showed exact counts. Eight viewport sizes,
Queue/Stop, keyboard input and in-place reconnect checks also passed. Screenshots
and command output are under `/tmp/piano-token-evidence/`; no hosted UI was driven
or rebuilt. Real-provider context availability and saved-history reconstruction
are outside this presentation change.
