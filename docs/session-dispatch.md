# Dispatch work to another session

In a Piano conversation, ask: **“Dispatch this work in a new session.”** The agent can use
`piano_start_session` to send a self-contained brief, `piano_wait_sessions` to observe the result
and `piano_session_status` to read any session's status by its ID.
The child is an ordinary session: it appears in the sidebar, has an **Open session** link, and can
be opened and continued without taking the parent away from its conversation.

## From a terminal (Linux and macOS)

With Node.js 24, dependencies installed (`npm ci`) and Piano running **on the same machine**, run
the bundled script from any Piano checkout. It uses Node built-ins and Piano's existing dispatch
modules; there is no global CLI or extra dependency to install.

```bash
# From your Piano checkout; both bash and zsh work.
export PIANO_SESSION_WS_URL=ws://127.0.0.1:7070/ws
export PIANO_SESSION_ORIGIN=http://127.0.0.1:7070
printf '%s\n' 'Reply with exactly: READY' > /tmp/piano-brief.txt

# Print the complete start JSON (including handle and link) to stdout.
node scripts/dispatch-session.ts /tmp/piano-brief.txt "$HOME/work/my-repo"

# Alternatively, save the JSON as well. Use a fresh output path for each dispatch.
node scripts/dispatch-session.ts /tmp/piano-brief.txt "$HOME/work/my-worktree" /tmp/piano-start.json \
  --model provider/model-id --thinkingLevel medium

# Or start it in a new worktree on the new branch task-a, created from my-repo's repository.
node scripts/dispatch-session.ts /tmp/piano-brief.txt "$HOME/work/my-repo" --worktree task-a

# Read a session's status by its ID, or the status of every active session in a project.
node scripts/dispatch-session.ts status 0b6f…-session-id
node scripts/dispatch-session.ts list --project my-project-id
```

The two examples are alternatives: running both starts two sessions. The prompt argument is a
UTF-8 **file**, not inline text. Use `node /path/to/piano/scripts/dispatch-session.ts …` from
another directory; prompt, cwd and output paths are relative to your shell's current directory.

