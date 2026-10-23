---
name: verify-piano
description: Launch an isolated scratch Piano (own database, Pi dirs and HOME, fake Pi, throwaway Git repo, backend plus Vite UI on free loopback ports), check it with a read-only doctor, drive the web UI with the repo's browser harness or a pinned npx agent-browser and the dispatch CLI, keep evidence that survives cleanup, and tear down by recorded PID. Also read-only health checks for a deployed instance on an exe.dev VM. Use whenever a Piano change needs its user-visible behavior proved.
---

# Verify Piano

Piano is a web UI (React + Vite) over a Node backend (`server/main.ts`) that starts Pi sessions in
folders and their worktrees. Users touch the browser UI; orchestrators also use the dispatch CLI
`scripts/dispatch-session.ts` and the `/ws` session socket. Prove behavior on a scratch instance
this skill starts, never on the user's own Piano (local `7070`; on exe.dev `piano.service` on
`127.0.0.1:8001` behind `piano-web` on `127.0.0.1:8000`), whose database is real.

All paths below are relative to the repository root. The scripts live in
`.agents/skills/verify-piano/scripts/`; `S=.agents/skills/verify-piano/scripts` below. On exe.dev
they put `~/node/bin` and `~/.local/bin` (Node 24, `wt`) on `PATH` themselves. The feature map in
[`features/README.md`](features/README.md) says what to drive; this file says how.

## Launch

```bash
S=.agents/skills/verify-piano/scripts
$S/launch.sh                      # seeded: folder repo, 2 projects, 2 saved sessions
$S/launch.sh --empty              # empty database: nothing registered
$S/launch.sh --fake-pi dialogs    # test/fake-pi.mjs: "ask ..." opens a dialog, "crash ..." exits
```

It needs `node_modules` (runs `npm ci` when missing) and nothing else. It creates
`/tmp/verify-piano/<run-id>/` (`VERIFY_SCRATCH` overrides the parent) holding:

