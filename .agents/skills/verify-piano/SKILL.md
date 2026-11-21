---
name: verify-piano
description: Launch an isolated scratch Piano (own database, Pi dirs and HOME, fake Pi, throwaway Git repo, backend plus Vite UI on free loopback ports), check it with a read-only doctor, drive the web UI with the repo's browser harness or the installed agent-browser and the dispatch CLI, keep evidence that survives cleanup, and tear down by recorded PID. Also read-only health checks for a deployed instance on an exe.dev VM. Use whenever a Piano change needs its user-visible behavior proved.
---

# Verify Piano

Prove behavior on a scratch instance this skill starts, never on the user's own Piano (local
`7070`; exe.dev `127.0.0.1:8000`/`8001`), whose database is real.

Paths are relative to the repository root. Write each script path out in full: a worktree-isolated
session refuses a command whose name comes from a variable. [`features/README.md`](features/README.md)
says what to drive; this file says how.

## Run limits

Keep at most one scratch Piano instance and at most one browser session active for a verification
run. Drive checks serially, reusing that instance and browser across the run. Before replacing
either, finish teardown of the previous run-owned resource using [Cleanup](#cleanup), preserving
its [evidence](#evidence). If teardown cannot be confirmed, stop and report the blocker rather than
start a replacement.

## Launch

First allocate an [evidence run](../../../docs/testing.md#evidence-directories) in this shell and let
any harness journey finish its cleanup. Then run `.agents/skills/verify-piano/scripts/launch.sh`
(`--help` lists `--empty` and `--fake-pi`; `VERIFY_GH_CLI=<path>` supplies a stand-in `gh`).

Install the [development prerequisites](../../../README.md#develop), including agent-browser and
Chromium, first.

Only the default `test/browser/fake-pi.mjs` writes the audit (`$AUDIT`); on `--fake-pi dialogs` and
`ask` prove what Pi received from its replies instead.
Then `. "$RUN/run.env"` (written by `launch.sh`). After a failed launch, run Cleanup on the printed
run dir anyway.

Seed data: `.agents/skills/verify-piano/scripts/seed.ts`.

### A deployed instance

`https://<vm>.exe.xyz` is the owner's real Piano behind exe.dev private access: it has no login of
its own, and the origin check is its only write guard. The Piano VMs are the ones `ssh exe.dev ls
--json` tags `goofansu-piano` (for example `eng-1`). Target them read-only:

- Where `ssh exe.dev` works: `.agents/skills/verify-piano/scripts/doctor.sh --deployed-auth eng-1`
  requires exe.dev to report eng-1 private on port 8000 with no other shares; a `share show`
  failure usually means no such VM. A headless `agent-browser` has no exe.dev login, so it
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

1. **The repo harness first.** The committed critical paths (`npm run test:browser`,
   `package.json`) start their own scratch instance and browser and write evidence into the
   directory given as the first argument. Run them one at a time before Launch or after Cleanup,
   and inspect `run.json`, not just the exit code.

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
- Fake Pi is the only mock: it stands at Piano's real process boundary (`PIANO_PI_CLI`). Git is
  real. A fake-Pi run proves Piano's handling, not a Pi release.
- Say plainly what came from a hand-written Pi history (fake Pi makes no tool calls) or only from a
  unit test. A skipped entry point is reported as skipped, not as verified through another one.

## Cleanup

```bash
.agents/skills/verify-piano/scripts/cleanup.sh "$RUN"
```

Stop only instances and browser sessions this run owns. Never kill by name (`pkill`, `pgrep -f`):
other agents' scratch instances and the user's Piano run the same `node server/main.ts`. Run
Cleanup after every failed attempt too. The harness journeys clean up their own instance and
browser.

## Gotchas

- Menus and popovers open on pointer events: use `ab.sh ... click` / `find ... click`, never
  a DOM `.click()` from `eval`. An opened menu reaches the accessibility tree a frame later, so
  wait for an item's text before `find role menuitem click`. Before clicking a submenu item, wait
  for its entrance animation:
  `ab.sh "$RUN" wait --fn "[...document.querySelectorAll('[role=menu]')].every(e => e.getAnimations({subtree:true}).every(a => a.playState !== 'running'))"`.
  A click during motion can hit another item. After choosing or Escape, wait for the menu's
  `[role=menu]` (or the specific popover's `data-slot`) to disappear: a tooltip can remain on the
  focused trigger.
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
  `curl "$WEB_URL/@fs$PWD/features/projects/web/ProjectHome.tsx"` with the same URL plus `?t=1`; when they differ,
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
update the feature file in the same change, never the assertion's intent.
