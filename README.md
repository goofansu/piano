# piano

A browser UI for [Pi](https://github.com/earendil-works/pi) sessions across folders and Git worktrees.

## Use

Requires **Node.js 24 or later** (use the latest patch release), npm and Git.
To create worktrees from Piano, also install
[Worktrunk](https://worktrunk.dev) (`wt` 0.80.0 or later) on `PATH`.
Pi is included; no separate Pi installation is needed.

```bash
git clone https://github.com/goofansu/piano.git
cd piano
npm install
npm run build
npm start
```

Open <http://127.0.0.1:7070>. [Sign in to a model provider](docs/provider-sign-in.md) in
**Settings → Providers**, or reuse existing Pi credentials in `~/.pi/agent`.
Then start a new session.

Piano has no login and runs commands as your user. Keep it on loopback or behind a private,
authenticated proxy; never expose it publicly.

See [using Piano](docs/use.md) for features and [configuration](docs/configuration.md) for
ports, storage and the access model. To continue sessions on another private exe.dev VM,
configure [remote Pianos](docs/remote-piano.md).

## Develop

See [development setup and checks](docs/development.md).
