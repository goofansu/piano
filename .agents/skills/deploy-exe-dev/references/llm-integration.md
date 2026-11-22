# Configure Pi's LLM integration

Run this when `exe-dev-llm-integration.json` is absent, on the VM after `npm ci` and before `npm run build` and any Pi process starts. Check accessibility on this VM rather than assuming an account-wide attachment. Use the service user's environment and Pi agent directory (normally `/home/exedev/.pi/agent`; honor `PI_CODING_AGENT_DIR` if configured).

1. Before writing configuration, confirm the exe.dev extension is installed and run the checkout's installed Pi CLI (`node_modules/.bin/pi --list-models`). The gate passes only when the command succeeds and lists at least one model whose ID ends in `@llm`. This is a discovery check, not a paid model call; `auth check` alone does not establish extension-provider availability.
   - **Accessible:** continue below, before starting Piano.
   - **Unavailable or check failed:** leave the approval file and model defaults untouched, finish deploying Piano, and report the failed check in the final summary. Tell the user to attach the `llm` integration to this VM from the exe.dev dashboard and rerun the deploy after it is accessible; the absent approval file makes the rerun configure it. If an extension or discovery failure was observed, mention it too; an empty model list does not prove the attachment is absent. Deployment itself need not wait for model access.
2. Only after the gate passes, write `exe-dev-llm-integration.json` in that directory:

   ```json
   {"version":1,"useExeIntegration":true}
   ```

   On a fresh VM this records the requested default. Preserve an existing explicit `false` unless the user authorizes changing it. Ensure `EXE_DEV_DISABLE_GATEWAY` is unset or falsy in the service environment.
3. Resolve the default using this VM's installed exe.dev extension, exactly as its affirmative approval action does: inspect `selectDefaultIntegrationModel` in `index.ts` and `chooseDefaultModel` in `model_choice.ts`, and use the same discovered available-model sequence and selection rule. Use **Runtime discovery** below to obtain that sequence without a session or model call. The inspected implementation chooses the first model in that sequence; the sorted `--list-models` display is only the accessibility check, not the selection order. Confirm the resolved model belongs to `llm` (`@llm` suffix), then merge its exact provider and model ID as `defaultProvider` and `defaultModel` into `settings.json`, preserving other settings. If the extension's default cannot be established or belongs to another integration, leave model defaults unchanged and report the ambiguity rather than choosing an arbitrary model. Run this before Pi processes start, without a model call. Read the default afresh on this VM; another machine's settings and hard-coded model IDs are not the source of truth.

The opt-in enables all attached LLM integrations, not only `llm`. Pre-seeding it skips the dialog's default-model selection, which is why step 3 is separate. Leave integration attachment changes to the user. No credential copy or custom `models.json` provider is needed. For schema or behavior changes, consult the checkout's `docs/research/2026-10-14-exe-dev-llm-default.md` and the installed extension source.

### Runtime discovery

Follow `readlink -f node_modules/.bin/pi` and inspect that installed package's declarations. Extension imports may use the legacy `@mariozechner` namespace even when Piano installs `@earendil-works`; the installed extension loader resolves those aliases.

The runtime used in this deployment supports this discovery-only sequence:

1. Call `loadExtensions` for the installed exe.dev extension and check its returned errors. The package root does not export it; import `dist/core/extensions/loader.js` from the installed package by absolute path.
2. Register `runtime.pendingProviderRegistrations` on `ModelRuntime.create()` and await `getAvailable()`.
3. Apply the extension's provider/base-URL filter, then call its `chooseDefaultModel`.

Recheck the declarations when the installed version changes. This sequence creates no session and makes no model call.
