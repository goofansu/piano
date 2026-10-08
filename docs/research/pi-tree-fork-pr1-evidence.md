# Conversation history — PR 1 evidence

Slice: [browse/search plan](../pi-tree-fork-plan.md#pr-1--browse-and-search-conversation-history).
Contracts: INV-01, INV-02, INV-05, INV-11–12.

Tested on Node 24.21.0 / Linux with locked Pi 1.1.0, against `origin/main`
`2c7ce9f` plus this PR's working tree. Scratch SQLite and isolated Pi config/session
storage; loopback backend/UI 7171/7172. No deployment or real-registry changes.

## Observations

- Before: the menu/palette offered no full-history inspector; the transcript only
  exposed the active compacted context. `before.png` retains that context.
- After: menu and Mod+K open the same keyboard-accessible dialog at 1280px and
  390px. Search found the pre-compaction prompt, abandoned approach, summary and
  existing Pi label. Preview did not change saved bytes. A subsequent handled
  input observed the original Pi leaf/path, not the previewed abandoned entry.
- “Show current position” clears filters and reveals technical leaves. The first
  browser run caught cmdk overriding this selection after rows remounted; the fix
  selects after layout and the same assertion now passes.
- Inactive reads started no child for that session (catalog probes are separate).
  Switching sessions while an intentionally delayed read completed did not show
  the obsolete dialog/results. Missing history produced an explicit error.
- Locked-Pi module checks compare authoritative snapshots and entries, then move
  the live leaf using a fixture extension: live reads follow memory while saved
  reads retain the appended leaf. No production navigation is exposed.
- A full-suite run exposed an existing image test race: it treated prompt
  acknowledgement as a context barrier. The test now subscribes before submission
  and waits for authoritative image context before asserting the late snapshot;
  all original assertions remain. The failing output is retained separately.
- Regression checks cover real IDs/parents, multiple roots, hidden ancestors,
  global labels, limits, image/custom-data omission, secret redaction, missing or
  mismatched files and deleted-checkout inspection without starting Pi.

## Commands and artifacts

```text
npm test                         93 passed
npm run typecheck                passed
npm run lint                     passed
node test/browser-conversation-tree.mjs /tmp/piano-tree-evidence/browser
  PASS: menu/palette, desktop/mobile, keyboard focus, both branches/compaction/label,
  filter-independent current position, inactive no-spawn, stale response
  cancellation, failed read, live idle/running preview and abort;
  one local synthetic stream, no paid calls.
```

Retained on the development VM in `/tmp/piano-tree-evidence/`: full gate logs,
`browser/commands.json`, process/fixture observations, revision/environment and
before/desktop/mobile/error screenshots. Scratch processes and fixtures removed.

## Review and limits

Standards review: Pi protocol remains behind PiSessions; SessionHosts selects the
owner; Registry holds no history. File inspection uses Pi parsing plus an in-memory
manager, avoiding `SessionManager.open`'s possible legacy migration writes. History
reads claim against retirement but do not hold the ownership lock during RPC, so a
slow read cannot prevent abort/dialog admission. Menu/palette parity is preserved.

Spec review: PR 1 only; no mutation buttons or future-feature placeholders. Browser
responses carry session/entry identity and obsolete fetches are aborted/ignored.
Results are capped at 2,000 entries (recent plus live position), previews at 280
characters and details at 32,000 characters; the UI states search/truncation scope.
Images, arbitrary custom data and tool arguments are deliberately not delivered.
Pi's native get_entries still returns the complete raw history to the server; this
bounds browser payload, not Pi's subprocess response memory. Redaction is heuristic,
not containment. A single local synthetic streaming endpoint established that
preview remains available during a run and abort remains usable. No paid calls.

Review was performed locally along Standards and Spec axes, not by independent
reviewer agents. Live running/idle and inactive reads were exercised directly.
