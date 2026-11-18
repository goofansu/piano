# Development setup and checks

## Setup

Use Node.js 24, npm and Git, with [Worktrunk](https://worktrunk.dev) (`wt`) 0.80.0 or later on
`PATH`. Browser checks also need `agent-browser` on `PATH` and its Chromium:
`agent-browser install`.

## Node.js version

Use the latest Node 24 patch: the locked dependencies need at least 24.15.0, which the `>=24`
range in `package.json` does not enforce.

## Formatting and lint

- Add a specific `ignorePatterns` entry in `.oxfmtrc.json` for each new upstream-owned path,
  including files outside `components/ui/` (see [shadcn ownership](shadcn-ui.md)).
- Put mechanical formatting in its own commit, apart from behavior changes.
- Stylelint does not see `var(--…)` inside TSX class names or `style` props. List a custom
  property that a component sets at runtime in `stylelint.config.mjs`.

## Tests

Node options go before the test path; `npm test -- --test-name-pattern=…` does not select tests:

```sh
node --test --test-name-pattern='<pattern>' --import ./test/setup.ts test/<name>.test.ts
```

One module test drives a real Worktrunk and needs `wt` on `PATH`.

## CI and merging

[Quality CI](../.github/workflows/quality.yml) defines the jobs. No branch protection enforces
them: the owner canceled it (PIN-17). Before you merge, check that **Quality gates** and all
**Critical paths** jobs passed on the latest commit.

## Dependency security

Dependency security relies on reviewing Dependabot alerts and security-update pull requests, not on
a CI audit gate. Both are turned on for the repository. The exe.dev integration cannot read those
settings (it gets HTTP 403).