- `db/piano.db`: a new database; Piano creates the schema on start. Seeded runs fill it first
  through `scripts/seed.ts` (the browser tests' own `test/fixtures/registry.ts`), because only one
  backend may own a database.
- `repo/`: a committed throwaway Git repo (`README.md`, `src/answer.ts`, `.gitignore` ignoring
  `ignored/`). Worktrees Piano creates appear beside it as `repo.<branch>`, still inside the run.
- `pi-agent/`, `pi-sessions/`, `home/`: `PI_CODING_AGENT_DIR`, `PI_CODING_AGENT_SESSION_DIR` and
  `HOME` for the backend, so `~/.pi`, Worktrunk's user config and the user's credentials are never
  read or written.
- `audit.jsonl`: every command the fake Pi received (`PIANO_TEST_AUDIT`).
- `logs/`, `pids`, `run.env`.

The backend runs `node server/main.ts` with `HOST=127.0.0.1`, `PIANO_PI_CLI=test/browser/fake-pi.mjs`
(echoes each prompt as `echo: <text>` with priced usage; a prompt of exactly `hold` runs until Stop;
no model calls), `PI_OFFLINE=1` and `PIANO_ALLOWED_ORIGINS=<ui>,<api>`. The UI is Vite from `web/`
with `PIANO_DEV_BACKEND` pointing at that backend. Both ports are free ports picked at launch
(`VERIFY_PORT` / `VERIFY_WEB_PORT` pin them); 7070, 8000, 8001 and 5173 are refused.

Ready means usable: launch waits until `GET /api/folders` answers, the UI serves its page and the
UI's `/ws` proxy delivers the registry with the UI's origin, then prints:

```
READY registry over ws://127.0.0.1:<ui-port>/ws: 1 folder(s)
api      http://127.0.0.1:<api-port>  (server pid <pid>)
ui       http://127.0.0.1:<ui-port>  (vite pid <pid>)
database /tmp/verify-piano/<run-id>/db/piano.db  seeded=1  fake-pi=browser
evidence /tmp/verify-piano-evidence/<run-id>
RUN=/tmp/verify-piano/<run-id>
```

Then `. "$RUN/run.env"` gives `RUN`, `EVIDENCE`, `REPO`, `DB`, `AUDIT`, `API_URL`, `WEB_URL`,
`ORIGIN`, `PORT`, `WEB_PORT`, `EXPECTED_SHA`, `AB_SESSION`, and exports `PIANO_SESSION_WS_URL` /
`PIANO_SESSION_ORIGIN` for the dispatch CLI. A launch that fails prints the log tail; run Cleanup on
the printed run dir anyway.

Seed data (seeded runs): folder `repo`; projects `verify` "Verify Project" and `empty` "Empty
Project"; sessions `verify-plan` "Plan the verification"
(project `verify`, saved PR link `#222`) and `verify-loose` "Loose session" (no project), each with
Pi history `What is 2 + 2? (<title>)` / `Answer 4.`; "Plan the verification" also holds one
successful Pi `write` of `src/answer.ts` (hand-written, since fake Pi makes no tool calls).

### A deployed instance

`https://<vm>.exe.xyz` (for example `https://pi-piano.exe.xyz`) is the owner's real Piano behind
exe.dev private access: it has no login of its own, and the origin check is its only write guard.
Target it read-only:

- From outside the VM: `$S/doctor.sh --deployed-auth pi-piano` expects `307` to
  `https://pi-piano.exe.xyz/__exe.dev/login`. A headless `agent-browser` has no exe.dev login, so it
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
$S/doctor.sh "$RUN"            # exit 0 = worth driving
$S/doctor.sh --deployed         # on the VM, read-only
```

For a scratch run it checks: both recorded PIDs alive with their recorded kernel start time and
working directory; each port owned by that PID (`ss -ltnp`); no real-Piano port in use; the
checkout still at `EXPECTED_SHA` (dirty paths noted, since they run too); the server log naming this
run's database; `GET /api/folders` listing only the throwaway repo (or nothing for `--empty`);
POST `/api/ls` refused without Origin (403) and allowed with `ORIGIN` (200), which is Piano's only
access control; the registry arriving over the UI's `/ws`; the fake-Pi command count.

For `--deployed`: `piano.service`, `piano-web.socket` and `piano-web.service` active; 8001 owned by
`piano.service`'s MainPID and 8000 by piano-web; the checkout SHA and whether it equals
`origin/main` as last fetched (it never fetches); whether HEAD moved after the service started or
after `web/dist` was built (then the running backend or UI predates the checkout); GETs on 8001 and
8000; the allowed origins.

## Drive

1. **The repo harness first.** The committed critical paths start their own scratch instance and
   browser, assert what a user sees and what Pi receives, and write screenshots into the directory
   given as the first argument:

   ```bash
   node test/browser/start-session.mjs "$EVIDENCE/harness-start-session"
   node test/browser/open-session.mjs "$EVIDENCE/harness-open-session"
   node test/browser/transcript-rows.mjs "$EVIDENCE/harness-transcript-rows"
   ```

   Each prints `PASS <name> (<s>), evidence in <dir>` and exits 0, or fails with the assertion.
   They do not need `launch.sh`. `npm run test:browser` runs all three into `.scratch/browser/`.

2. **Then `agent-browser` on the launched instance** for anything the harness does not cover,
   through `$S/ab.sh`, which runs `npx -y "agent-browser@${AB_VERSION}" --session "$AB_SESSION"`
   (npx cache only; never `npm i -g`, never a system package). `AB_VERSION` is pinned once, in
   `scripts/lib.sh`, and `cleanup.sh` closes the session with the same version:

   ```bash
   $S/ab.sh "$RUN" set viewport 1280 800
   $S/ab.sh "$RUN" open "$WEB_URL/projects/verify"
   $S/ab.sh "$RUN" wait --text "Plan the verification"
   $S/ab.sh "$RUN" find role button click --name "New session" --exact
   $S/ab.sh "$RUN" snapshot -i            # refs like @e9 for the current page only
   ```

   Stable handles, in order of preference: role plus accessible name (`find role <role> click
   --name <name> --exact`), `aria-label` selectors (`[aria-label="First message"]`,
   `[aria-label="Message"]`, `[aria-label="Send"]`), `data-slot` (`[data-slot=item]` cards,
   `[data-slot="gutter"]` transcript glyphs), `[cmdk-input]` (Mod+K palette), and routes (`/new`,
   `/s/<sessionId>`, `/projects/<id>`, `/projects/<id>/new`). Snapshot refs (`@e9`) change on every
   render; never reuse them across pages. Read the session header with
   `$S/ab.sh "$RUN" eval "document.querySelector('main header').innerText"`.

3. **The dispatch CLI** (`scripts/dispatch-session.ts`) after `. "$RUN/run.env"`; see
   [`features/session-dispatch.md`](features/session-dispatch.md).

4. **HTTP** for side effects, with `Origin: $ORIGIN` on anything but GET:
   `curl -s "$API_URL/api/folders"`;
   `curl -s -X POST -H "Origin: $ORIGIN" "$API_URL/api/workspace/changes?workspaceId=<id>"`.
   Workspace IDs come from `/api/folders` (`folders[].worktrees[].workspace.id`).

## Evidence

Evidence goes to `${TMPDIR:-/tmp}/verify-piano-evidence/<run-id>/` (`VERIFY_EVIDENCE` overrides
the parent), outside the run dir, so Cleanup keeps it. System temp cleanup may remove it later;
set `VERIFY_EVIDENCE` to a persistent directory when longer retention is needed.

```bash
$S/capture.sh "$RUN" <feature-id> <step>
# -> $EVIDENCE/<feature-id>/<step>.png, <step>.aria.txt, <step>.state.json
```

`state.json` records the URL, title, session header text and the fake-Pi command count at that
moment. Cleanup adds `_run/` (server and Vite logs, `fake-pi-audit.jsonl`, `run.env`, `pids`).

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
$S/cleanup.sh "$RUN"
```

It closes this run's browser session, sends TERM (KILL after 10 s) only to the PIDs in
`$RUN/pids` whose kernel start time still matches, confirms both ports are free, copies logs, audit,
`run.env` and `pids` into `$EVIDENCE/_run/`, deletes `$RUN` (only under the scratch root) and lists
the kept evidence. Never kill by name (`pkill`, `pgrep -f`): other agents' scratch instances and the
user's Piano run the same `node server/main.ts`. Run Cleanup after every failed attempt too. The
harness journeys clean up their own instance and browser.

## Gotchas

- agent-browser is pinned (`AB_VERSION` in `scripts/lib.sh`) so a new release never changes a
  journey under you. To bump it: `npm view agent-browser version`, set that exact version in
  `lib.sh`, check it with `VERIFY_AB_VERSION=<new> $S/ab.sh "$RUN" --version` and one proof run
  (launch, doctor, a drive, cleanup), then commit `lib.sh` alone. The repo harness
  (`test/browser/harness.mjs`) has its own `npx agent-browser` call outside this skill.

- Radix menus and popovers open on pointer events: use `ab.sh ... click` / `find ... click`, never
  a DOM `.click()` from `eval`. After choosing, wait for
  `!document.querySelector('[data-radix-popper-content-wrapper]')` before the next step.
- Opening a session page starts a Pi `probe` (audit `sessionId: "probe"`) for its composer; count
  only non-probe entries as user-driven Pi starts.
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
- The skill was proved on the exe.dev VM `pi-piano` (Linux, Node 24, Worktrunk 0.80). It relies on
  `/proc` and `ss`, so macOS needs other PID and port checks.

## Keeping it current

When a journey fails because the app changed (a renamed button, a moved menu item, a new route),
update the feature file in the same change, never the assertion's intent. Use
`/maintain-verification-skill` to bring this skill up to date after a feature lands.
