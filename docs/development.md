# Development checks and policy

How Piano's formatting, lint, CI and dependency policy work. For setup, see the
[README](../README.md#develop-piano). For what to test, see
[evidence-based development and testing](testing.md).

## Formatting and lint

`biome.json` is the source of truth for formatting: two spaces, LF, a 100-column target, double
quotes (also in JSX), semicolons and trailing commas. `npm run format` rewrites files and
`npm run format:check` only reports.

Biome formats application and test source and the maintained JS and JSON config. It skips
`web/src/components/ui`, so upstream shadcn updates stay reviewable. Tailwind checks still cover
that folder. Biome leaves lockfiles, captured evidence, vendored skills, Markdown and YAML alone.
Put mechanical formatting in its own commit, apart from behavior changes.

`npm run lint` runs `biome check` (rules and formatting), then `npm run lint:tailwind`. The Tailwind
check runs ESLint with `@shadcn/lint`, configured in `eslint.config.mjs`. It rejects classes the
UI's Tailwind theme does not define, `components/ui` included. It ignores inline ESLint directives,
so old React Hooks directives cannot switch it off.

`npm install` installs a Husky pre-commit hook that runs `npm run lint`. A lint error blocks the
commit.

## Tests

Module tests (`npm test`) run against a fake Pi and need no model credentials. One test drives a
real Worktrunk and needs `wt` 0.80.0 on `PATH`. The critical-path browser journeys in
`test/browser/` run with `npm run test:browser`.

## CI and merging

[Quality CI](../.github/workflows/quality.yml) runs on every pull request, every push to `main` and
every merge-queue candidate, on Node 24. The quality job runs `npm ci`, `npm run typecheck`,
`npm run lint`, `npm test` and `npm run build`, with checksum-pinned Worktrunk 0.80.0. A second job
runs `npm run test:browser`. CI gets no model secrets.

No branch protection enforces these jobs: the owner canceled it (YEJ-17). Before you merge, check
that **Quality gates** passed on the latest commit. Keep the repository private.

## Dependency security

Dependency security relies on reviewing Dependabot alerts and security-update pull requests, not on
a CI audit gate. An owner must turn on **Dependabot alerts** and **Dependabot security updates**
under **Settings → Security → Advanced Security**. The exe.dev integration cannot read or change
those settings (it gets HTTP 403), so whether they are on is unverified. See the
[audit findings and policy](research/yej-16-audit.md).
