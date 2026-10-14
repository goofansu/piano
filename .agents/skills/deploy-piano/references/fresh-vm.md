# Fresh VM

Use the `using-exe-dev` skill for SSH conventions. Query `ssh exe.dev help <command>` only for an unfamiliar option. Substitute shell-quoted values for `<vm>` and paths below.

## Create and prepare

```bash
ssh exe.dev new --tag goofansu-piano --json
ssh exe.dev share set-private <vm>
ssh exe.dev share port <vm> 8000
ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new <vm>.exe.xyz \
  'whoami; ls /home/exedev/node/bin; command -v git wt; sudo -n true'
```

Let exe.dev generate the VM name. Use the creation response's VM name for `<vm>` in subsequent commands, and its returned SSH destination and HTTPS URL thereafter.

Exeuntu may already have Node 24 under `/home/exedev/node/bin` but omit it from noninteractive PATH. Set `PATH="$HOME/node/bin:$HOME/.local/bin:$PATH"`, verify `node --version`, and create the unit's expected entry with `ln -s /home/exedev/node/bin/node "$HOME/.local/bin/node"` if that entry is absent. Install Node only if the required version is absent. Adapt user and paths when the image differs.

Install missing Worktrunk using its upstream release matching the VM architecture and Piano's README requirement. Discover the release and assets from the deploying machine; a fresh VM may receive GitHub API HTTP 403. Verify the archive against its published SHA256 before transferring it and installing `wt` into `.local/bin`. If downloading on the VM, use the same local fallback on HTTP 403. Reuse existing tools rather than reinstalling them.

For an SSH/scp connection closed by the remote host, retry the failed transfer once to the same destination. Continue only after the transfer succeeds; keep its local source until then.

## Transfer the requested revision

Prefer a direct clone using already-configured repository access. If authentication is unavailable, use a Git bundle from the local checkout, not a credential copy. For current remote `main`:

```bash
# Local checkout.
scratch=$(mktemp -d)
git fetch origin main
git rev-parse origin/main
git bundle create "$scratch/piano.bundle" refs/remotes/origin/main
scp "$scratch/piano.bundle" <vm>.exe.xyz:/tmp/piano.bundle
```

On the new VM, create `/home/exedev/piano` only if absent:

```bash
git init -b main /home/exedev/piano
cd /home/exedev/piano
git fetch /tmp/piano.bundle refs/remotes/origin/main:refs/remotes/origin/main
git reset --hard refs/remotes/origin/main
git remote add origin git@github.com:goofansu/piano.git
git branch --set-upstream-to=origin/main main
rm /tmp/piano.bundle
```

This reset is for the newly initialized empty checkout only. A bundle containing `refs/remotes/origin/main` needs an explicit fetch refspec; `git clone -b main` cannot find a branch under `refs/heads`. Record the deployed SHA and flag future repository authentication as unconfigured if applicable.

## Configure Pi's LLM integration

Check accessibility on each machine rather than assuming an account-wide attachment. VM creation needs no integration flag or attachment command. Use the service user's environment and Pi agent directory (normally `/home/exedev/.pi/agent`; honor `PI_CODING_AGENT_DIR` if configured).

1. Before writing configuration, confirm the exe.dev extension is installed and run the checkout's installed Pi CLI with `--list-models` on the target VM. The gate passes only when the command succeeds and lists at least one model whose ID ends in `@llm`. This is a discovery check, not a paid model call; `auth check` alone does not establish extension-provider availability.
   - **Accessible:** continue below, before starting Piano.
   - **Unavailable or check failed:** leave the approval file and model defaults untouched, finish deploying Piano, and report the failed check in the final summary. Tell the user to attach the integration manually with `ssh exe.dev integrations attach llm vm:<vm>` and rerun setup after it is accessible. If an extension or discovery failure was observed, mention it too; an empty model list does not prove the attachment is absent. Deployment itself need not wait for model access.
2. Only after the gate passes, write `exe-dev-llm-integration.json` in that directory:

   ```json
   {"version":1,"useExeIntegration":true}
   ```

   On a fresh VM this records the requested default. Preserve an existing explicit `false` unless the user authorizes changing it. Ensure `EXE_DEV_DISABLE_GATEWAY` is unset or falsy in the service environment.
3. Resolve the default using the target VM's installed exe.dev extension, exactly as its affirmative approval action does: inspect `selectDefaultIntegrationModel` in `index.ts` and `chooseDefaultModel` in `model_choice.ts`, and use the same discovered available-model sequence and selection rule. Use **Runtime discovery** below to obtain that sequence without a session or model call. The inspected implementation chooses the first model in that sequence; the sorted `--list-models` display is only the accessibility check, not the selection order. Confirm the resolved model belongs to `llm` (`@llm` suffix), then merge its exact provider and model ID as `defaultProvider` and `defaultModel` into `settings.json`, preserving other settings. If the extension's default cannot be established or belongs to another integration, leave model defaults unchanged and report the ambiguity rather than choosing an arbitrary model. Run this before Pi processes start, without a model call. Read the default afresh on each VM; another machine's settings and hard-coded model IDs are not the source of truth.

The opt-in enables all attached LLM integrations, not only `llm`. Pre-seeding it skips the dialog's default-model selection, which is why step 3 is separate. Leave integration attachment changes to the user. No credential copy or custom `models.json` provider is needed. For schema or behavior changes, consult the checkout's `docs/research/2026-10-14-exe-dev-llm-default.md` and the installed extension source.

### Runtime discovery

Follow `readlink -f node_modules/.bin/pi` and inspect that installed package's declarations. Extension imports may use the legacy `@mariozechner` namespace even when Piano installs `@earendil-works`; the installed extension loader resolves those aliases.

The runtime used in this deployment supports this discovery-only sequence:

1. Call `loadExtensions` for the installed exe.dev extension and check its returned errors.
2. Register `runtime.pendingProviderRegistrations` on `ModelRuntime.create()` and await `getAvailable()`.
3. Apply the extension's provider/base-URL filter, then call its `chooseDefaultModel`.

Recheck the declarations when the installed version changes. This sequence creates no session and makes no model call.

## Install and start

On the VM, with Node on PATH:

1. Run `npm ci` if dependencies are absent, complete **Configure Pi's LLM integration** using that installed CLI, then run `npm run build`.
2. Install the three templates under `deploy/systemd/` into `/etc/systemd/system/`, adapting paths only when necessary.
3. Override the backend's placeholder origin in `/etc/systemd/system/piano.service.d/origin.conf`:

   ```ini
   [Service]
   Environment=PIANO_ALLOWED_ORIGINS=https://<vm>.exe.xyz
   ```

   Use the actual returned origin, without a trailing slash. Keep the template's loopback listeners and port layout.
4. Run `sudo systemctl daemon-reload`, then `sudo systemctl enable --now piano.service piano-web.socket` and `sudo systemctl start piano-web.service`. The enabled socket starts its proxy service when accessed after reboot.
5. Return to [Completion](../SKILL.md#completion). Retry the API briefly while the backend starts; preserve final successful output. Remove only transfer files and temporary directories created by this deployment.
