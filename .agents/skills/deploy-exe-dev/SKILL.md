---
name: deploy-exe-dev
description: Deploy Piano on the exe.dev VM this session runs on — a fresh install or an update of /home/exedev/piano to latest main — and leave it running on port 8000. Run on the VM itself; no SSH.
disable-model-invocation: true
---

# Deploy on exe.dev

Install or update Piano on the exe.dev VM this session runs on, and leave it running. This invocation authorizes cloning or fast-forwarding `/home/exedev/piano`, installing dependencies, building, installing the systemd units and restarting `piano.service`, even if that interrupts active Pi work, including this session. It does not authorize discarding local changes, copying credentials, or changing exe.dev access or integrations; those stay with the user.

Everything runs on the VM. The skill never uses `ssh` or `ssh exe.dev`. The target is always current `main` from `https://github.com/goofansu/piano.git`, a public repository that needs no credentials.

## 1. Check the VM

1. Confirm this is an exe.dev VM (`/exe.dev` exists) and `sudo -n true` succeeds.
2. Read the VM's name and shared port from `curl -s https://reflection.int.exe.xyz/` and `curl -s https://reflection.int.exe.xyz/default_port`. The browser origin is `https://<name>.exe.xyz`. If the shared port is not 8000, stop and ask the user to share port 8000 from the exe.dev dashboard.
3. Put Node 24 or later on PATH: `PATH="$HOME/node/bin:$HOME/.local/bin:$PATH"`, then `node --version`. The unit runs `/home/exedev/.local/bin/node`; if absent, `mkdir -p "$HOME/.local/bin" && ln -s /home/exedev/node/bin/node "$HOME/.local/bin/node"`. Install Node only if the required version is absent.

## 2. Get the target revision

```bash
repo=https://github.com/goofansu/piano.git
dir=/home/exedev/piano
```

- **Fresh install** (`$dir` absent): `git clone "$repo" "$dir"`.
- **Update** (`$dir` present): stop and report, never reset, stash or discard, unless all of these hold:
  - `git -C "$dir" rev-parse --is-inside-work-tree` succeeds (a directory left by a failed clone is not a checkout);
  - `git -C "$dir" status --porcelain` prints nothing;
  - `git -C "$dir" branch --show-current` prints `main`.

  Then fetch by URL, since checkouts made by older procedures may have an SSH `origin` that cannot authenticate, and fast-forward:

  ```bash
  git -C "$dir" fetch "$repo" main:refs/remotes/origin/main
  git -C "$dir" merge --ff-only refs/remotes/origin/main
  ```

Record the target with `target=$(git -C "$dir" rev-parse HEAD)`.

On an update, the running backend and proxy keep serving from this checkout while it changes: until the restart, a new Pi start or the built UI can briefly see half-updated files. No data is at risk.

## 3. Install and build

In `$dir`, with Node on PATH:

1. `npm ci`.
2. If `~/.pi/agent/exe-dev-llm-integration.json` is absent (honor `PI_CODING_AGENT_DIR`), follow [Configure Pi's LLM integration](references/llm-integration.md) using the installed Pi CLI. Otherwise leave Pi configuration unchanged.
3. `npm run build`.

## 4. Install units and start

1. Install the three templates under `deploy/systemd/` into `/etc/systemd/system/` when absent or changed, adapting paths only when necessary.
2. Set the browser origin, without a trailing slash, keeping the template's loopback listeners and ports:

   ```bash
   sudo mkdir -p /etc/systemd/system/piano.service.d
   printf '[Service]\nEnvironment=PIANO_ALLOWED_ORIGINS=https://%s.exe.xyz\n' "<name>" |
     sudo tee /etc/systemd/system/piano.service.d/origin.conf
   sudo systemctl daemon-reload
   ```

3. **Fresh install:** `sudo systemctl enable --now piano.service piano-web.socket`, then `sudo systemctl start piano-web.service`. The enabled socket starts the proxy service on demand after reboot, so a `disabled` proxy service is expected. Then run the completion check directly:

   ```bash
   sudo "$dir/.agents/skills/deploy-exe-dev/scripts/check.sh" "$target"
   ```

4. **Update:** a session started from Piano runs inside `piano.service`'s control group and is killed by its restart. Run the restart and the completion check together in a transient unit outside that group, logging to a root-owned file:

   ```bash
   log=/var/log/piano-deploy/$(date +%Y%m%d-%H%M%S).log
   sudo mkdir -p /var/log/piano-deploy
   sudo systemd-run --collect --unit="piano-deploy-$(date +%s)" \
     -p StandardOutput="append:$log" -p StandardError="append:$log" \
     bash -c "systemctl restart piano.service && $dir/.agents/skills/deploy-exe-dev/scripts/check.sh $target"
   ```

   Record the unit and log path before the restart, since this session may end. If a proxy unit changed, add `systemctl restart piano-web.socket piano-web.service &&` before the check.

## 5. Completion

[`scripts/check.sh`](scripts/check.sh) is read-only. It requires the checkout at the target SHA, 200 from the backend API (`8001`) and the built UI (`8000`), the three units active, the backend and socket enabled, and both ports bound to `127.0.0.1` only. It ends with `DEPLOY OK <sha>` and exit 0 only when every check passes. A queued restart or a successful build alone is not completion; on an update, read this run's `DEPLOY OK` from the log with `sudo cat "$log"` (or `journalctl -u <unit>`), from this session if it survived or from the next one.

Report the URL, SHA, check output or log path, and any limitations, and ask the user to reload the browser. These checks establish that Piano is serving, not session behavior.

Piano has no login of its own (INV-11), so exe.dev private access is what protects it. That is an exe.dev setting the VM cannot read; tell the user to confirm in the exe.dev dashboard that the VM is private, shares port 8000, and has no user, link or team shares. On a fresh install, direct the user to **Settings → Providers** for sign-in and to add folders. Leave model calls and credential transfer out of deploy-only work.
