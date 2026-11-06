# Bundling configurable GitHub-owner trust in Piano

Research date: 2026-11-06. **Research only; nothing below is implemented by this note.**

## Answer

**Yes. Piano can bundle an adapted version and expose a list of trusted GitHub owners in
Settings.** Pi already supports this startup hook, and Piano already supplies installation-owned
extensions to every Pi child. No Pi fork or GitHub sign-in is required. However, do not ship this
extension unchanged: its owner is hard-coded, it permanently remembers trust, and it can override
an explicit saved refusal. Prefer an empty-by-default, Piano-instance-wide owner list, temporary
auto-trust, and precedence for explicit folder decisions. [E1], [P1], [P2], [H1]

Here **owner** means the first path segment of the checkout's `origin` GitHub URL: a personal
username **or organization name**. It does not mean the current GitHub login, Git commit author,
SSH login (`git@`), collaborator, PR author, or a Piano user. The source performs no GitHub account
lookup. This is convenience policy over local Git metadata, not authenticated provenance. [E1]

## Inspected revisions and method

| Source | Pinned revision |
| --- | --- |
| Piano, clean research worktree at start | `b46cb013f3de7a39a1d0b6bd4ad6ae470e8ccd30` |
| `goofansu/pi-stuff`, librarian checkout | `999c2caa97fb9c8fe7e7c264b568b2c4cb12c709` (manifest version 1.0.4) |
| Pi, Piano lockfile and installed package | 1.5.0; tag `v1.5.0` resolves to `f9a26365568127461c47a07a37dcb42c140a3ac5` |

Used the librarian checkouts for both upstream repositories. Read Pi's installed extension,
configuration, settings, packages, RPC and security documentation, plus the installed trust,
loader and CLI implementations. All six documentation files matched the pinned Pi tag byte for
byte; embedded source-map sources for `project-trust`, `trust-manager`, `resource-loader`,
`extensions/runner` and `main` also matched. The installed package inspected was under
`/home/exedev/piano/node_modules`; this research worktree has no installed dependencies. Piano's
lockfile independently resolves 1.5.0. [H2]

Read the upstream tests, but did not run them. Findings below are source-level conclusions,
not a real-Pi or browser compatibility claim (INV-09/12).

## Current upstream behavior

The complete decision is small: [E1], [E2]

```text
on project_trust(event.cwd):
  git remote get-url --all origin       # cwd = event.cwd, timeout = 5 seconds
  if successful, nonempty, and EVERY returned URL has owner "goofansu":
    return { trusted: "yes", remember: true }
  return { trusted: "undecided" }
```

- The only configured owner is `goofansu`. Comparison lowercases the parsed owner; there is no
  setting, environment variable, CLI flag, or runtime configuration API in this file.
- Accepted hosts/transports: HTTPS and URL-form SSH on `github.com`; SCP-style
  `[user@]github.com:owner/repo`; **HTTPS only** on `github.int.exe.xyz`. HTTP, `git://`, local
  paths, other hosts, and SSH/SCP on the exe.dev proxy are not accepted.
- URL paths must have two nonempty components. The URL branch decodes components, strips a
  trailing `.git`, and ignores URL credentials, port, query and fragment. This is not strict
  GitHub slug validation. The SCP branch does not percent-decode.
- It examines every **fetch** URL of `origin`, after Git URL rewrites. It does not examine an
  `upstream` remote or separately configured push URLs. One bad/unmatched origin causes
  deferral; no origin, Git failure or exception also defers. The five-second Git timeout is not
  necessarily a hard five-second wall-clock bound: Pi's process termination can escalate later.
  [G1], [P1]
- With normal Git environment discovery, Git resolves the repository from the event's directory,
  so nested directories and ordinary linked worktrees can use their repository's origin. The
  extension does not clear inherited `GIT_DIR`/`GIT_WORK_TREE` overrides or explicitly establish a
  non-bare worktree root. Its integration test clears `GIT_*`; the extension itself does not.
  Pi remembers the **event cwd**, not an owner/repository identity or necessarily the repository
  root. [E1], [E2], [P3]

**`undecided` is not a denial.** Another extension, saved trust or the global default can still
allow the folder. This extension is an auto-approval helper, not a GitHub allowlist that prevents
all other repositories from loading. [P2]

## Pi's actual trust boundary and precedence

For a fresh CLI runtime with protected resources, Pi applies: [P2], [P4], [P5]

```text
--approve / --no-approve override
  → first decisive user/global or CLI project_trust handler
  → nearest saved cwd/ancestor decision in <agent-dir>/trust.json
  → global defaultProjectTrust (ask / always / never)
```

