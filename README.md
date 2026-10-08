# piano

A browser UI for [Pi](https://github.com/earendil-works/pi) sessions across projects and git worktrees.

## Requirements

- Node.js 24 and npm.
- Git.
- Pi configured with model credentials (default agent directory: `~/.pi/agent`). The Pi runtime is installed with Piano's dependencies.
- [Worktrunk](https://worktrunk.dev) (`wt`) on `PATH` for worktree support.

## Install and run

- Clone this repository and enter its directory.
- Install dependencies, build the UI, and start the server:

  ```bash
  npm install
  npm run build
  npm start
  ```

- Open <http://127.0.0.1:7070>.
- Keep Piano on loopback or behind private authenticated access: it has no built-in authentication and can execute commands as your user.

## Develop

- Start the backend in one terminal:

  ```bash
  npm run dev
  ```

- Start the UI in another terminal:

  ```bash
  npm run dev:web
  ```

- Open <http://localhost:5173>. Vite proxies API and WebSocket requests to the backend on port 7070.
- `npm run dev` restarts the backend on changes, interrupting active sessions. Use `npm start` when you want manual restarts.
- Run checks before committing:

  ```bash
  npm test
  npm run typecheck
  ```

- Tests use fake Pi and need no model credentials.
- Main directories: `server/` (backend), `web/` (React UI), `shared/` (wire schemas), `test/` (tests).
- See [development docs](docs/README.md) for architecture, invariants, and verification guidance.
- For the hosted exe.dev instance, use the [separate scratch development setup](docs/hosted-development.md#develop-and-verify-separately); do not develop against the running user instance.

## Configuration

- `HOST`: bind address; defaults to `127.0.0.1`.
- `PORT`: backend port; defaults to `7070`.
- `PIANO_CONFIG`: registry path; defaults to `~/.config/piano/config.json`. Use a separate file for scratch development.
- `PIANO_DEV_BACKEND`: Vite proxy target; defaults to `http://127.0.0.1:7070`.
- `PI_CODING_AGENT_DIR`: Pi settings, credentials, and sessions directory; defaults to `~/.pi/agent`.
- `PI_CODING_AGENT_SESSION_DIR`: override Pi's session storage directory.
- `PIANO_PI_CLI`: override the bundled Pi CLI entry path.
- `PIANO_PI_ARGS`: extra Pi arguments, such as `-e ./ext.ts`.
- `PIANO_IDLE_MINUTES`: idle time before retiring a session's Pi process; defaults to `30`, or `0` to disable.
