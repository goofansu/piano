# Development

## Setup

Use Node.js 24, npm and Git. Browser checks also need `agent-browser` on `PATH` and its Chromium:
`agent-browser install`.

## Develop on exe.dev

On an exe.dev VM, push through the VM's GitHub integration, not `github.com`:

```bash
git remote set-url origin https://github.int.exe.xyz/goofansu/piano.git
```

Prefix GitHub CLI commands with `GH_HOST=github.int.exe.xyz`. A 403 means the integration for
`goofansu/piano` is not attached to the VM; attach it from the exe.dev dashboard.

## Node.js version

Use the latest Node 24 patch: the locked dependencies need a later patch than the `>=24` range in
`package.json` enforces.

## Architecture

Read [ADR 0001: Pi RPC and the workspace workbench](adr/0001-pi-rpc-workspace-workbench.md), then
the [invariants](adr/invariants.md): target contracts. A documented invariant is not a claim that it
is implemented. Changes to these decisions belong in a new or superseding ADR, with the affected
invariant IDs and verification consequences made explicit. Routine implementation choices remain
within the accepted direction.

## Feature inventory

Start at [Usage](usage.md) for the user guides or browse the [feature directories](../features) to find the source.

A feature keeps its browser code in `web/`, server services in `server/`, wire contracts in `contracts/`, Pi extensions in `extension/`, focused tests in `test/` and verification recipes for a scratch Piano in `verify/`. Only the directories the feature uses are present. A contract used by both the browser and server of one feature belongs in that feature.

Code outside a feature, including another feature, imports only its `contracts/` and its entry files. `server/index.ts` lists the server modules others use, `web/index.ts` lists browser logic that Node tests also load, and `web/browser.ts` lists React views and modules that rely on Vite aliases. Entry files only re-export.