Only user/global and CLI extensions participate before trust; a repository-local extension
cannot bootstrap approval for itself through this hook. The pre-trust pass disables project
settings/resources, loads eligible extensions, resolves trust, then loads the final resources.
The installed loader puts CLI extension paths before ordinary discovered extension paths. [P5]

RPC startup has **no trust-prompt UI**, even though ordinary running RPC extension dialogs are
supported. Without an override, decisive hook or saved decision, `ask` and `never` skip protected
resources; `always` loads them. The upstream extension needs no UI, so this limitation does not
block it. [P4], [P6]

Trust allows project settings, MCP servers, extensions, skills, prompts, themes, system-prompt
files and missing project packages. Protected resource detection includes `.pi` resources in
cwd and project `.agents/skills` up the ancestor chain; an empty `.pi` alone is insufficient.
`AGENTS.md`/`CLAUDE.md` context is **not** gated, and Pi reads project `sessionDir` before trust.
Trust does not restrict shell/file tools or isolate extensions: extension code runs with Pi's
OS permissions and can access its credentials. [P3], [P4]

### Consequences of bundling the unmodified extension

1. **It can override “Untrusted.”** The hook runs before the saved decision and global `never`.
   Matching origins return yes and write a new true entry, potentially replacing a saved false
   at cwd or overriding a false ancestor with a more specific true. [E1], [P2], [P3]
2. **Disabling it does not undo its approvals.** `remember: true` writes a canonical-path boolean
   into Pi's shared `trust.json`. Later owner-list removal or an origin change merely makes the
   hook defer; the saved true can still win. Saved trust applies to descendants through nearest
   ancestor lookup. There is no source/owner attribution in that store. [P2], [P3]
3. **Standalone Pi is affected by remembered decisions.** Piano and terminal Pi normally share
   the same agent directory. Merely loading a bundled extension only affects Piano children,
   but the extension's saved trust outlives them and reaches other Pi processes. [H3], [P3]
4. **An origin URL is writable local metadata.** A different checkout can be given a matching
   origin, or an allowed repository can contain unreviewed local edits, a fetched PR branch,
   compromised dependencies or hostile project configuration. No network request verifies the
   repository, branch, commit, owner or local content. A GitHub API check of repository existence
   alone would not prove that the local files came from it. [E1], [G1] (security inference)
5. **Trust is not continuously re-evaluated.** Pi caches resolved trust by cwd within the process;
   ordinary reload preserves its trust state. Removing an owner cannot unload already executed
   extension code or revoke a running process's OS access. Use a new Pi process for a changed
   policy; do not promise `/reload` revocation. [P5], [P6]

Accept this only as an explicit trusted-developer convenience, never as approval of every
contributor's code, authorization to merge/deploy, or a sandbox. This follows Piano INV-01/11/12
and its existing private, single-user execution model. [A1], [P4]

## Concrete Piano integration seams

These are existing seams, **not existing support for an owner setting**.

| Concern | Current code and implication |
| --- | --- |
| Bundled code | `server/PiCli.ts` resolves `extensions/<name>/index.ts` from Piano's installation. `PiTransport.spawn` passes each absolute path with `--extension`, before session/extra arguments. An adapted `piano-github-trust` can use the same mechanism; repository files cannot shadow its entry point. [H1] |
| Distribution precedent | Piano already pins and directly loads `pi-claude-code` as a dependency, without a startup `pi install` or global Pi-settings mutation. First-party extensions are source directories shipped with Piano. [H1], [H2], [H4] |
| Settings ownership | `PiSettings` changes native model/thinking defaults using Pi's `SettingsManager`; `ProjectTrust` reads/writes Pi's trust store. Keep those Pi-owned. A new Piano-only owner policy belongs in Piano's database, not a fictional native Pi setting, browser local storage, project instructions or `.pi/settings.json`. There is no owner-list field today; persistence would require a deliberate schema/API addition. [H3], [H5], [A1] |
| Settings UI/API | `SettingsPage.tsx` and `web/src/lib/routes.ts` own settings navigation; `shared/http.ts`, `Router.ts` and `PianoServices.ts` define/serve typed settings endpoints. Add one small policy surface there, rather than an extension-management framework. [H6] |
| Launch configuration | `PiCliConfig.env` and `PiTransport.spawn` provide child launch values; `ChildEnvironment.ts` strips the names in `shared/dispatch.ts`'s `LAUNCH_ENV`. Supply a validated snapshot on **each spawn**, including probes. Do not capture it only once in `main.ts`'s startup `Launch` layer. A new launch variable must be added to the stripping contract. [H1], [H7] |
| Probes and caches | `PiSessions.probe` uses the same extension launch path, so directory model/command discovery can trigger trust and load protected code before the first user prompt. Global-only probes pass `--no-approve`, which bypasses the hook. A policy save must invalidate `DirectoryFacts` caches and browser projections. [H8] |
| Trust display | `ProjectTrust.projectTrust` currently predicts from required resources, saved decisions and the global default; it does not run extension policy. The New-page toggle/palette displays that prediction. `DirectoryFacts.setTrust` re-reads the store after a probe because personal extensions can change it. A nonpersistent hook would otherwise make the display say “Untrusted” while Pi loads the resources. This mismatch must be addressed, not hidden by `remember: true`. [H3], [H8], [H9] |

