# piano

Piano is a browser UI for [Pi](https://github.com/earendil-works/pi) sessions. It starts and
continues sessions across your folders and their Git worktrees.

## Use

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

Piano has no login and runs commands as your user. The Piano host must be private: reachable only
by its trusted developer, on loopback or through a private authenticated proxy such as exe.dev's.
Never expose it publicly. This is a host-access rule, not a repository-privacy requirement;
development and the repository can be public. See
[browser origins](docs/configuration.md#browser-origins) for the access model.

### Sign in to a model provider

Open **Settings** at the bottom of the sidebar, then click **Sign in** next to a provider under
**Providers**. Start a new session afterwards, because a running session keeps the models it started
with. For remote sign-in and limits, see [provider sign-in](docs/provider-sign-in.md).

### Preview local files

Click a local file link in a session to read it beside the conversation. Markdown offers
**Preview / Source**; code, images, audio, video and PDFs use type-aware viewers. **Download**
saves the file as it is on disk. Click the link again to reread. See
[supported formats, limits and privacy](docs/file-previews.md).

### Run an app preview

On macOS, or on a configured private exe.dev host, ask **“Run this app so I can try it.”** The
agent launches an app in the session's workspace and returns a preview link (on a Mac,
`http://localhost:<port>/`). It keeps running after the reply, Stop and browser disconnect,
but ends with its owning Pi process (including archive/delete or Piano shutdown).
Ask the agent to stop the exact instance when finished. See [setup and limits](docs/live-previews.md).

### Dispatch work to another session

Ask **“Dispatch this work in a new session.”** The agent starts a fresh, visible session with a
self-contained brief, returns an **Open session** link, and can wait for its answer. Use separate
prepared worktrees for concurrent writing tasks. See [session dispatch](docs/session-dispatch.md)
for setup, checkout semantics and bounded observation, or use the bundled
[terminal dispatch script](docs/session-dispatch.md#from-a-terminal-linux-and-macos).

### Send session events to a webhook

Open **Settings → Webhooks**, click **Add webhook**, enter your receiver URL and optional Bearer
token, and choose the events to send. Use **Send test** to check delivery. See
[payloads, delivery limits and privacy](docs/webhooks.md).

### Configure

Piano reads environment variables such as `PORT`, `HOST`, `PIANO_DB_PATH` and
`PIANO_ALLOWED_ORIGINS`. Its registry lives in `~/.local/share/piano/piano.db` by default. For every
variable, the origin policy, and backup steps, see
[configuration and storage](docs/configuration.md).

## Develop

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