The [browser](../web/src/app) and [server](../server/app) compose features. Reusable code lives in [browser shared](../web/src/shared), [server shared](../server/shared) and the [portable protocol](../shared); `npm run lint` reports a shared module that only one feature uses. Oxlint checks runtime boundaries and feature entry points for imports, including type imports and re-exports. The [Piano verification map](../.agents/skills/verify-piano/map.md#features) lists the browser journeys.

## Formatting and lint

- Add a specific `ignorePatterns` entry in `.oxfmtrc.json` for each new upstream-owned path,
  including files outside `components/ui/` (see [shadcn ownership and upgrades](ui.md#shadcn-ownership-and-upgrades)).
- Put mechanical formatting in its own commit, apart from behavior changes.
- Stylelint does not see `var(--…)` inside TSX class names or `style` props. List a custom
  property that a component sets at runtime in `stylelint.config.mjs`.

## Tests

Look in `features/<feature>/test/` for behavior owned by one feature, [`test/integration/<feature>/`](../test/integration) for interactions between modules or features, and [`test/browser/`](../test/browser) for journeys through the running app.

Node options go before the test path; `npm test -- --test-name-pattern=…` does not select tests:

```sh
node --test --test-name-pattern='<pattern>' --import ./test/setup.ts features/<feature>/test/<name>.test.ts
```

## Configuration

### Environment variables

Read where they are used: `grep -rn "process\.env\." features server scripts web/vite.config.ts`.

### Piano's extensions

`server/app/PiLaunch.ts` registers each bundled feature’s Pi extension by absolute path from the Piano
installation, before the session arguments, so a repository cannot supply or shadow them and a
`-e` in `PIANO_PI_ARGS` adds an extension instead of replacing Piano's.

### Session dispatch

`features/dispatch/server/SessionEndpoint.ts` gives each Pi child `PIANO_SESSION_WS_URL` and
`PIANO_SESSION_ORIGIN`. The origin is chosen from the configured set, never added to it, so
starting a child cannot widen the origin policy in [Browser origins](#browser-origins). See
[Delegate work to another session](../features/dispatch/README.md).

### Registry storage

`server/shared/registry/RegistryDatabase.ts` owns the SQLite schema and its in-place upgrades.

### Browser origins

`server/shared/OriginPolicy.ts` owns the Origin and Host checks. The origin check blocks cross-site
browser requests; it is not authentication, because a client outside a browser can set any
`Origin`, and it does not replace private access. Never allow an origin that serves untrusted
generated previews. Behind a proxy or on a custom Vite port, list the origin the browser uses,
not the backend address. On exe.dev,
[deploy-exe-dev](../.agents/skills/deploy-exe-dev/SKILL.md) sets the origin.

## Browser storage

Rules for anything the web UI keeps in `localStorage` or `sessionStorage`.

### Choose the store

Answer two questions about the value.

1. **How long should it live?**
   - **With the tab:** it describes what this tab is showing now. Store: `sessionStorage`.
   - **Until changed:** a choice, or a cache worth having next week. Store: `localStorage`.
2. **Should two open tabs agree?**
   - **Yes:** a preference. Store: `localStorage`.
   - **No:** each tab does its own work. Store: `sessionStorage`.

The two normally agree. When they differ, question 2 decides: two tabs overwriting each other is
a visible bug, while a value lost when a tab closes is an inconvenience.

Then check two things before storing it at all:

- **Staleness:** what happens when the stored value is old? A model list is replaced by the
  server's answer a moment later, so it may be stored. An unsent draft could be sent by mistake,
  so drafts and question replies stay in page memory.
- **Removal:** name what deletes it. `sessionStorage` ends with the tab. A fixed `piano.<name>`
  key is one bounded key. A value with no such answer stays out of `localStorage`.

### Names

Every key is `piano.<name>`, with `<name>` in camelCase (`piano.messagesOnly`, `piano.lastDir`).
Configure libraries that persist their own values to use the same naming convention.
Read each value from its current key. A renamed preference starts with its default.
The pre-paint script in `web/index.html` and `ThemeProvider` in `web/src/main.tsx` both use
`piano.theme` so the first paint matches the saved theme.

### What Piano remembers about its own data

A value named by Piano's paths, session IDs or project IDs, or caching the server's answer: add
the name and its store to `BROWSER_MEMORY` in `web/src/shared/lib/browserMemory.ts` and use
`browserMemory`.

### Preferences

How the person likes Piano to look or behave: create one with `createPreference`
(`web/src/shared/lib/preference.ts`) under a fixed `piano.<name>` key.

### Reading and writing

Storage can be missing or blocked (private windows, embedded webviews, cleared site data). Read
through a fallback and treat every write as best effort: use `createPreference`, `browserMemory`,
the helpers in `web/src/shared/lib/storage.ts`, or a `try`/`catch` of the same shape. Treat a stored
value as untrusted input and validate it on read.

## Maintaining Pi sessions

On Pi upgrades, keep saved-history reads read-only. Pi’s `SessionManager.open` can append a missing newline to a history file. Check the history parser and `SessionManager.inMemory` against the new SDK, then run the history compatibility checks and open a saved session. The loader currently relies on Pi’s internal session-manager path to avoid loading interactive modules in the history worker.

Keep publication updates within the callback passed to `SessionPublication.transaction`. Calling `apply` or `patchState` inside that callback tries to acquire a lock the callback already holds. Passing the callback’s capabilities to a forked task can let it publish after the transaction ends.

## CI and merging

[Quality CI](../.github/workflows/quality.yml) defines the jobs. No branch protection enforces
them: the owner canceled it (PIN-17). Before you merge, check that **Quality gates** and all
**Critical paths** jobs passed on the latest commit.

## Dependency security

Dependency security relies on reviewing Dependabot alerts and security-update pull requests, not on
a CI audit gate. Both are turned on for the repository. The exe.dev integration cannot read those
settings (it gets HTTP 403).