The policy evaluation should be shared by the bundled adapter and launch-policy projection,
using Pi's own store/settings APIs rather than reimplementing their parsers. A projection is not
proof of a running Pi's effective state: other extensions and overrides can decide differently.
If showing effective live trust, report it from Pi through the adapter and existing PiSessions
translation seam; otherwise explicitly describe the display as policy for the next launch.
Do not report a settings save as having changed a running session. (Proposed contract; INV-01/12.)

## Recommended minimal design — proposal

1. **One bounded list of owners**, accepting personal and organization names. Default `[]`
   means no automatic approval by this adapter. Never prefill `goofansu` or infer consent from
   `gh auth status`/Git identity. Normalize case, trim, deduplicate, and reject URLs, slashes,
   wildcards and malformed names. A single owner is simply a one-item list.
2. **Scope: one Piano instance/database**, across its folders, worktrees, named projects and
   sessions—not per browser or checkout. Persist only policy, not a second folder-trust store.
   Native manual decisions stay in Pi's store. Separate Piano databases have independent lists;
   shared Pi agent directories still share manual trust.
3. **Bundle a small adapted copy**, keep attribution, and pass a bounded JSON owner-list snapshot
   through a Piano-owned launch variable (proposed name `PIANO_TRUSTED_GITHUB_OWNERS`). Unset or
   malformed configuration must not cause an automatic yes. Do not read the list from the
   repository, run shell interpolation, fetch GitHub identities or install packages to decide it.
4. **Keep exact hosts**, initially the existing `github.com` forms and HTTPS
   `github.int.exe.xyz`. This explicitly treats the exe.dev proxy path's owner as the same
   namespace. No configurable arbitrary host/wildcard in v1. Tighten parsing to canonical
   owner/repository slugs; reject credentials, queries/fragments, unexpected ports and encoded
   separators rather than accidentally supporting upstream's permissive URL edge cases. Use a
   bounded, no-shell Git read with checkout-selection environment overrides cleared, following
   Piano's existing `GitEnvironment.ts` policy, and retain the all-origins requirement. [H10]
5. **Preserve explicit refusals; do not persist auto-approvals.** The adapter should apply this
   deliberate departure from upstream behavior:

   ```text
   Pi CLI override applies before the hook
   hook:
     nearest Pi saved decision exists → return that yes/no, without remembering
     native global default is never → return no, without remembering
     list nonempty AND every origin fetch URL matches → yes, without remembering
     otherwise → undecided (normal Pi fallback)
   ```

   Read saved decisions with `ProjectTrustStore`, and the global default with `SettingsManager`
   in an untrusted-project context. On unreadable trust/policy state, do not auto-approve; show a
   useful diagnostic. Returning an existing false/no rather than merely deferring also prevents
   later hooks from undoing that refusal, provided no earlier hook already decided. Other
   user-installed extensions are trusted code, so this is not universal enforcement.
6. **Apply to future Pi launches and probes only.** Save without restarting active sessions;
   invalidate catalog/command policy caches. State that continuing an already-live Pi keeps
   its old decision, and that a fresh process is needed. Removing an owner stops future
   automatic grants, but does not revoke manual/previously remembered trust or stop processes.
7. **Keep the folder override usable and explain the source.** Show whether next-launch trust
   comes from the owner rule or a saved choice, not an unexplained boolean. “Untrust” must save
   false and beat the owner rule. Existing saved true values are indistinguishable from old
   extension-generated true values; do not bulk-delete them on upgrade or owner removal.

