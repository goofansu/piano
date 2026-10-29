# Developing on exe.dev

This is a handoff recipe for the current trusted-developer model, not a deployment or authentication
implementation. No exe.dev machine was accessed for the documentation PR. Use your own machine's SSH
connection details and repository credentials.

Read [ADR 0001](adr/0001-pi-rpc-workspace-workbench.md), the
[invariants](development-invariants.md) and [roadmap](roadmap.md) before continuing.
Use [the testing policy](testing.md) to choose proportional evidence for each change to Piano.

## Private access

Keep `HOST=127.0.0.1`. The current application has no auth and can execute commands with the
developer's credentials. Access the loopback listener with SSH forwarding from your local machine:

```bash
ssh -N -L 127.0.0.1:7070:127.0.0.1:7070 <your-machine-ssh-destination>
```

Open `http://127.0.0.1:7070` locally. Substitute the SSH destination supplied for your machine;
this is a standard tunnel recipe, not an asserted exe.dev-specific hostname. If the local port is
busy, choose another local port. A scratch instance on 7171 needs its own matching forward.

Do not publish the raw control port or set `HOST=0.0.0.0` as an access shortcut. Any authenticated
proxy alternative must protect both HTTP and WebSocket routes, prevent bypass of the proxy and apply
the origin/access controls in INV-11. Serve generated application previews separately from control.

## Checkout and baseline

Use Node 24 and Worktrunk on PATH; configure Pi credentials/resources for your own account on the
machine. Keep credentials outside the repository. In an authenticated repository checkout:

```bash
git fetch origin
git switch main
git pull --ff-only
npm ci
npm test
npm run typecheck
npm run build
HOST=127.0.0.1 npm start
```

After this ADR PR merges, its documents are on main. Before merge, check out the PR branch for these
documents. Do not overwrite uncommitted development work or stop an existing Piano process.

The package default uses the repository's Pi dependency; `PIANO_PI_CLI` can override it. Record the
effective CLI version/path when reporting checks. A global `pi --version` alone does not establish
the version Piano actually spawns.

## First implementation: Pi 1.0.2

At the documentation PR's base, package.json is `^1.0.0` and the lock resolves 1.0.0. In a separate
implementation branch, deliberately upgrade both dependency declaration and lockfile:

```bash
npm install @earendil-works/pi-coding-agent@1.0.2 --save-exact
npm test
npm run typecheck
npm run build
```

Inspect the dependency diff and retain the exact tested version. The exact pin is the suggested
upgrade policy so the next runtime change is deliberate; the ADR documentation PR leaves dependencies
unchanged. Follow milestone 1 for protocol fixes.

Compare the tagged [changelog](https://github.com/earendil-works/pi/blob/v1.0.2/packages/coding-agent/CHANGELOG.md)
and [RPC contract](https://github.com/earendil-works/pi/blob/v1.0.2/packages/coding-agent/docs/rpc.md),
including the linked commands, JSON events and extension UI documentation. 1.0.2 sampling settings
and 1.0.1 project MCP overrides remain Pi configuration; Piano should preserve their normal loading.

## Optional contributor skills

You may use Matt Pocock's skills, custom skills or ordinary prompting to develop Piano. Configure
them through your normal Pi environment and follow the installed version's instructions; the
[upstream collection](https://github.com/mattpocock/skills) evolves independently of Piano.
Use the repository's glossary, ADRs and invariant IDs as project context. Skill-generated specs,
plans and review findings can reference these documents without dictating Piano's product schema.

No specific skill package, invocation sequence or document template is required to use Piano.
Skill execution does not establish verification: retain the actual test/browser evidence and the
requirement and revision it supports. See INV-09 and INV-13.

## Scratch verification

Follow [the `verify-piano` skill](../.agents/skills/verify-piano/SKILL.md): leave the user's running instance and real registry alone. Use a throwaway
Git repository, separate registry and port, and isolate Pi resources/session storage as needed.
Use an absolute scratch path that you created:

```bash
HOST=127.0.0.1 PIANO_ALLOWED_ORIGINS=http://127.0.0.1:7172,http://localhost:7172 PIANO_DB_PATH=<scratch-path>/piano.db PORT=7171 node server/main.ts
```

Start the development UI separately, pointing it only at that scratch backend:

```bash
PIANO_DEV_BACKEND=http://127.0.0.1:7171 npm run dev:web -- --host 127.0.0.1 --port 7172 --strictPort
```

Observe `http://127.0.0.1:7172` through `npx agent-browser`, retaining output. The systemd
instance serves the built UI for daily use; it is not the browser-verification target. See
[the hosted workflow](hosted-development.md) for deliberate build/deploy steps.
Run both scratch processes in dedicated terminals and retain their PIDs if backgrounding;
stop only your processes. For credentialed smoke checks use a short prompt such
as "Reply with exactly: PIANO102", read it back, reload, and confirm history. Use fake Pi for
race/fault scenarios; do not pay for model calls to simulate protocol races.

Record version, checkout revision, command/output, browser observations and unresolved gaps. Clean
up only scratch worktrees, branches, processes and scratch session files. Never blanket-delete
`~/.pi/agent/sessions`. A docs review is not a 1.0.2 smoke test or proof of runtime recovery.
