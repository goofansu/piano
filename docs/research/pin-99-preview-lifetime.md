# PIN-99 verification: Pi-owned preview lifetime

- Issue: [PIN-99](https://linear.app/goofansu/issue/PIN-99/tie-managed-preview-lifetime-to-its-owning-sessions-pi-process).
- Tested runtime code: `976720654e245a3f992134f358f8d3eeba9c5afa`, based on main `2eeaa0d`.
  Final module gates also include the focused idle/start race test in `PreviewOwner.test.ts`,
  Git blob `a56cedf4ed53b7d81eb4fe2a5bc1462b77423fc8`. The following verification commit adds that
  test and documentation/artifacts only; browser journeys used the identical runtime code.
- Completed 2026-10-23 UTC on Linux 6.12.113 x86_64, Node v24.22.0, systemd 255
  (255.4-1ubuntu8.17), Pi 1.4.0, Effect 4.0.5, agent-browser 0.39.2.
- Scope: INV-01/02/05/06/07/11/12/13; [ADR 0003](../adr/0003-pi-owned-preview-lifetime.md).
  No deployed process, route, sharing, live checkout or real Pi history was changed.

## Commands and retained output

All commands exited 0 on the tested revision:

| Command | Result |
| --- | --- |
| `npm run typecheck` | Server and web passed. |
| `npm run lint` | Biome and Tailwind ESLint passed. |
| `npm test` | 1032 tests: 1017 passed, 15 skipped, zero failures/cancellations. |
| `node test/browser/start-session.mjs <evidence-dir>` | PASS, 28.6s. |
| `node test/browser/open-session.mjs <evidence-dir>` | PASS, 93.8s. |
| `node test/browser/preview.mjs <evidence-dir>` | PASS, 134.2s, native systemd. |

[Command output](pin-99-preview-lifetime/verification.txt) retains gate summaries, relevant module
assertions and browser stdout. [Native observations](pin-99-preview-lifetime/observations.json)
retain preview/owner generations, launch identities, process IDs and cleanup measurements. Full
logs/screenshots are also retained in this worktree's `.scratch/pin99-evidence/`, including
`preview-final/` and the two critical browser journey directories. Scratch processes/state were
removed by the harness; all Pi history used isolated scratch directories, not `~/.pi/agent/sessions`.

## Native browser journey

Real installed Pi used a scripted loopback model, with no external model calls or credentials.
Scratch HOME, Pi directories, database and preview state were isolated. The app was a foreground
Node launcher running Vite plus a child that deliberately ignored SIGTERM; the launcher also
ignored SIGTERM. The journey recorded all three PIDs and required each to stop within 15s.
Browser interactions used `npx agent-browser`, not internal UI state mutation.

Observed:

1. Prompt → bundled tool → ready link; canonical workspace and instance/owner identity matched.
   App loaded locally in a browser, and editing HTML updated it through HMR without manual reload.
2. Settlement, composer Stop, browser close and session switching retained the same instance.
   With `PIANO_IDLE_MINUTES=0.0333333333`, four seconds disconnected did not retire the owner.
3. Exact tool stop confirmed cleanup. Pi then retired normally under that short idle timeout.
   A subsequent explicit launch used a new generation and instance.
4. Pi SIGKILL cleaned the launcher, Vite and stubborn child without a browser or reopen.
5. Scratch Piano SIGTERM and, separately, SIGKILL cleaned the preview before restarting Piano.
   Reopening saved history did not relaunch/adopt the old app.
6. Archive and Delete through the command palette (Delete confirmed) cleaned app and children.
   Removing the scratch checkout before Archive did not prevent cleanup by retained identity.

| Observation | Time until all three app PIDs were non-running |
| --- | ---: |
| Owning Pi SIGKILL | 5028 ms |
| Piano SIGKILL, before restart | 5327 ms |
| Archive | 5028 ms |
| Delete | 5230 ms |
| Archive after checkout removal | 5027 ms |

Explicit tool stop and graceful Piano shutdown had already cleaned their children by the time their
calls returned (the following checks took 1ms and 0ms respectively). Those are **not** total stop or
shutdown durations. Process polling excludes zombies; it does not confuse an exited, unreaped child
with running application code. The mechanism is transport exit / kernel socket EOF followed by
systemd main-process exit and its five-second cgroup kill grace, not an extension shutdown callback.

## Focused contracts and failure evidence

`PreviewOwner.test.ts` runs both systemd and launchd adapter contracts on this Linux host, retaining
real filesystem locking/records and replacing supervisor commands only. It proves:

- Trusted context ignores forged tool workspace/owner fields; endpoints are not exposed in tool
  output. Same-workspace competitors cannot reuse, replace or stop another live owner's app,
  including a failed app. Different workspaces allocate independently.
- Starting/active/failed-observation states guard idle; explicit stop or confirmed exit permits it.
- Cleanup failure retains exact intent, is retryable and fences new launches; checkout deletion
  does not prevent cleanup. Old-generation cleanup cannot stop a later generation.
- Client abort does not cancel/repeat admitted work. Replacement versus idle/release races end
  with both old and in-flight owned launches cleaned.
- Late runners cannot spawn against a dead endpoint or another generation.
- Legacy independent records are neither adopted nor automatically stopped; standalone exact stop
  remains the recovery path. Standalone launch without a live owner is refused.

The public `SessionHosts` test injects a corrupt scratch preview intent and observes Archive and
Delete both fail without changing retention or killing the still-available Pi. Repairing that
scratch intent allows explicit release to retry. Existing public lifecycle/readback/race tests pass.
`Preview.test.ts` retains original validation, exact-instance replacement/stop, listener ownership,
minimal environment, bounded/redacted logs, allocation and interrupted-submission coverage.

Mutation check: removing the generation guard in `PreviewAdapter.retire` made both supervisor
versions of “late cleanup cannot stop a replacement generation” fail (`2 !== 1` stop operations).
Restoring the guard passed the focused suite and final full suite. Raw failing output is retained
at `.scratch/pin99-evidence/mutation-generation-fence.log`; this was a deliberate local mutation,
not a production change or a claim that PIN-94 implemented the new contract.

## Limits and migration

- **Native macOS/launchd was not run.** The 15 existing host-native launchd listener/supervisor tests
  are skipped on Linux; portable lifecycle/legacy contracts for launchd passed. Native process-group
  leadership, owner-loss KILL, asynchronous bootout and log/listener behavior still need the same
  opt-in journey on a logged-in Mac. Do not treat simulated commands as native verification.
- macOS cleanup is a process-group contract: deliberately daemonizing/`setsid` children are outside
  support. Linux cgroups cover the app's descendants. Neither platform is a hostile-code sandbox.
- The 15-second test deadline is an observed operational bound, not a hard real-time promise under
  a frozen OS/supervisor or uninterruptible kernel I/O. No application expiry timer was added.
- Authenticated external exe.dev browser access was not tested; local browser load/HMR and owned
  Host-header readiness were tested. No routing/sharing changes were made.
- Legacy migration was checked through both adapter contracts, not by modifying deployed legacy
  services. Follow [stop-before-upgrade/recovery](../live-previews.md#upgrading-from-pin-94).
  Preserve state/config, stop legacy apps explicitly, and do not run mixed helper versions.
- No deployment, dependency upgrade, preview UI, new Stop session control or paid model call.
