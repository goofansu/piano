# Piano

Piano is a browser UI for [Pi](https://github.com/earendil-works/pi) sessions in your folders and Git worktrees.

## Run Piano

You need Node.js 24 or later, npm, and Git. Piano includes Pi.

1. Install and start Piano:

   ```bash
   git clone https://github.com/goofansu/piano.git
   cd piano
   npm install
   npm run build
   npm start
   ```

2. Open <http://127.0.0.1:7070>.
3. In **Settings → Providers**, sign in to a model provider. Piano reuses existing Pi credentials in `~/.pi/agent`.
4. Start a new session.

Piano has no login and runs commands as your user:

- Keep it on `127.0.0.1`, or behind a private proxy that requires sign-in.
- Never expose it to the internet.

See the [Piano user guides](docs/use.md) for each task.

## Develop Piano

1. Install dependencies: `npm ci`.
2. Run the CI checks locally: `npm run verify`.

See [development setup and checks](docs/development.md) for tools and focused checks.
