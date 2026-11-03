# Development checks and policy

How Piano's formatting, lint, CI and dependency policy work. For setup, see the
[README](../README.md#develop). For what to test, see
[evidence-based development and testing](testing.md).

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

`npm run lint` runs oxlint, then `oxfmt --check`. `.oxlintrc.json` enables oxlint's correctness
rules with the TypeScript, unicorn, import, React and jsx-a11y plugins; each rule it turns off says
why. Suppress one finding with `// oxlint-disable-next-line <rule> -- <reason>`; lint fails on a
suppression that no longer matches. The same run checks Tailwind classes with `@shadcn/lint`, loaded
as an oxlint JS plugin: it rejects classes the UI's Tailwind theme does not define.
`web/src/components/ui/.oxlintrc.json` runs only that check on upstream components.

`npm install` installs a Husky pre-commit hook that runs `npm run lint`. A lint error blocks the
commit.

## Tests

Module tests (`npm test`) run against a fake Pi and need no model credentials. One test drives a
real Worktrunk and needs `wt` 0.80.0 or later on `PATH`. The critical-path browser journeys in
`test/browser/` run with `npm run test:browser`.

## CI and merging

[Quality CI](../.github/workflows/quality.yml) runs on every pull request, every push to `main` and
every merge-queue candidate, on Node 24. The quality job runs `npm ci`, `npm run typecheck`,
`npm run lint`, `npm test` and `npm run build`, with the latest Worktrunk release, checked against
the checksum file published with it. A second job runs `npm run test:browser`. CI gets no model
secrets.

No branch protection enforces these jobs: the owner canceled it (PIN-17). Before you merge, check
that **Quality gates** passed on the latest commit.

The Piano host must be private: reachable only by its trusted developer, on loopback or through a
private authenticated proxy such as exe.dev's (INV-11). Development has no privacy requirement;
the repository can be public. See [browser origins](configuration.md#browser-origins) for the
access model.

## Dependency security

Dependency security relies on reviewing Dependabot alerts and security-update pull requests, not on
a CI audit gate. An owner must turn on **Dependabot alerts** and **Dependabot security updates**
under **Settings → Security → Advanced Security**. The exe.dev integration cannot read or change
those settings (it gets HTTP 403), so whether they are on is unverified.
