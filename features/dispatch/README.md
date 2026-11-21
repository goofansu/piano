# Dispatch work to another session

Tools: `features/dispatch/extension/index.ts`; terminal: `scripts/dispatch-session.ts --help`.

### Structured input for bots

Run the fixed command `node scripts/dispatch-session.ts --json` and pass one JSON object on
**stdin**, serialized by the caller's JSON encoder. Never put prompt content in shell source, a
heredoc, `echo` or `node -e`; without stdin, upload the request as a file and use `< request.json`.
Keep empty or uncertain result files and inspect Piano before any retry. Fields: `--help`.

## Developer navigation

- **Owners:** `scripts/dispatch-session.ts`, `features/dispatch/extension/`, `shared/session/dispatch.ts`,
  `server/app/ClientDispatch.ts`.
- **Not proved:** fake Pi makes no tool calls, so the extension's waits, the parent's tool rows and
  child backlinks in the UI need a real Pi or scripted model.
