---
name: verify-piano
description: Launch an isolated scratch Piano (own database, Pi dirs and HOME, fake Pi, throwaway Git repo, backend plus Vite UI on free loopback ports), check it with a read-only doctor, drive the web UI with the repo's browser harness or the installed agent-browser and the dispatch CLI, keep evidence that survives cleanup, and tear down by recorded PID. Also read-only health checks for a deployed instance on an exe.dev VM. Use whenever a Piano change needs its user-visible behavior proved.
---

# Verify Piano

Piano is a web UI (React + Vite) over a Node backend (`server/main.ts`) that starts Pi sessions in
folders and their worktrees. Users touch the browser UI; orchestrators also use the dispatch CLI
`scripts/dispatch-session.ts` and the `/ws` session socket. Prove behavior on a scratch instance
this skill starts, never on the user's own Piano (local `7070`; on exe.dev `piano.service` on
`127.0.0.1:8001` behind `piano-web` on `127.0.0.1:8000`), whose database is real.

All paths below are relative to the repository root, and every script is written out in full: a
worktree-isolated session refuses a command whose name comes from a variable. The scripts run on
Linux and macOS alike: `lib.sh` reads processes and ports from whatever the host has (`/proc`,
`ss` and `setsid`, or `ps` and `lsof`), so no step below changes with the platform. On exe.dev they
put `~/node/bin` and `~/.local/bin` (Node, `wt`) on `PATH` themselves; record `node --version`
rather than assuming those paths pin a version. The feature map in
[`features/README.md`](features/README.md) says what to drive; this file says how.

## Run limits

