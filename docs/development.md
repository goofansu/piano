# Development checks and policy

How Piano's formatting, lint, CI and dependency policy work. For setup, see the
[README](../README.md#develop). For what to test, see
[evidence-based development and testing](testing.md).

## Formatting and lint

`biome.json` is the source of truth for formatting: two spaces, LF, a 100-column target, double
quotes (also in JSX), semicolons and trailing commas. `npm run format` rewrites files and
`npm run format:check` only reports.

Biome formats application and test source and the maintained JS and JSON config. It skips
upstream shadcn source (`web/src/components/ui/` and `web/src/hooks/use-mobile.ts`) so updates stay
reviewable. Always add specific Biome exclusions for new upstream-owned paths, including files
outside `components/ui/`; see [shadcn ownership](shadcn-ui.md). Tailwind checks still cover upstream
components. Biome leaves lockfiles, captured evidence, vendored skills, Markdown and YAML alone.
Put mechanical formatting in its own commit, apart from behavior changes.

`npm run lint` runs `biome check` (rules and formatting), then `npm run lint:tailwind`. The Tailwind
check runs ESLint with `@shadcn/lint`, configured in `eslint.config.mjs`. It rejects classes the
UI's Tailwind theme does not define, `components/ui` included. It ignores inline ESLint directives,
so old React Hooks directives cannot switch it off.

`npm install` installs a Husky pre-commit hook that runs `npm run lint`. A lint error blocks the
commit.

## Tests

Module tests (`npm test`) run against a fake Pi and need neither model credentials nor Worktrunk.
The [Worktrunk integration suite](testing.md#worktrunk-integration-tests) runs separately with
`npm run test:worktrunk` and needs `wt` 0.80.0 or later on `PATH`. The critical-path browser journeys
in `test/browser/` run with `npm run test:browser`.

## CI and merging

[Quality CI](../.github/workflows/quality.yml) runs on every pull request, every push to `main` and
every merge-queue candidate, on Node 24. The quality job runs `npm ci`, `npm run typecheck`,
`npm run lint`, `npm test` and `npm run build`, without installing Worktrunk. Separate jobs run
`npm run test:worktrunk` and `npm run test:browser`. Only the Worktrunk job installs the latest
Worktrunk release, checked against the checksum file published with it. CI gets no model secrets.

No branch protection enforces these jobs: the owner canceled it (PIN-17). Before you merge, check
that **Quality gates**, **Worktrunk integration** and **Critical paths** passed on the latest commit.

The Piano host must be private: reachable only by its trusted developer, on loopback or through a
private authenticated proxy such as exe.dev's (INV-11). Development has no privacy requirement;
the repository can be public. See [browser origins](configuration.md#browser-origins) for the
access model.

## Dependency security

Dependency security relies on reviewing Dependabot alerts and security-update pull requests, not on
a CI audit gate. An owner must turn on **Dependabot alerts** and **Dependabot security updates**
under **Settings → Security → Advanced Security**. The exe.dev integration cannot read or change
those settings (it gets HTTP 403), so whether they are on is unverified.
