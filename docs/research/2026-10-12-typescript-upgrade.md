# TypeScript upgrade: use 6.0.3, defer 7

## Decision

Update [PR #91](https://github.com/goofansu/piano/pull/91) to TypeScript
`~6.0.3` in both the root and web manifests. Keep one deduplicated compiler in
the lockfile. The patch-only range stays inside the lint parser's supported
TypeScript versions. No compiler flags, runtime code or lint rules change.

## Compatibility findings (2026-10-12)

- The npm registry reports TypeScript **7.0.2** as latest and **6.0.3** as the
  latest 6.x release (`npm view typescript dist-tags --json` and
  `npm view typescript@6 version --json`).
  [Primary package metadata](https://registry.npmjs.org/typescript).
- The latest `@typescript-eslint/parser` is **8.71.1**, whose TypeScript peer
  range is **`>=4.8.4 <6.1.0`**. Both the installed and latest package metadata
  agree (`npm view @typescript-eslint/parser@latest version peerDependencies --json`).
  [Versioned primary metadata](https://registry.npmjs.org/@typescript-eslint%2fparser/8.71.1).
- This is a real dependency for Piano: `eslint.config.mjs` imports this parser
  for the web source, and `npm run lint` invokes it through `lint:tailwind`.
  Its `typescript-estree`, `project-service`, and `tsconfig-utils` dependencies
  also declare the `<6.1.0` ceiling (see `package-lock.json`).
- Microsoft explicitly states that **TypeScript 7.0 does not ship a compiler
  API**, names typescript-eslint as a consumer needing 6.0, and documents an
  alias-based side-by-side workaround. A new, different API is planned for 7.1;
  that is not a guarantee of future parser compatibility.
  [TypeScript 7 announcement, “Running Side-by-Side with TypeScript 6.0”](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/#running-side-by-side-with-typescript-6-0).

The parser alone satisfies the requested fallback condition. Do not introduce
a dual-compiler workaround or force peer dependencies. Revisit v7 once the
parser explicitly supports it, then repeat the repository checks; this note
is not an exhaustive certification of every transitive dependency against v7.

## Verification

Tested PR head `f4f0ab0` with the manifest and lockfile changes in this commit,
on Linux, Node **v24.21.0**, npm **11.19.0**:

| Check | Outcome |
| --- | --- |
| `npm install --ignore-scripts` | Pass; no forced/legacy peer resolution |
| `npm ls typescript --all` | Pass; all consumers deduplicated to 6.0.3 |
| `npm test` | Pass: 391 tests, zero failures or skips |
| `npm run typecheck` | Pass: root and web |
| `npm run lint` | Pass: Biome and ESLint; one existing informational Biome diagnostic |
| `git diff --check` | Pass |

Command output retained in `/tmp/piano-ts6-{install,test,typecheck,lint}.log`
on the development VM. Install reports seven high-severity audit findings;
this compiler-only change does not attempt unrelated audit remediation.

Existing checks cover compiler and parser compatibility; no new behavior test
or browser journey is warranted for this development-only compiler change.
No production build, deployment, real registry access or live model call was
performed. Research was performed directly: no background-agent tool was
available in this session.
