# Default to exe.dev LLM integrations without Pi's approval dialog

## Finding

Provision `~/.pi/agent/exe-dev-llm-integration.json` before starting Pi or Piano:

```json
{"version":1,"useExeIntegration":true}
```

This is the exact state written by choosing **Use exe.dev LLM integration [llm]**. The dialog belongs to the VM-installed exe.dev extension, not Pi core. The extension reads this file under Pi's `getAgentDir()` and skips its dialog when a preference exists. A different `PI_CODING_AGENT_DIR` requires provisioning that directory instead. [1, 2, 5]

The preference enables **all attached LLM integrations**; it is not an integration-name allowlist. To default specifically to `llm`, also select a currently available model with an `@llm` suffix. Clicking the dialog's affirmative option selects a default model; pre-seeding the preference skips that side effect. [1, 3, 4]

## Short provisioning path

Run as the account that will run Piano, before its first start:

```bash
python3 - <<'PY'
import json, os
from pathlib import Path
agent = Path(os.environ.get('PI_CODING_AGENT_DIR', '~/.pi/agent')).expanduser()
agent.mkdir(parents=True, exist_ok=True)
(agent / 'exe-dev-llm-integration.json').write_text(
    json.dumps({'version': 1, 'useExeIntegration': True}, indent=2) + '\n'
)
PY
```

On a fresh VM this records the user's requested opt-in without launching the TUI or copying credentials. For an existing installation, treat changing an explicit `false` as a routing-policy change rather than silently overriding it. The extension must be installed and discoverable by the Pi process; a preference file alone does not install it. [1, 2]

Attach `llm` during creation with `ssh exe.dev new --integration llm ...`, or, if the user wants this integration on every Piano-tagged VM, configure once:

```bash
ssh exe.dev integrations attach llm tag:goofansu-piano
```

The latter affects existing and future tagged VMs, so it has a broader scope than creating one VM. Integration attachment and Pi's local approval are independent steps. [6]

For deterministic model selection, merge `defaultProvider` and `defaultModel` into the same agent directory's `settings.json`, preserving its other keys. Choose a provider/model pair actually available on the target VM; do this before starting Pi to avoid concurrent settings writes. For example, the inspected `pi-piano.exe.xyz` currently uses:

```json
{
  "defaultProvider": "exe-dev-openai",
  "defaultModel": "gpt-6-astra@llm"
}
```

These are observed values, not permanent provisioning constants. The extension constructs integration-specific IDs with the `@<integration-name>` suffix. No manual provider definition in `models.json` or credential copy is needed for this extension's discovered providers. Its `EXE_DEV_DISABLE_GATEWAY` kill switch still overrides the saved opt-in when truthy. [1, 3, 5]

## Evidence and limits — 2026-10-14

- Read-only inspection of `pi-piano.exe.xyz` found the extension and saved state `{version:1,useExeIntegration:true}`, plus the default provider/model above.
- Read-only inspection of `goofansu-piano.exe.xyz` found the extension installed but no saved approval file. Both VMs' `routing_preference.ts` have SHA256 `82bd3d1a0387a2d9e31a1d9484268ddf9552907396740545f349a69bda7519ed`.
- Ran the actual copied preference helper locally in an isolated temporary directory. Its writer emitted the JSON above, its reader returned `use`, provider registration was enabled, and the kill switch still disabled registration. Retained file: `/var/folders/c0/whg8pxzx1p1fs3qxbgp6kqvh0000gn/T/piano-llm-opt-in-1OTLlt/exe-dev-llm-integration.json` (temporary).
- Dialog suppression follows directly from the extension's early return when the preference is present. A fresh-VM TUI/RPC journey with pre-seeded state has **not** been observed. No model calls, live configuration writes, service restarts, or integration attachment changes were made.

## Primary sources

The exe.dev extension sources were inspected on `pi-piano.exe.xyz` under `/home/exedev/.pi/agent/extensions/exe-dev/`; these are deployed-source references rather than claims about a permanently stable public API.

1. `index.ts`: `LLM_INTEGRATION_PREFERENCE_FILE`, extension factory, `promptForLLMIntegrationPreference`, `selectDefaultIntegrationModel`, and `integrationsDisabled`. Establishes file location, provider discovery/registration, preference guard, selection side effect and kill switch.
2. `routing_preference.ts`: `parseLLMIntegrationPreference`, `writeLLMIntegrationPreference`, `shouldRegisterLLMIntegrations`. Establishes exact JSON and boolean semantics.
3. `integration_catalog.ts`: integration filtering, `integrationAliasModelID`, provider construction. Establishes attached-integration discovery and model-ID suffixes.
4. `model_choice.ts`: `chooseDefaultModel` returns the first available model; it does not specifically prefer the integration named `llm`.
5. Installed Pi 1.2.0 documentation: `docs/settings.md` (default provider/model), `docs/environment-variables.md` and `dist/config.js` (`PI_CODING_AGENT_DIR` / `getAgentDir`). Package root locally: `~/.pi/agent/install/releases/1.2.0/node_modules/@earendil-works/pi-coding-agent`.
6. Observed `ssh exe.dev help new` and `ssh exe.dev help integrations attach`: creation-time integration attachment and `vm:`, `tag:`, `auto:all` attachment scopes.
