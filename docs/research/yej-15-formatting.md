# YEJ-15 — reproducible formatting

Applied last, after YEJ-10 (`82b042c`) and YEJ-11 (`850ec29`). The convention is
recorded in README and enforced by the existing pinned Biome 2.5.15, not a new
dependency: two-space indentation, LF, 100-column target, double quotes, semicolons,
trailing commas. `npm run format` writes; `npm run format:check` checks only.
`npm run lint` / the pre-commit hook / CI's **Lint and formatting** step all enforce
formatting through `biome check`; CI never auto-fixes.

## Scope and preservation

- Source/tests and maintained JS/JSON configuration are included explicitly.
- Generated shadcn `web/src/components/ui` stays excluded; its files and all
  `piano:` customizations are byte-for-byte unchanged. Tailwind lint still covers them.
- Lockfiles, captured evidence, vendored skills, Markdown and YAML are not formatted.
- Five existing line-scoped Biome suppressions moved to their affected JSX
  attributes after line wrapping. Their rationale/rules are unchanged; no rules
  were disabled and no runtime attributes changed.
- This phase changes formatting/configuration/docs only, separate from correctness
  and ownership commits. INV-01–05 behavior remains covered by the existing tests.

## Verification

Node v24.21.0; baseline `850ec29` plus this formatting phase:

- Before formatting, `npm run format:check` failed as expected. After formatting,
  it passed; a second formatting run made no changes.
- `npm run lint`, `npm run typecheck`: passed. `npm test`: 381 passed.
- Normalized emitted JavaScript ASTs matched for all 245 changed JS/TS/TSX files.
  Comparison ignores trivia/parentheses and coalesces adjacent JSX text children
  (Biome can spell a space as `{" "}`). This supplements tests; it is not a general
  proof of semantic equivalence. CSS diff reviewed separately for formatting only.
- Scratch `agent-browser` journey passed again on 7171/7172: capacity refusal,
  working dialog/acks, subsequent successful input, visible failed closure with
  no resend. Scratch processes and storage cleaned up by the runner.
- Build passed with the existing large-chunk warning. **Workflow mistake:** this
  check used `npm run build` in the main checkout, replacing the hosted `web/dist`
  despite the no-rebuild instruction. The backend was not restarted and the real
  registry was untouched. Reported to the user; no further hosted changes made.
  Future build verification must use a scratch output directory rather than the
  hosted assets.

Evidence is retained under `/tmp/piano-yej-evidence/15-*`, including the browser
wire log/screenshots and equivalence script/output. No real-model calls or new
behavioral tests were needed for this mechanical pass.
