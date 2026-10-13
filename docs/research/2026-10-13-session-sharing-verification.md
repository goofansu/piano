# Radius session sharing — implementation evidence

The original per-share artifact behavior below is superseded by
[stable session share links](2026-10-13-stable-session-share-links.md).

## Claim and boundary

User request: offer Share between Pin and Archive in sidebar session menus and in the command
palette, only when Radius is signed in; determine whether Radius MCP is needed.

Implemented organization-only publication, matching the Radius audience of Pi 1.1.0 `/share`.
Radius MCP is not needed. Pi's `ModelRuntime` lists credential metadata and resolves/refreshes
request auth; the server calls the artifact API directly. Browser sign-in observations refresh after
Piano sign-in/out, window focus, reconnect and every 30 seconds. Unknown/failed observations hide
Share; the server rechecks sign-in regardless of client state.

Preserved contracts: **INV-01/02/07/11/12**. Pi remains authoritative for history. Under the existing
SessionHosts ownership lock, Pi's public parser and in-memory SessionManager select the saved branch
without starting a writer or rewriting legacy history. Active work is rejected. No new RPC command
or interactive `/share` prompt is invented. Shared native JSONL passes the same heuristic secret
redaction used for display. Paths are resolved from registered workspace/session IDs, never URLs.
Credentials and remote error bodies remain server-only. No registry transcript/artifact store.

The confirmation states the audience and content scope. It binds to the requested session rather
than following later navigation. Cancel uploads nothing. Success requires a decoded organization
artifact response with a safe Radius HTTPS URL and valid expiry, then offers Open and Copy link.
Duplicate clicks are blocked and overlapping requests for the same session join one upload.
Publication is server-owned with a one-minute deadline, not cancelled by browser disconnect.
Uncertain upload results are not automatically retried. A subsequent explicit share creates a new
artifact. The 10 MiB upload bound is Piano policy, not a discovered Radius limit.

## Verification

Environment: Node 24.21.0, installed Pi 1.1.0, Linux, agent-browser/Chromium. Tested base `51d7a89`
plus this patch; final gate rerun includes the legacy-history and active-work regression cases.
Rebased cleanly onto `5fca021` before push: upstream changes were documentation-only, with no
application, dependency or test changes, so the verified code patch is unchanged.

- `npm test`: **474 passed**, 0 failed/skipped. `/tmp/piano-share-tests.log`.
- `npm run typecheck`: passed. `/tmp/piano-share-typecheck.log`.
- `npm run lint`: passed. `/tmp/piano-share-lint.log`.
- `npm run test:browser`: both critical paths passed (start and open/continue/stop).
  `/tmp/piano-share-browser/critical.log`, screenshots in
  `/tmp/piano-share-browser/critical-evidence/`.
- Focused HTTP/module tests in `test/SessionSharing.test.ts`: sign-in recheck; sanitized auth and
  upload errors; active-branch selection and secret filtering; unchanged native/legacy source files;
  no agent startup; in-flight work rejection; concurrent upload coalescing; malformed/unsafe/public
  responses rejected; timeout abort; unknown/missing history and stale signed-out callers blocked.
  `test/SessionCommands.test.ts` covers the conditional catalog, ordering and session identity.
- Scratch-browser journey on backend **7171**, Vite **7172**: signed-out menu and palette hide Share;
  signed-in menu order is Rename, Pin, separator, Share, separator, Archive, Delete, separator,
  Project; Cancel uploads nothing; an unselected row shares that row; palette shares the selected
  session; link/copy success; sanitized upload failure; mobile confirmation; signing out while the
  dialog is open disables publication. Confirmed no `mcp.json` and no model prompts.
  `/tmp/piano-share-browser/run.log` and `/tmp/piano-share-browser/evidence/` (nine screenshots).
  The throwaway script is retained locally, not committed.
- Source/diff review: auth stays on the server; only registered session identities reach capture;
  no automatic publish-on-open/reconnect; no second Pi writer; no intentional edits under `ui/`.

Scratch processes were stopped by their owned PIDs and scratch registries, repositories and Pi
history removed by the harness. Critical browser screenshots were moved out of the checkout.
No production registry, backend or built UI was touched, and nothing was deployed.

## Limitations

Uploads and account credentials were synthetic. The browser used Pi's real credential resolver
with a scratch credential and intercepted Radius HTTP; module tests replaced only auth/network
boundaries while keeping history, registry, ownership and routing real. No real transcript was
published. Actual Radius permissions, service quotas, canonical URL behavior and native viewer
fidelity still need an explicitly authorized live synthetic-upload smoke check. No live-upload
success is claimed.

This is a saved-branch snapshot, not a live mirror. It includes instructions already saved by Pi,
but does not append Pi interactive mode's fresh `pi.share` metadata, and has no GitHub fallback.
Heuristic redaction cannot remove all secrets (including secrets inside images). A lost response
or restart can leave an artifact on Radius without a recovered URL; the error instructs the user
to inspect Radius before another publication. Links are not persisted in Piano.

## Concise confirmation follow-up

On `f5d0055` plus the dialog-only patch, replaced the long session-title repetition and explanatory
paragraph with a short snapshot/audience description and the same Alert composition used for
provider sign-in: Info icon, “Check for secrets”, and the included-content reminder. Upload behavior
is unchanged (INV-11). No new regression test is needed for copy and standard component composition.

`npm test` (474 passed) and `npm run typecheck` passed; pre-commit lint passed. The same scratch
browser journey passed on desktop and 390×844 mobile, including confirmation, Cancel, successful
copy, error and sign-out states. Its final rerun includes a shorter callout title after screenshot
review caught mobile truncation. Evidence: `/tmp/piano-share-browser/concise-run.log` and
`/tmp/piano-share-browser/concise-evidence/`; gate logs: `/tmp/piano-share-concise-{tests,typecheck}.log`.
Same synthetic credentials/upload boundary and cleanup as above; no live publication or new deploy.

After rebasing onto `bbc60bb` (unrelated Worktrunk updates), reran all gates: 475 tests, typecheck
and lint passed. Logs: `/tmp/piano-share-concise-rebased-{tests,typecheck,lint}.log`. The Share
component and its browser-tested patch were unchanged by the rebase.
