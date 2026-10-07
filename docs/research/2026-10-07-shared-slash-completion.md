# Shared slash completion

Implemented the first increment from the October 6 research on `slash-commands`
(commit `3a04c09`). Contracts: **INV-01–03, INV-07, INV-12–13** in
[development invariants](../development-invariants.md).

## Behavior and boundaries

- Both composers use `web/src/components/SlashTextarea.tsx`: a caret-aware leading
  command token, a small suggestion list, command source/description, and insertion
  that preserves text outside that token. Inline/later-line mentions after prose
  and filesystem paths are deliberately not completed.
- Arrows select, Tab/Enter (including Alt+Enter) accepts without submitting. Shift+Enter
  retains newline behavior. Escape dismisses before the active composer's abort handler.
  With no target, existing sending, mobile newline and focus traversal remain intact.
  IME composition suppresses the menu and composer key actions.
- Pi owns discovery and execution. `PiSessions.act({ _tag: "commands" })` returns a
  caller-only catalog, not a transcript event. It validates the response and resolves
  duplicate invocations according to native extension → skill → template precedence.
  No built-in TUI commands or browser-side skill expansion were added.
- `GET /api/commands` resolves a running child through `SessionHosts`, never opens a
  saved session, and otherwise shares the existing cwd probe/cache. Concurrent cwd
  catalog reads share a probe. Trust changes refresh that preliminary catalog.
- Each opening refreshes live discovery, with no requests per keystroke. Closing or
  changing context aborts/discards pending browser results. Cwd, session, child
  generation and reconnect selection identify context. The list uses the current
  draft/caret, and acceptance checks the DOM value and selection again.
- Pi 1.0.4's installed RPC docs and implementation still expose `get_commands` and
  leading-only native skill expansion. Submission stays on the existing RPC `prompt`
  path, including extension commands while busy and `handled` dispositions.

The preliminary catalog can differ from session-specific extension registrations.
It refreshes with the model catalog or trust changes; a live child is authoritative.
Terminal-only extension UI remains unsupported. Paths, deterministic inline skills,
argument completion, and multiple-skill invocation remain out of scope.

## Evidence

Tested on Node 24.21.0, locked Pi 1.0.4, base `17f91c3` plus this change's dirty files.
Self-review covered catalog precedence, ownership, request cancellation, keyboard
priority, generated menu geometry and the unrelated concurrent edits (left untouched).

- `npm test`: **70 passed**. Added read-only probe/live catalog and duplicate-precedence
  assertions through PiSessions; extended the real-Pi, no-model fixture to verify cwd
  command discovery and live lookup. Existing handled/busy/queue tests remain green.
- `npm run typecheck`: passed (server and web).
- `PIANO_TEST_BACKEND_PORT=7181 PIANO_TEST_WEB_PORT=7182 node test/browser-slash-completion.mjs /tmp/piano-slash-evidence`:
  passed through `npx agent-browser`, fake Pi, isolated registry/repository/session paths.
  Ports 7171/7172 were already occupied by separate development processes and were not stopped.
- Browser assertions cover both composers, probe/live differences, duplicate removal,
  focus and active-descendant linkage, keyboard/pointer acceptance, mid-token editing,
  suffix preservation, literal prose/paths, IME suppression, Escape versus abort,
  handled commands idle/busy, delayed results after draft edits, error/empty states,
  stopped-session discovery rejection, mobile newline and 320px menu bounds.
- Logs, command output, snapshots and screenshots: `/tmp/piano-slash-evidence/`.
  `git diff --check` passed. Scratch processes and fixtures were cleaned up.

An initial suite failure exposed the secondary fake Pi's missing `get_commands` response;
its protocol fixture was updated, without weakening assertions. Browser harness iterations
fixed simulated caret movement and coarse-pointer setup before the final passing run.
Actual OS keyboard/IME and screen-reader behavior were not exercised; mobile uses browser
emulation. No model requests, deployment, service restart or real-registry edits were made.