`--ws-url` and `--origin` override the respective environment variables. Both are required via
flags or environment. The WebSocket URL must use a loopback host (`127.0.0.1`, `localhost` or
`[::1]`), path `/ws`, and no credentials, query or fragment. The Origin must be an HTTP(S)
origin with no path or trailing slash, accepted by the server's
[origin policy](configuration.md#browser-origins). For example, Vite development may use
`--origin http://localhost:5173`; a private proxy setup uses its allowed public HTTPS origin and
the local backend's WebSocket port. The Origin also supplies the base for the returned session link.
This is not a remote-worker client: the directory must be on the server's machine.

Omit `--model` and `--thinkingLevel` to keep Piano's normal new-session defaults. Supported effort
values are `off`, `minimal`, `low`, `medium`, `high`, `xhigh` and `max`; the selected model must
support the chosen value. Run `node scripts/dispatch-session.ts --help` for the full syntax.

Piano places the directory the same way for every way of starting a session (the New page, the
`piano_start_session` tool and this script); see [checkout choice](#setup-and-checkout-choice).
`--worktree BRANCH` has Piano create a new worktree first, as described there; add `--hooks` to run
approved Worktrunk hooks. Without `--worktree`, no worktree is created.

Exit codes: `0` means a JSON result was reported, **not** that work succeeded; inspect `creation`
and `submission`. `1` is an unexpected failure, `2` invalid input or configuration (including a
session or project Piano does not list) and `3` an existing output file. Errors go to stderr. A
start result includes the full dispatch handle, the session `link` when known, the directory Piano
placed the session in as `cwd`, the created `worktree` (`{ "path", "branch" }`, or `null`) and the
requested `model` / `thinkingLevel` (`null` when omitted, not the resolved defaults). It does not wait for
the agent to finish. The handle can be passed unchanged to the existing `piano_wait_sessions` tool.

The optional output file is reserved exclusively before network side effects, including against
concurrent invocations, and kept once creation is attempted, even if the run was interrupted and
left it empty. An existing or empty output file is **not proof of success**. Inspect Piano before
retrying an uncertain dispatch; never blindly delete the file and resend. Without an output file
there is no file-based duplicate-dispatch guard.

## Links between sessions

In the parent's transcript, each start, wait or status read shows one row per child: the brief's
first line, the branch of the child's worktree when the parent knows it, the status the parent last
observed and an **Open** link. The status is that observation, not the
child's live state; **Finished** means the child stopped, not that its task succeeded. Expand the
row for the brief or the answer.

The child's transcript starts with **Dispatched from** and the parent's title, linked back to it.
When the parent is no longer in the sidebar, the row reads "another session" without a link. The
link is recorded in the child's own Pi history as a `piano.dispatch` custom entry, which never
reaches the model. Piano's extension writes it when the child's session first starts, and Pi saves
it with the first reply, so a child whose first prompt failed before any reply may have no backlink.

## Setup and checkout choice

Piano loads its bundled extension when it starts Pi, using Pi's normal `--extension` mechanism.
No separate installation, API service, token, skill or database migration is needed. Existing
instructions, extensions, skills and model configuration still load normally. Already running Pi
sessions acquire the tools when next started; dispatch is not advertised outside a configured
Piano launch.

The child defaults to the parent's checkout, with a fresh conversation—not a transcript fork.
The optional `cwd` selects an existing directory through Piano's ordinary creation and registration
checks. The root of a linked Git worktree is listed under its main checkout's folder, which Piano
adds when it is not a folder yet; any other directory, including a subdirectory of a checkout,
becomes a folder of its own, as on the New page. A checkout Git cannot read refuses creation.

The optional `worktree: { "branch": "task-a" }` gives the child a worktree of its own: Piano creates
the new branch's worktree through Worktrunk, as the New page does, from the folder of `cwd`'s
repository (the main checkout of a linked worktree, otherwise the checkout's root), registers it
under that folder and starts the child there. The sidebar lists it under the folder with its branch,
and its **Changes** shows only its own diff. Hooks are off unless `"hooks": true`, which runs
approved Worktrunk hooks. Give each concurrent writing task its own worktree (INV-07). A start
whose worktree cannot be created reports `creation: "refused"` with the reason in `detail`, creates
no session and never falls back to `cwd` itself; the reasons include:

- a branch that already exists, or a name Git does not accept as a new branch;
- a repository hook that needs approval when `hooks` is true (approve it with
  `wt config approvals` in a terminal, or leave hooks off);
- a `cwd` that is not a Git checkout.

When Worktrunk ran but failed, `detail` says that creation was not confirmed: a checkout may remain,
and the folder's worktrees are discovered again so it shows. Piano never removes a worktree, merges
it or opens a pull request for it.

The optional `model` uses the normal `provider/model` selection;
omitting it uses the new session's normal defaults, not necessarily the parent's model.
The optional `thinkingLevel` sets reasoning effort: `off`, `minimal`, `low`, `medium`, `high`,
`xhigh` or `max`. Choose a level supported by the selected model. Omitting it preserves normal
new-session effort defaults; it does not inherit the parent's current effort.

For example, the agent can call `piano_start_session` with:

```json
{
  "prompt": "Review the current diff for correctness. Do not edit files. Report actionable findings and the checks you ran.",
  "thinkingLevel": "high"
}
```

or, for one of several writing tasks:

```json
{
  "prompt": "Fix the parser bug described in #12. Add a regression test and run npm test.",
  "worktree": { "branch": "fix-parser" }
}
```

Include the objective, relevant decisions and files, constraints, expected output and necessary
checks in the brief. For example:

> Dispatch a review in the prepared review worktree. Review the current diff against the issue's
> acceptance criteria, do not edit files, run the focused checks, and report actionable findings
> with file locations and the checks you actually observed. Wait for the result.

## Results and limits

Start returns the created session reference and link in the tool's visible text and structured
result. Creation alone is not prompt admission: the tool waits for the initial input's disposition.
If a session was created but its prompt failed or needs a dialog answered, the result retains its
link. Resolve supported dialogs in the child's ordinary Piano UI.

Pass the returned handle unchanged to wait. A wait lasts 30 seconds by default, configurable from
1 to 60 seconds, and returns partial results. It distinguishes running, settled, failed, cancelled,
waiting for input and unknown outcomes. A wait deadline is not a child failure. Cancelling a wait
or closing the parent only stops observation; it does not stop the child or its siblings.
When one session needs attention, wait returns the other sessions' current observations promptly
rather than keeping the parent blocked; their work continues.

Settlement means execution stopped, **not that the task or its checks succeeded**. An input handled
without a new assistant answer returns `null`. The parent should assess the child's answer and
reported evidence rather than treating settlement as verification.

Observation is scoped to the fresh session's initial submission and live host generation. Input
equality uses opaque, process-keyed evidence computed by the server before display redaction,
with Pi skill commands normalized there. Creation adopts evidence only from a submission
carrying its own request correlation ID; another caller winning the first-submission race is
not its input. Redacted display text is never proof of equality.
The evidence is not persisted separately; old handles without it, missing proof, or a server
restart cannot establish attribution. Later input, a restarted host, rewritten/compacted input,
missing observations or unreadable projections can prevent attribution;
the result explains the limitation and links to the session. Handles live in normal Pi tool history,
not a durable job or per-turn receipt database. Reopening a parent does not restore a lost execution
observation. Inspect the child directly when an exact result cannot be established.

There is no automatic parent wakeup. The parent receives results while explicitly waiting; child
completion by itself does not start another parent turn.

## Status by session ID

`piano_session_status` with `{ "sessionId": "…" }`, or `node scripts/dispatch-session.ts status
<sessionId>`, reads what one session is doing and what it needs, without waiting or opening it.
`list --project <projectId>` reads every active (not archived) session of a project and prints one
JSON object per line. Any session Piano lists can be read, from any process, after a lost reply or a
Piano restart: the ID is enough. Each read is one answer; read again to observe later. Reading
never starts Pi and stores nothing.

```json
{
  "sessionId": "0b6f…",
  "cwd": "/home/me/work/my-repo.task-a",
  "projectId": null,
  "disposition": "needs_input",
  "since": "2026-10-21T06:12:03.000Z",
  "needs": { "title": "Enter a value", "kind": "input", "link": "http://127.0.0.1:7070/s/0b6f…" },
  "lastAnswer": null,
  "changes": { "branch": "task-a", "files": 2, "pullRequest": null },
  "link": "http://127.0.0.1:7070/s/0b6f…"
}
```

| Field | Meaning |
| --- | --- |
| `sessionId`, `cwd`, `projectId` | The session, the directory Piano placed it in, and its project; `projectId` is `null` outside a project. |
| `disposition` | `running`: Pi is working, stopping or holding queued input, or Piano still has work in flight for it (a dialog answer being delivered, an input or command Pi has not acknowledged yet). `needs_input`: Pi waits on a dialog only a person can answer. `settled`: execution stopped (Pi is idle with nothing pending, the same point `piano_wait_sessions` waits for; was released idle; or its history ends with a finished reply); **not** that the task succeeded (INV-03). `exited`: Pi stopped during work or on its own while this Piano ran. `unknown`: live facts are gone (Piano restarted, or the session was never readable) and its history proves no ending; or Pi is idle but Piano could not confirm delivering its last input or dialog answer, so whether Pi will act on it cannot be known. |
| `since` | When the dialog arrived for `needs_input`; otherwise the session's last recorded activity in Piano. |
| `needs` | For `needs_input` only: the dialog's title (or message), the kind of answer it wants (`select`, `confirm`, `input` or `editor`) and the link that opens it. `null` otherwise. |
| `lastAnswer` | The final reply of the last turn: the last assistant message after the last prompt, when it has text and is not a step toward a tool call, an interrupted or a failed reply. At most the first 2000 characters. `null` mid-turn, after a failure, or with no reply. |
| `changes` | The live Git view **Changes** shows for that directory: the checked-out `branch` (`null` when detached), the number of changed `files`, and the session's linked `pullRequest` (`number`, `url` and GitHub's `state`: `open`, `draft`, `merged` or `closed`, `null` when GitHub could not be read in 5 seconds). `pullRequest` is `null` without a link. `changes` is `null` when the directory is not a Git checkout Piano can read. |
| `link` | Opens the session in Piano. |

An unknown session or project is an error (exit code `2` from the script, a failed tool call in a
session). After a restart a session reads `unknown`, or `settled` when its saved history ends with
a finished reply; it never reads `running` from history.

## Connection failures

The extension uses the existing `/ws` protocol with a local URL and an allowed Origin supplied by
Piano's trusted launch configuration. The [origin policy](configuration.md#browser-origins) is
unchanged. A reconnect can reselect a known child, but never repeats creation or the first prompt.

If connection loss leaves creation uncertain, inspect Piano's sessions before dispatching again.
Automatic retry could create duplicate work. If the child link is known, open it to inspect the
current state; a transport error does not prove the child failed or stopped.

Piano's database remains schema 6. A database upgraded to schema 7 by the removed PIN-31 changes
requires separate operational handling before this server can open it; dispatch never resets or
downgrades user data.
