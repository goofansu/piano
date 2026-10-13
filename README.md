# piano

Piano is a browser UI for [Pi](https://github.com/earendil-works/pi) sessions. It starts and
continues sessions across your folders and their Git worktrees.

## Use Piano

### Requirements

- Node.js 24 and npm.
- Git.
- [Worktrunk](https://worktrunk.dev) (`wt`) 0.80.0 or later on `PATH`, to create worktrees from
  Piano. Piano supports the latest release.
- Credentials for a model provider. Sign in through Piano, or reuse an existing Pi setup in
  `~/.pi/agent`. Piano installs the Pi runtime with its own dependencies.

### Install and start

1. Clone this repository and enter its directory.
2. Install dependencies, build the UI, and start the server:

	```bash
	npm install
	npm run build
	npm start
	```

3. Open <http://127.0.0.1:7070>.

Piano has no login and runs commands as your user. Keep it on loopback, or reach it through a
private authenticated proxy such as exe.dev's. Never expose it publicly. See
[browser origins](docs/configuration.md#browser-origins) for the access model.

### Sign in to a model provider

Open **Settings** at the bottom of the sidebar, then click **Sign in** next to a provider under
**Providers**. Start a new session afterwards, because a running session keeps the models it started
with. For remote sign-in and limits, see [provider sign-in](docs/provider-sign-in.md).

### Configure Piano

Piano reads environment variables such as `PORT`, `HOST`, `PIANO_DB_PATH` and
`PIANO_ALLOWED_ORIGINS`. Its registry lives in `~/.local/share/piano/piano.db` by default. For every
variable, the origin policy, and backup steps, see
[configuration and storage](docs/configuration.md).

## Develop Piano

1. Install dependencies. `npm install` also installs the pre-commit hook that runs lint.
2. Start the backend and the UI together:

	```bash
	npm run dev
	```

3. Open <http://localhost:5173>. Vite proxies API and WebSocket requests to the backend on 7070.

`npm run dev` restarts the backend when server files change, which stops running sessions. To
restart by hand instead, run `npm run build` and `npm start`. To run the two processes in separate
terminals, use `npm run dev:server` and `npm run dev:web`.

Before you commit, run:

```bash
npm run typecheck
npm test
```

Tests use a fake Pi and need no credentials. CI runs these checks, lint, the build and the browser
journeys on every pull request and push to `main`.

The code lives in `server/` (backend), `web/` (React UI), `shared/` (wire schemas) and `test/`.
Read these next:

- [Development checks and policy](docs/development.md): formatting, lint, CI and merging.
- [Development direction](docs/README.md): architecture, invariants and roadmap.
- [Evidence-based development and testing](docs/testing.md): what to test and how.
- [AGENTS.md](AGENTS.md): the rules coding agents follow in this repository.
