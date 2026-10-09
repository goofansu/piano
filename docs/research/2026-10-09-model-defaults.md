# Machine-wide model and effort defaults

## Claim and scope

Settings → Models saves the default model and default effort through Pi's `SettingsManager`,
not the registry or browser storage. It applies to future sessions on this machine. Existing
sessions, trusted-folder overrides, per-model effort settings and unrelated Pi settings are retained.
The settings picker uses global resources only; folder catalogs still use normal Pi discovery.
Saving invalidates server and connected-client catalogs. A failed Pi persistence operation is not
reported as success. Preserves INV-01, INV-03 and INV-12 from the
[development invariants](../development-invariants.md).

## Observed verification

Environment: Node v24.21.0, locked Pi 1.1.0, Linux; scratch backend 127.0.0.1:7171 and Vite UI
127.0.0.1:7172. Real Pi CLI and settings files, isolated agent/session directories and registry;
synthetic local provider, zero model requests. User configuration and running service were untouched.

Tested content: base `f548507146a57fd7ec8db2b352a281e0e029a5f6` plus this implementation.
The SHA-256 of the sorted changed/new code-file `sha256sum` listing, before this report, was
`96a69e2c19e211c8e4569441cffbba165f27a7eea2f150d47ab406add490cdfe`.

- `npm test`: **105 passed**, 0 failed/skipped. New `test/PiSettings.test.ts` checks Pi persistence,
  actual CLI default readback after cache invalidation, global-only probing, unchanged live sessions
  and folder overrides, independent effort updates, unknown-model rejection, unwritable and corrupt
  settings. This protects the new durability boundary, including Pi's non-throwing `flush()` errors.
- `npm run typecheck`: **passed**.
- `npm run lint`: **passed** (Biome and Tailwind ESLint).
- `node test/browser-model-settings.mjs /tmp/piano-defaults-evidence/browser`: **passed**.
  Agent-browser observed unset defaults, searchable model selection, effort selection, Save, file
  readback, new-session picker refresh without reload, reload persistence, Models palette navigation,
  invalid-effort rejection, visible save failure and successful retry, mobile layout and Providers
  navigation. A second WebSocket client observed catalog invalidation.
- `node test/browser-provider-login.mjs /tmp/piano-defaults-evidence/provider-login`: **passed**.
  Existing controlled-HTTP sign-in journey still works through the new Settings navigation.
- `git diff --check`: **passed**. Reviewed SDK ownership, settings error handling, scope separation,
  palette/sidebar naming and desktop/mobile screenshots. Browser verification caught and corrected
  an event-handler argument being mistaken for a Settings section before the passing runs.

Local raw command logs are `/tmp/piano-defaults-{test,typecheck,lint,browser,providers-browser}.log`.
Browser command output, screenshots and scratch process logs are under `/tmp/piano-defaults-evidence/`.
Scratch processes and resources were cleaned up. No application build or deployment was performed.
These checks do not exercise real provider authentication or paid model inference.

## Upstream integration

The first push was rejected because `main` advanced. A clean rebase onto `dea1567` retained the
upstream composer-stop and message-error changes. Reverified implementation commit `5f45ca2`
(before this report-only amendment): `npm test` **116 passed**, typecheck and lint **passed**,
and the full model-settings browser journey **passed** again. Logs use the suffix `-rebased.log`;
browser artifacts are in `/tmp/piano-defaults-evidence/rebased-browser/`. No force push or deployment.