Before enabling this variant, disable any separately installed upstream `trust-github-repos.ts`
for the same Pi environment. A second copy can still grant and remember `goofansu` when the
Piano list is empty or no rule matches. Pi deduplicates resource paths, not two differently
located adaptations; first decisive handler wins. Do not silently remove users' packages. [P1],
[P2], [P5], [H4]

If the desired promise is instead “only run code authenticated as written by this person,” this
extension is the wrong mechanism. That requires a separate provenance/review and execution
isolation design, not a username setting.

## Licensing and packaging

`pi-stuff` declares MIT and includes **Copyright (c) 2026 Yejun Su**. MIT permits copying,
modification and distribution provided the copyright and permission notice accompany copies or
substantial portions. Preserve the full license alongside a vendored adaptation and record the
source commit and intentional behavior differences. This source inspection identifies no license
blocker to bundling. [E3]

The file imports only Pi types and calls Pi's existing execution API; it requires Git on `PATH`,
not a new GitHub credential or runtime library. Pin/review source updates: the package's wildcard
Pi peer dependencies are not compatibility evidence. Do not load the whole `pi-stuff` package
by default: its manifest exposes **all** extensions and skills, far beyond this feature. [E1],
[E3], [P7]

Vendoring this small configurable adaptation is the smallest self-contained option. A pinned
package dependency plus direct-file loading is possible, but the unchanged upstream file still
has no way to receive owners; wrapping its factory does not replace its closed-over set. A
configurable upstream contribution could later reduce maintenance. No need for startup downloads,
a Pi fork or changes to native `defaultProjectTrust`. (Recommendation, not implementation.)

## Verification and limits

**Claim checked:** current sources support bundling this hook and explain its real trust scope;
the recommendation preserves Pi-owned trust and makes scope/lifecycle explicit (INV-01/11/12).
Smallest useful check for this documentation-only change: inspect the pinned source chain, compare
installed Pi against its tag, review citations and the diff. No application code, settings, trust
file, database or deployment was changed; no app, test suite, model call or authentication flow
was run. Source review environment: exe.dev, Linux x86_64, Node v26.13.0, Git 2.43.0.
All 37 pinned GitHub file links were checked against their local Git trees. The repository's
formatter excludes `docs/**`, so a targeted formatter invocation selected no files; it is not
claimed as a passing lint run. The documentation diff was checked separately.

A future implementation would still need the repository's typecheck/lint/tests and an isolated
scratch journey. Prioritize empty-list behavior; case/org and mixed-origin matching; proxy and
malformed URLs; saved false/ancestor and global-never precedence; removal without trust-file
writes; old duplicate-extension behavior; probe/display agreement; restart versus live-process
behavior; and malformed/unreadable configuration. The upstream tests do not establish any of
those proposed Piano integration contracts. [E2]

## Primary sources

All GitHub links pin the inspected revisions; Git's official manual is the retrieved web reference.

