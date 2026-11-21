# Delegate work to another session

Ask Pi to start a separate session for a task you want to track independently. Describe the task, the files or findings the new session needs, and what you want back. A new session starts with a fresh conversation and normally belongs to the same Piano project as its parent.

For example, you could ask “Start a separate session to review the changes on this branch. Ask it to report any failing checks and give me the session link.” Open the link to follow the work or answer a question there. If you want the result in the original conversation, ask Pi to wait for the new session’s answer.

When the new session needs to edit files alongside another session, ask for a **new worktree** and give it an unused branch name. Piano creates that worktree from the specified Git repository. Without a worktree request, the new session uses the selected directory.

## Dispatch from a terminal

Run the following from the Piano checkout on the machine running Piano. For the default local installation, set the connection addresses once in your shell.

```sh
export PIANO_SESSION_WS_URL=ws://127.0.0.1:7070/ws
export PIANO_SESSION_ORIGIN=http://127.0.0.1:7070
```

If you use another address, use the server’s loopback WebSocket URL and an allowed browser origin. Put your brief in a text file, then start a session. Replace the sample directory and branch with your own.

```sh
node scripts/dispatch-session.ts brief.txt /path/to/repo --worktree review-notes
```

Open the returned link to read the conversation. The start result tells you whether the session was created and how Pi handled the brief. To see whether the work finished or needs your input, use the session ID from the result.

```sh
node scripts/dispatch-session.ts status SESSION_ID
node scripts/dispatch-session.ts follow-up SESSION_ID more.txt
```

If the result reports uncertain delivery, inspect the session before sending the brief again. For automated starts, pass a JSON request through standard input with `node scripts/dispatch-session.ts --json < request.json`. Keep the prompt in the request file. Run `node scripts/dispatch-session.ts --help` for the required fields and other options.
