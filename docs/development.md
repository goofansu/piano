# Development setup and checks

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

## Formatting and lint

- Add a specific `ignorePatterns` entry in `.oxfmtrc.json` for each new upstream-owned path,
  including files outside `components/ui/` (see [shadcn ownership](shadcn-ui.md)).
- Put mechanical formatting in its own commit, apart from behavior changes.
- Stylelint does not see `var(--…)` inside TSX class names or `style` props. List a custom
  property that a component sets at runtime in `stylelint.config.mjs`.

## Tests

Node options go before the test path; `npm test -- --test-name-pattern=…` does not select tests:

```sh
node --test --test-name-pattern='<pattern>' --import ./test/setup.ts features/<feature>/test/<name>.test.ts
```

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