- [E1 — extension source](https://github.com/goofansu/pi-stuff/blob/999c2caa97fb9c8fe7e7c264b568b2c4cb12c709/extensions/trust-github-repos.ts)
- [E2 — upstream tests (read, not run)](https://github.com/goofansu/pi-stuff/blob/999c2caa97fb9c8fe7e7c264b568b2c4cb12c709/tests/trust-github-repos.test.ts)
- E3 — [MIT license](https://github.com/goofansu/pi-stuff/blob/999c2caa97fb9c8fe7e7c264b568b2c4cb12c709/LICENSE), [package manifest](https://github.com/goofansu/pi-stuff/blob/999c2caa97fb9c8fe7e7c264b568b2c4cb12c709/package.json)
- [P1 — Pi extension APIs, `project_trust` and `pi.exec`](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/coding-agent/docs/extensions.md)
- P2 — [trust resolver](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/coding-agent/src/core/project-trust.ts), [handler dispatch](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/coding-agent/src/core/extensions/runner.ts)
- [P3 — trust store and resource detection](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/coding-agent/src/core/trust-manager.ts)
- [P4 — Pi security/trust contract](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/coding-agent/docs/security.md)
- [P5 — pre-trust and final resource loading](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/coding-agent/src/core/resource-loader.ts)
- [P6 — CLI startup trust context and per-cwd cache](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/coding-agent/src/main.ts)
- [P7 — package distribution and selective resources](https://github.com/earendil-works/pi/blob/f9a26365568127461c47a07a37dcb42c140a3ac5/packages/coding-agent/docs/packages.md)
- H1 — [PiCli](https://github.com/goofansu/piano/blob/b46cb013f3de7a39a1d0b6bd4ad6ae470e8ccd30/server/PiCli.ts), [PiTransport](https://github.com/goofansu/piano/blob/b46cb013f3de7a39a1d0b6bd4ad6ae470e8ccd30/server/PiTransport.ts)
- H2 — [manifest](https://github.com/goofansu/piano/blob/b46cb013f3de7a39a1d0b6bd4ad6ae470e8ccd30/package.json), [lockfile](https://github.com/goofansu/piano/blob/b46cb013f3de7a39a1d0b6bd4ad6ae470e8ccd30/package-lock.json)
- [H3 — Piano's Pi-owned trust adapter](https://github.com/goofansu/piano/blob/b46cb013f3de7a39a1d0b6bd4ad6ae470e8ccd30/server/ProjectTrust.ts)
- [H4 — Piano bundling, configuration and storage](https://github.com/goofansu/piano/blob/b46cb013f3de7a39a1d0b6bd4ad6ae470e8ccd30/docs/configuration.md)
- H5 — [PiSettings](https://github.com/goofansu/piano/blob/b46cb013f3de7a39a1d0b6bd4ad6ae470e8ccd30/server/PiSettings.ts), [Registry](https://github.com/goofansu/piano/blob/b46cb013f3de7a39a1d0b6bd4ad6ae470e8ccd30/server/Registry.ts), [RegistryDatabase](https://github.com/goofansu/piano/blob/b46cb013f3de7a39a1d0b6bd4ad6ae470e8ccd30/server/RegistryDatabase.ts)
- H6 — [SettingsPage](https://github.com/goofansu/piano/blob/b46cb013f3de7a39a1d0b6bd4ad6ae470e8ccd30/web/src/components/SettingsPage.tsx), [routes](https://github.com/goofansu/piano/blob/b46cb013f3de7a39a1d0b6bd4ad6ae470e8ccd30/web/src/lib/routes.ts), [HTTP contract](https://github.com/goofansu/piano/blob/b46cb013f3de7a39a1d0b6bd4ad6ae470e8ccd30/shared/http.ts), [Router](https://github.com/goofansu/piano/blob/b46cb013f3de7a39a1d0b6bd4ad6ae470e8ccd30/server/Router.ts), [services](https://github.com/goofansu/piano/blob/b46cb013f3de7a39a1d0b6bd4ad6ae470e8ccd30/server/PianoServices.ts)
- H7 — [launch wiring](https://github.com/goofansu/piano/blob/b46cb013f3de7a39a1d0b6bd4ad6ae470e8ccd30/server/main.ts), [child environment](https://github.com/goofansu/piano/blob/b46cb013f3de7a39a1d0b6bd4ad6ae470e8ccd30/server/ChildEnvironment.ts), [launch-variable contract](https://github.com/goofansu/piano/blob/b46cb013f3de7a39a1d0b6bd4ad6ae470e8ccd30/shared/dispatch.ts)
- H8 — [PiSessions probes](https://github.com/goofansu/piano/blob/b46cb013f3de7a39a1d0b6bd4ad6ae470e8ccd30/server/PiSessions.ts), [DirectoryFacts](https://github.com/goofansu/piano/blob/b46cb013f3de7a39a1d0b6bd4ad6ae470e8ccd30/server/DirectoryFacts.ts)
- H9 — [New-page trust toggle](https://github.com/goofansu/piano/blob/b46cb013f3de7a39a1d0b6bd4ad6ae470e8ccd30/web/src/components/NewSession.tsx), [trust projection](https://github.com/goofansu/piano/blob/b46cb013f3de7a39a1d0b6bd4ad6ae470e8ccd30/web/src/lib/directoryTrust.ts)
- [H10 — Git environment policy](https://github.com/goofansu/piano/blob/b46cb013f3de7a39a1d0b6bd4ad6ae470e8ccd30/server/GitEnvironment.ts)
- A1 — [ADR 0001](https://github.com/goofansu/piano/blob/b46cb013f3de7a39a1d0b6bd4ad6ae470e8ccd30/docs/adr/0001-pi-rpc-workspace-workbench.md), [invariants](https://github.com/goofansu/piano/blob/b46cb013f3de7a39a1d0b6bd4ad6ae470e8ccd30/docs/development-invariants.md), [roadmap](https://github.com/goofansu/piano/blob/b46cb013f3de7a39a1d0b6bd4ad6ae470e8ccd30/docs/roadmap.md)
- [G1 — official `git remote` manual, `get-url`/`set-url`](https://git-scm.com/docs/git-remote) (retrieved 2026-11-06)
