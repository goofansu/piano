# oxlint, oxfmt and TypeScript 7

## Decision

Replace Biome (lint and format) and ESLint (the Tailwind class check) with
[oxlint](https://oxc.rs/docs/guide/usage/linter) 1.90 and
[oxfmt](https://oxc.rs/docs/guide/usage/formatter) 0.75, and move both manifests to TypeScript
`~7.0.2`. This supersedes the [6.0.3 decision](2026-10-12-typescript-upgrade.md).

## Why now

- TypeScript 7 was deferred for one reason: `@typescript-eslint/parser` caps TypeScript at
  `<6.1.0`. On 2026-11-03 its latest release, 8.72.1, still does. Its TypeScript 7 support waits on
  the 7.1 API and has no release date
  ([typescript-eslint#10940](https://github.com/typescript-eslint/typescript-eslint/issues/10940)).
- Piano used that parser for one rule: `@shadcn/lint`'s `no-unknown-classes`. oxlint runs ESLint
  plugins as JS plugins on its own parser. The rule reads `parserServices` only optionally, and it
  reports the same diagnostic under oxlint as under ESLint.
- npm weekly downloads (2026-11-03): typescript 401M, eslint 201M, prettier 179M, oxlint 42M,
  oxfmt 27M, Biome 25M. oxlint and oxfmt are now at least as widely used as Biome, and both are faster.

## Configuration choices

- **Format.** `.oxfmtrc.json` keeps Biome's style: 100 columns, double quotes, semicolons and
  trailing commas. `sortImports` with `newlinesBetween: false` keeps Biome's import order. The only
  difference is the Prettier-style layout of a trailing options object, as in
  `test(name, { timeout }, async () => …)`, which oxfmt splits. That reformat is its own commit. The scope stays Biome's: Markdown, YAML, docs, vendored skills
  and upstream shadcn source are left alone.
- **Lint.** oxlint's correctness category with the TypeScript, unicorn, oxc, import, React and
  jsx-a11y plugins. These are off, each with its reason in `.oxlintrc.json`:
  - the React Compiler rules: Piano does not build with the React Compiler
  - `jsx-a11y/prefer-tag-over-role` and `control-has-associated-label`: not in jsx-a11y's
    recommended set, and they flag deliberate ARIA roles and table cells
  - `jsx-a11y/no-autofocus`: deliberate in dialogs, which Biome's rule allowed
  - `unicorn/no-useless-spread`: `[...listeners]` snapshots a set before iterating it, so the
    "fix" would change behaviour
- **Suppressions.** Biome comments for rules oxlint enforces became
  `oxlint-disable-next-line <rule> -- <reason>`. Lint reports unused suppressions. The rest became
  plain comments that keep their reason.
- **Upstream shadcn source.** `web/src/components/ui/.oxlintrc.json` runs only the Tailwind class
  check, as ESLint did. oxlint overrides cannot switch off a rule category, so this needs a nested
  config.
- **Not adopted.** Type-aware oxlint (`oxlint-tsgolint`): on Piano, `no-floating-promises` mostly
  flags `node:test` calls. `@effect/tsgo`: niche, and it pins exact TypeScript and oxlint versions;
  its four errors on Piano were false positives. tsrs: a pre-stable, third-party port.

## Losses

- Biome also linted CSS (`noImportantStyles`, `noDescendingSpecificity`); oxlint lints only
  JavaScript and TypeScript. oxfmt still formats CSS.
- ESLint ran the Tailwind check with `--no-inline-config`, so no inline directive could switch it
  off. oxlint has no equivalent; review new `shadcn/` suppressions.
- oxlint JS plugins are alpha, and oxfmt is 0.x.

## Verification

Run on macOS (Darwin 25.6.0), Node 24, after a clean `npm ci`. Outcomes are in the pull request.
