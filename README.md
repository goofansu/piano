# Piano

Piano is a browser UI for [Pi](https://github.com/earendil-works/pi). Use it to run Pi sessions
in your folders and Git worktrees, and to come back to them later.

## Run Piano

You need Node.js 24 or later, npm, and Git. Piano includes Pi.

```bash
git clone https://github.com/goofansu/piano.git
cd piano
npm install
npm run build
npm start
```

Open <http://127.0.0.1:7070>. In **Settings → Providers**, sign in to a model provider. If Pi
already has credentials in `~/.pi/agent`, Piano uses them. Then start a new session.

Piano has no login and runs commands as your user. Keep it on `127.0.0.1`, or put it behind a
private proxy that requires sign-in. Never expose it to the internet.

To find a task, see the [Piano user guides](docs/use.md).

## Develop Piano

Install dependencies with `npm ci`. Run `npm run verify` to run the checks that CI runs on every
pull request. [Development setup and checks](docs/development.md) lists the tools you need and the
focused checks.
