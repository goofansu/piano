# Development setup and checks

How to develop Piano, with its formatting, lint, CI and dependency policy.
For what to test, see [evidence-based development and testing](testing.md).

## Setup

Clone the repository and enter its directory as shown in [Use](../README.md#use).
Use Node.js 24, npm and Git, with [Worktrunk](https://worktrunk.dev) (`wt`) 0.80.0 or later on
`PATH`. Piano supports the latest Worktrunk release. Development also requires `agent-browser`
on `PATH` and its Chromium browser. You maintain the installed version; Piano's browser harness
and verification scripts use it directly. Install Chromium before running browser checks:

```bash
agent-browser install
```

Install dependencies and start the backend and UI together:

```bash
npm install
npm run dev
```

Open <http://localhost:5173>. Vite proxies API and WebSocket requests to the backend on 7070.
Model credentials are needed for real sessions, but not for the fake-Pi tests.

`npm run dev` restarts the backend when server files change, which stops running sessions. To
restart by hand instead, run `npm run build` and `npm start`. To run the two processes in separate
terminals, use `npm run dev:server` and `npm run dev:web`.

Before you commit code or dependency changes, allocate an
[evidence run](testing.md#evidence-directories) under `~/piano-evidence/`, then run:

```bash
npm run verify -- "$EVIDENCE_RUN/baseline"
```

`verify` runs the unchanged required gates: `npm run typecheck`, `npm run lint`, then `npm test`.
It retains each command's output and a `run.json`, reports every result, and exits nonzero for a
failed, blocked, cancelled, error or inconclusive run. A failed gate does not hide later results;
cancellation leaves remaining gates `not-run`. Run `npm run verify -- --help` for focused and browser
entry points. On a fresh worktree run `npm ci` first; missing dependencies or tools are **blocked**,
not success. The wrapper is for Linux/macOS, like the scratch scripts; it owns no app/database.

A baseline pass does not verify a feature or select its browser evidence: follow
[the testing policy](testing.md). CI retains its existing independent jobs and shards.

## Node.js version

Piano declares Node.js `>=24` in the root `package.json`. Use the latest Node 24 patch: the
locked dependencies currently require at least 24.15.0 within that major. The root range is a
major-version floor, not a promise that every Node 24 patch satisfies every dependency.

This is a requirement declaration, not enforcement: npm normally warns about incompatible Node
versions during installation. Piano does not enable `engine-strict` or add a startup version guard.

## Formatting and lint

Piano formats with [oxfmt](https://oxc.rs/docs/guide/usage/formatter) and lints with
[oxlint](https://oxc.rs/docs/guide/usage/linter). Type checking is TypeScript 7's `tsc`.

`.oxfmtrc.json` is the source of truth for formatting: two spaces, LF, a 100-column target, double
quotes (also in JSX), semicolons, trailing commas and sorted imports. `npm run format` rewrites
files and `npm run format:check` only reports. oxfmt formats application and test source, CSS and
the maintained JSON config. It skips upstream shadcn source (`web/src/components/ui/` and
`web/src/hooks/use-mobile.ts`) so updates stay reviewable; always add a specific `ignorePatterns`
entry for a new upstream-owned path, including files outside `components/ui/` (see
[shadcn ownership](shadcn-ui.md)). It leaves lockfiles, captured evidence, vendored skills,
Markdown and YAML alone. Put mechanical formatting in its own commit, apart from behavior changes.

`npm run lint` runs oxlint, Stylelint, then `oxfmt --check`. `.oxlintrc.json` enables oxlint's correctness
rules with the TypeScript, unicorn, import, React and jsx-a11y plugins; each rule it turns off says
why. Suppress one finding with `// oxlint-disable-next-line <rule> -- <reason>`; lint fails on a
suppression that no longer matches. The same run checks Tailwind classes with `@shadcn/lint`, loaded
as an oxlint JS plugin: it rejects classes the UI's Tailwind theme does not define.
`web/src/components/ui/.oxlintrc.json` adds that check on upstream components; they also inherit
Piano's layer boundary rule.

Stylelint checks the CSS for names that do not exist: an unknown property, or a `var(--…)` that no
CSS defines. Both pass the build and silently do nothing in the browser. `stylelint.config.mjs` runs
only those two rules. It counts Tailwind's own theme variables as defined, and lists the custom
properties that components set at runtime through `style`; add a new one there with the file that
sets it. It does not see `var(--…)` inside TSX class
names or `style` props.

`npm install` installs a Husky pre-commit hook that runs `npm run lint`. A lint error blocks the
commit.

## Import boundaries

`npm run lint` enforces `web/src → shared ← server` with the local oxlint rule in
[`scripts/lint-boundaries.mjs`](../scripts/lint-boundaries.mjs). Browser source may import only its
own layer and shared via local paths; shared may import only shared. This closes local bridge
routes through scripts/tests as well as direct cross-layer edges. Server may not import `web/`;
its intentional `scripts/PreviewOwner.ts` and `PreviewAdapter.ts` imports remain allowed.

Imports, type-only imports (including `import("…")` types), re-exports, literal dynamic imports
and `require` are checked. Relative paths, current tsconfig aliases and existing symlink targets
are normalized. Computed imports are rejected; the one resolved Pi SDK URL in
`server/PiHistoryFile.ts` has a documented inline exemption. The rule reads the two plain-JSON tsconfigs' `paths`; inheritance,
`baseUrl` or non-terminal alias wildcards require extending the rule rather than silently losing edges. Keep Vite aliases aligned with
those configs; custom runtime loaders, Vite-only aliases and arbitrary third-party internals are
not a transitive graph analysis.

Shared external entry points are reviewed, not blanket-banned by vendor: `effect`,
`@earendil-works/pi-schema` and `zod` are environment-neutral runtime schemas in use today. New
entry points (including package subpaths) require review in the rule; Node builtins and Node-only
packages fail even as type imports. `test/lint-boundaries.test.ts` runs allowed and forbidden
fixtures through the actual oxlint config, including a browser → shared → server bridge and the
upstream UI config. CI runs the same lint and includes these fixtures in its module shards.
This guards code review; configuration edits, lint suppressions and unrestricted shell access
remain trusted, not a security sandbox (INV-01, INV-09).

## Tests

Module tests (`npm test`) run against a fake Pi and need no model credentials. One test drives a
real Worktrunk and needs `wt` 0.80.0 or later on `PATH`. The critical-path browser journeys in
`test/browser/` run with `npm run test:browser`. To focus without a selection DSL, first allocate an
[evidence run](testing.md#evidence-directories), then use:

```sh
node --test --import ./test/setup.ts test/lint-boundaries.test.ts
node --test --test-name-pattern='revision identifies' --import ./test/setup.ts test/verification-evidence.test.ts
node test/browser/start-session.mjs "$EVIDENCE_RUN/start-session"
```

Node options go **before** the test path; `npm test -- --test-name-pattern=…` does not select tests.
Browser prerequisites and journey choices live in [testing](testing.md#browser-tests); manual
setup/readiness/capture/cleanup remain in the [verify-piano skill](../.agents/skills/verify-piano/SKILL.md).
Use a fresh child directory within the evidence run for each observation. See
[provenance](testing.md#file-evidence-provenance) for exactly what a recorded pass does and does not
establish.

## CI and merging

[Quality CI](../.github/workflows/quality.yml) runs on every pull request, every push to `main` and
every merge-queue candidate, on Node 24. Independent jobs run:

- **Static checks:** `npm ci`, `npm run typecheck` and `npm run lint`.
- **Build:** `npm ci` and `npm run build`.
- **Module tests (1–8/8):** each runs `npm ci` and one native Node test shard, using the same
  preload and file glob as `npm test`. Every shard installs the latest Worktrunk release, checked
  against its published checksum. All shards finish even if another fails.
- **Critical paths:** three runners share dependency/browser setup across balanced journey groups:
  `remote-session`, `open-session + transcript-rows`, and `start-session + remote-inputs`.
  Paired journeys run serially as separate steps, with scratch cleanup between them. A failed
  first journey does not skip its companion or make the job pass; setup failure or cancellation
  prevents further journeys. Failed jobs retain evidence for every journey they ran.
  Only the `start-session + remote-inputs` runner installs Worktrunk through the same
  checksum-verified action as module tests, because `start-session` dispatches into a real
  worktree. All jobs finish even if one fails.
  Local commands are unchanged: `npm run test:browser:local` runs start-session, open-session and
  transcript-rows serially; `npm run test:browser:remote` runs both multi-peer portions serially,
  and `npm run test:browser` runs both groups. The remote portions stay on separate CI runners.

**Quality gates** keeps its existing check name and passes only when static checks, the build and every
module shard succeed; failed, cancelled or skipped dependencies cannot pass it. CI gets no model secrets.
The extra runners trade aggregate runner time for a shorter feedback path; no test selection or
result caching is used. New test files join the shards automatically. To reproduce a shard locally:

```sh
node --test --test-shard=1/8 --import ./test/setup.ts 'test/**/*.test.ts'
```

Keep the preload and glob aligned with `npm test`. Options must precede the glob; appending
`--test-shard` with `npm test --` does not shard the suite. `npm test` still runs the whole suite locally.

No branch protection enforces these jobs: the owner canceled it (PIN-17). Before you merge, check
that **Quality gates** and all **Critical paths** jobs passed on the latest commit.

## Dependency security

Dependency security relies on reviewing Dependabot alerts and security-update pull requests, not on
a CI audit gate. An owner must turn on **Dependabot alerts** and **Dependabot security updates**
under **Settings → Security → Advanced Security**. The exe.dev integration cannot read or change
those settings (it gets HTTP 403), so whether they are on is unverified.
