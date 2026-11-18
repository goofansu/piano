# Dispatch work to another session

Tools: `extensions/piano-dispatch/index.ts`; terminal: `scripts/dispatch-session.ts --help`.

### Structured input for bots

Use the fixed command `node scripts/dispatch-session.ts --json` and send one UTF-8 JSON object
through the process's **stdin**, then close stdin. Serialize the object with your caller's JSON
encoder; pass the resulting bytes as the process/SSH/connector input, not inside its command
string. Prompt content never belongs in shell source, a heredoc, `echo`, or an interpolated
`node -e` program. If a connector cannot supply stdin, use its data/file-upload API to write the
serialized request, then use the fixed command with `< request.json`; do not generate shell
source to create that file.

Example request (JSON data, not a shell snippet):

```json
{
  "prompt": "Keep `backticks`, $HOME, $(commands), quotes and Unicode 🎹 literal.\nReply with exactly: READY\n",
  "cwd": "/path/to/my-worktree",
  "outFile": "/path/to/work/task.start.json",
  "wsUrl": "ws://127.0.0.1:7070/ws",
  "origin": "http://127.0.0.1:7070"
}
```

All five fields are required nonblank strings. `cwd` must name an existing directory on the
server's machine; `outFile` must be a fresh writable path with an existing parent directory.
Relative paths resolve against the script process's current directory. Connection fields have
the same loopback and origin restrictions as the terminal flags below; JSON mode does not fall
back to environment values. Optional fields:

| Field | Meaning |
| --- | --- |
| `worktree: { "branch": "task-a", "hooks": false }` | Ask Piano to create a new worktree; omit when `cwd` already is the chosen worktree. `hooks` is optional, default off. |
| `parentSession: "session-id"` | Record the parent and inherit its current Piano project. |
| `inheritProject: false` | Opt out of project inheritance while retaining the parent backlink. |

JSON mode is start-only and cannot be combined with positional arguments or other flags.
Malformed JSON, missing fields, wrong types, blank required values, unknown fields (including
model/effort overrides), invalid connection configuration or an unavailable local directory
exit `2` before reserving output or connecting. The server still performs ordinary admission
checks, such as whether the worktree branch or parent is available; inspect its result.
JSON and terminal starts pass one validation: `parentSession` and the worktree `branch` are
trimmed, and a blank `cwd` exits `2` in both forms.
`prompt` is validated as nonblank but is **not trimmed or otherwise rewritten**. The first
prompt, including leading/trailing whitespace, reaches Pi unchanged, as follow-ups do.

The same start implementation supplies the result, handle, session link, worktree targeting and
uncertain-dispatch reconciliation. JSON mode requires `outFile` so bots always have the exclusive
output-file guard described below: an existing file exits `3` before connection. Keep empty or
uncertain result files and inspect Piano before any retry. A result reports admission, not task
completion; no command here waits for the agent to finish.

## Developer navigation

- **Owners:** `scripts/dispatch-session.ts` (terminal), `extensions/piano-dispatch/` (the Pi tool),
  `shared/dispatch.ts` (their shared contract) and `server/ClientDispatch.ts` (the socket requests).
- **Smallest check:** `node --test --import ./test/setup.ts test/SessionDispatch.test.ts` for the
  extension, `test/DispatchScript.test.ts` for the script; then the
  [dispatch recipe](../.agents/skills/verify-piano/features/session-dispatch.md) on scratch Piano.
  `test/ClientSessions.test.ts` checks first-prompt preservation through the server boundary.
  `node test/browser/start-session.mjs <evidence-directory>` includes a JSON-stdin dispatch into
  a new worktree, its session link in the UI, and exact prompt comparison at the fake-Pi boundary.
- **Not proved:** fake Pi makes no tool calls, so the extension's waits, the parent's tool rows and
  child backlinks in the UI need a real Pi or scripted model.