Keep at most one scratch Piano instance and at most one browser session active for a verification
run. Drive checks serially, reusing that instance and browser across the run. Before replacing
either, finish teardown of the previous run-owned resource using [Cleanup](#cleanup), preserving
its [evidence](#evidence). If teardown cannot be confirmed, stop and report the blocker rather than
start a replacement.

**Narrow exception:** `node test/browser/remote-session.mjs <evidence-directory>` and
`node test/browser/remote-inputs.mjs <evidence-directory>` may each own main plus two headless
peers and one browser. Run the two portions serially, each finishing cleanup before the next. Its existing harness gives each machine
a separate database, HOME, XDG/Pi state and audit, loopback ports and recorded child ownership;
the one harness tears all of them down before another journey or Launch. Run no other scratch
instance alongside it. This exception is only for those committed multi-peer portions, not arbitrary
parallel launches or reuse of live peers. Confirm its `run.json` cleanup result before continuing.

## Launch

First allocate an [evidence run](../../../docs/testing.md#evidence-directories) in this shell.
That sets `EVIDENCE_RUN` for explicit harness output and `VERIFY_EVIDENCE` for manual launches.
Choose one launch below after any harness journey has completed its cleanup.

```bash
.agents/skills/verify-piano/scripts/launch.sh                      # seeded: folder repo, 2 projects, 2 saved sessions
.agents/skills/verify-piano/scripts/launch.sh --empty              # empty database: nothing registered
.agents/skills/verify-piano/scripts/launch.sh --fake-pi dialogs    # test/fake-pi.mjs: "ask ..." opens a dialog, "crash ..." exits
.agents/skills/verify-piano/scripts/launch.sh --fake-pi ask        # test/fake-dialog-pi.mjs: "/ask store 2 numeric" runs ask_user
VERIFY_GH_CLI=<path> .agents/skills/verify-piano/scripts/launch.sh  # a stand-in gh (PIANO_GH_CLI), e.g. a wrapper over test/fixtures/fake-gh.mjs
```

Install the [development prerequisites](../../../README.md#develop), including agent-browser
and Chromium, first. Launch needs `node_modules` (runs `npm ci` when missing). It creates
`/tmp/verify-piano/<run-id>/` (`VERIFY_SCRATCH` overrides the parent) holding:

- `audit.jsonl`: every command the fake Pi received (`PIANO_TEST_AUDIT`). Only the default
  `test/browser/fake-pi.mjs` writes it; on `--fake-pi dialogs` and `ask` there is no audit, so
  prove what Pi received from its replies instead.
Then `. "$RUN/run.env"` gives `RUN`, `EVIDENCE`, `REPO`, `DB`, `AUDIT`, `API_URL`, `WEB_URL`,
`ORIGIN`, `PORT`, `WEB_PORT`, `EXPECTED_SHA`, `AB_SESSION`, and exports `PIANO_SESSION_WS_URL` /
`PIANO_SESSION_ORIGIN` for the dispatch CLI. A launch that fails prints the log tail; run Cleanup on
the printed run dir anyway.

Seed data: `.agents/skills/verify-piano/scripts/seed.ts`.

### A deployed instance

`https://<vm>.exe.xyz` is the owner's real Piano behind exe.dev private access: it has no login of
its own, and the origin check is its only write guard. The Piano VMs are the ones `ssh exe.dev ls
--json` tags `goofansu-piano` (for example `eng-1`). Target them read-only:

- From outside the VM: `.agents/skills/verify-piano/scripts/doctor.sh --deployed-auth eng-1` expects `307` to
  `https://eng-1.exe.xyz/__exe.dev/login`; `answered '000 '` means the name does not resolve (no
  such VM). A headless `agent-browser` has no exe.dev login, so it
  cannot open that UI; UI observation there needs the owner's signed-in browser.
- On the VM, from any checkout there (the script sources its `lib.sh`, so it cannot be piped over
  SSH): `.agents/skills/verify-piano/scripts/doctor.sh --deployed`.
- Plain GETs to `http://127.0.0.1:8001/api/folders` and `http://127.0.0.1:8000/` need no Origin.
  Never POST, open `/ws`, or open session pages there: even viewing a session starts a Pi `probe`
  child for its composer. Never restart, sync or rebuild it; that is the owner's call
  (`docs/hosted-development.md`).

## Doctor

Run it first, and again whenever anything looks off. It changes nothing.

```bash
.agents/skills/verify-piano/scripts/doctor.sh "$RUN"            # exit 0 = worth driving
.agents/skills/verify-piano/scripts/doctor.sh --deployed         # on the VM, read-only
```

## Drive

1. **The repo harness first.** Allocate an [evidence run](../../../docs/testing.md#evidence-directories)
   if not already set in this shell. The committed critical paths start their own scratch instance
   and browser, assert what a user sees and what Pi receives, and write screenshots into the
   directory given as the first argument:

   ```bash
   node test/browser/start-session.mjs "$EVIDENCE_RUN/harness-start-session"
   node test/browser/open-session.mjs "$EVIDENCE_RUN/harness-open-session"
   node test/browser/transcript-rows.mjs "$EVIDENCE_RUN/harness-transcript-rows"
   ```

   Each prints its outcome and evidence directory. `PASSED` exits 0; failed, blocked, cancelled,
   error or inconclusive runs exit nonzero. Inspect `run.json`, not just the exit code.
   They do not need `launch.sh`: run them one at a time before Launch (or after cleaning up an
   existing run), and let each finish its own teardown before the next journey or Launch.
   `npm run test:browser` runs these and both remote portions serially under the narrow exception
   above; on macOS both remote portions skip with exit 0, which is not a pass. `npm run verify` is the separate typecheck/lint/module-test baseline, not browser coverage.

   For mapped Preview behavior, also run `node test/browser/preview.mjs <evidence-directory>`
   serially before Launch. It needs the native supervisor and free ports described in
   [the Preview journey](../../../docs/testing.md#managed-preview-host-journey). A scratch JSON
   `PIANO_PREVIEW_CONFIG` containing `{"origin":"http://127.0.0.1"}` enables external-tab
   interaction without exe.dev authentication; it does not prove authenticated HTTPS access.

   For peer coverage, run `node test/browser/remote-session.mjs <evidence-directory>` and then
   `node test/browser/remote-inputs.mjs <another-evidence-directory>`, before Launch or after cleanup.
   Confirm the first run’s cleanup before starting the second. `test/browser/voice-input.mjs` is only an imported helper: running it
   directly performs no checks. The default manual launch still has no configured peer; report
   that prerequisite honestly (see [Open a session](features/open-session.md)).

2. **Then launch once and reuse `agent-browser`** for anything the harness does not cover,
   through `ab.sh`, which runs `agent-browser --session "$AB_SESSION"` from `PATH`.
   `cleanup.sh` closes the session with the same installed CLI:

   ```bash
   .agents/skills/verify-piano/scripts/ab.sh "$RUN" set viewport 1280 800
   .agents/skills/verify-piano/scripts/ab.sh "$RUN" open "$WEB_URL/projects/verify"
   .agents/skills/verify-piano/scripts/ab.sh "$RUN" wait --text "Plan the verification"
   .agents/skills/verify-piano/scripts/ab.sh "$RUN" find role button click --name "New session" --exact
   .agents/skills/verify-piano/scripts/ab.sh "$RUN" snapshot -i            # refs like @e9 for the current page only
   ```

   A drive of more than a few steps goes in a script file (`ab() { .agents/skills/verify-piano/scripts/ab.sh "$RUN" "$@"; }`
   at its top, the steps below) run with `bash <file>`: one command for the session, and the
   steps kept beside the evidence.

   Stable handles, in order of preference: role plus accessible name (`find role <role> click
   --name <name> --exact`), `aria-label` selectors (`[aria-label="First message"]`,
   `[aria-label="Message"]`, `[aria-label="Send"]`), `data-slot` (`[data-slot=item]` list rows,
   whose title button is `[data-slot=item-title] button`; `[data-slot="gutter"]` transcript
   glyphs), `[cmdk-input]` (Mod+K palette), and routes (`/new`,
   `/s/<sessionId>`, `/projects/<id>`, `/projects/<id>/new`). Snapshot refs (`@e9`) change on every
   render; never reuse them across pages. Read the session header with
   `ab.sh "$RUN" eval "document.querySelector('main header').innerText"`.

3. **The dispatch CLI** (`scripts/dispatch-session.ts`) after `. "$RUN/run.env"`; see
   [`features/session-dispatch.md`](features/session-dispatch.md).

4. **HTTP** for side effects, with `Origin: $ORIGIN` on anything but GET:
   `curl -s "$API_URL/api/folders"`;
   `curl -s -X POST -H "Origin: $ORIGIN" -d '{}' "$API_URL/api/session/changes?workspaceId=<id>&sessionId=<sessionId>"`.
   Workspace IDs come from `/api/folders` (`folders[].worktrees[].workspace.id`).

## Evidence

With the [evidence directory setup](../../../docs/testing.md#evidence-directories), manual launch
evidence goes to `$EVIDENCE_RUN/manual/<run-id>/`, outside the scratch run dir, so Cleanup keeps it.
After sourcing `run.env`, `$EVIDENCE` names that manual launch directory; `$EVIDENCE_RUN` remains
the parent for the overall verification run. Keep retained logs and drive scripts there too.

Capture a step with `.agents/skills/verify-piano/scripts/capture.sh "$RUN" <feature-id> <step>`.

The committed harness additionally records content identities, command/environment/journey and
outcome in `run.json`; see [capture scope and limitations](../../../docs/testing.md#file-evidence-provenance).
The manual shell flow below has its existing captures/logs, **not** that content fingerprint. Keep
its drive script and separately identify the tested changes/environment on the PR; invoking the
skill alone is not evidence.

Proof standards:

- Drive the user's path: the button, menu, route or CLI a user takes. Never set state through an
  internal setter, a test-only endpoint or a hand-edited database to make a journey pass.
- Capture the action and the resulting state: a capture before and after the step, plus the text
  that proves it (`wait --text`, the header, `get url`), not only a final screenshot.
- Verify side effects beside the screen: the fake-Pi audit (`$AUDIT`: what Pi was started with and
  received), `git -C "$REPO" worktree list`, `GET /api/folders`, files in `$REPO`.
- Fake Pi is the only mock: it stands at Piano's real process boundary (`PIANO_PI_CLI`). Git and
  Worktrunk are real. A fake-Pi run proves Piano's handling, not a Pi release.
- Say plainly what came from a hand-written Pi history (fake Pi makes no tool calls) or only from a
  unit test. A skipped entry point is reported as skipped, not as verified through another one.

## Cleanup

```bash
.agents/skills/verify-piano/scripts/cleanup.sh "$RUN"
```

It closes this run's browser session, sends TERM (KILL after 10 s) only to the PIDs in
`$RUN/pids` whose kernel start time still matches, confirms both ports are free, copies logs, audit,
`run.env` and `pids` into `$EVIDENCE/_run/`, deletes `$RUN` (only under the scratch root) and lists
the kept evidence. Stop only instances and browser sessions this run owns; leave unrelated ones
alone. Never kill by name (`pkill`, `pgrep -f`): other agents' scratch instances and the user's Piano
run the same `node server/main.ts`. Run Cleanup after every failed attempt too. The harness journeys
clean up their own instance and browser.

## Gotchas

- Radix menus and popovers open on pointer events: use `ab.sh ... click` / `find ... click`, never
  a DOM `.click()` from `eval`. Before clicking a submenu item, wait for its entrance animation:
  `ab.sh "$RUN" wait --fn "[...document.querySelectorAll('[role=menu]')].every(e => e.getAnimations({subtree:true}).every(a => a.playState !== 'running'))"`.
  A click during motion can hit another item. After choosing or Escape, wait for the menu's
  `[role=menu]` (or the specific popover) to disappear, not every Radix popper wrapper: a tooltip
  can remain on the focused trigger.
- A toast can cover a toolbar or row action. Dismiss its "Close toast" button, then wait for
  `!document.querySelector('[data-sonner-toast]')` before retrying; hovering a toast pauses its
  expiry, so waiting alone may not clear it.
- After filling the Mod+K query, wait for `'[cmdk-list][aria-busy="false"]'` before selecting
  an option. Pending results can still display a matching row but refuse its action.
- Opening a session or populated project home can start a Pi `probe` (audit `sessionId: "probe"`)
  for an uncached composer catalog; count only non-probe entries as user-driven Pi starts.
- Fake Pi writes no history: a session started on it is empty again after a backend restart.
  Seeded sessions keep their history.
- A detached Vite stops picking up edits after a while. If the UI shows old markup, compare
  `curl "$WEB_URL/src/components/ProjectHome.tsx"` with the same URL plus `?t=1`; when they differ,
  relaunch (cleanup, launch). A new browser session does not help.
- One backend per database: never point two launches, or the user's Piano, at the same `DB`.
- The origin check is not a login. Scripts must send `Origin: $ORIGIN` to change state; a 403 means
  a missing or wrong origin, not a broken server.
- If `ab.sh ... get url` answers `about:blank` or a command prints `launched browser` mid-journey,
  the browser session restarted: open the route again before asserting anything.
- `ab.sh` waits default to 25 s; a timed-out wait exits non-zero with `Wait timed out`.
- Times in the UI follow the browser's time zone (UTC on the VM), not the user's.
- On exe.dev, `piano.service` may carry an environment drop-in such as `PIANO_API_SOCKET` that this
  SHA does not read; launch unsets it so a scratch backend never shares a live socket path.
- A name that is only an `aria-label` (an icon button's, such as "Close answer.ts") is not page
  text: `wait --text` never sees it; wait on `'[aria-label="..."]'` instead.
## Keeping it current

When a journey fails because the app changed (a renamed button, a moved menu item, a new route),
update the feature file in the same change, never the assertion's intent. After changing launch
isolation, run `.agents/skills/verify-piano/scripts/test-launch-isolation.sh`: it dispatches through
real Worktrunk with owned stand-in user settings, asserts sibling worktree placement, and cleans up
its scratch run while retaining evidence.
