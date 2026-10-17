# Dispatch work to another session

In a Piano conversation, ask: **“Dispatch this work in a new session.”** The agent can use
`piano_start_session` to send a self-contained brief and `piano_wait_sessions` to observe the result.
The child is an ordinary session: it appears in the sidebar, has an **Open session** link, and can
be opened and continued without taking the parent away from its conversation.

## Setup and checkout choice

Piano loads its bundled extension when it starts Pi, using Pi's normal `--extension` mechanism.
No separate installation, API service, token, skill or database migration is needed. Existing
instructions, extensions, skills and model configuration still load normally. Already running Pi
sessions acquire the tools when next started; dispatch is not advertised outside a configured
Piano launch.

The child defaults to the parent's checkout, with a fresh conversation—not a transcript fork.
The optional `cwd` selects an existing directory through Piano's ordinary creation and registration
checks; it does not create a worktree. Concurrent writing tasks should use separate prepared
worktrees, or an explicit handoff. The optional `model` uses the normal `provider/model` selection;
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

Observation is scoped to the fresh session's initial submission and live host generation. Later
input, a restarted host, rewritten/compacted input, missing observations or unreadable projections can prevent attribution;
the result explains the limitation and links to the session. Handles live in normal Pi tool history,
not a durable job or per-turn receipt database. Reopening a parent does not restore a lost execution
observation. Inspect the child directly when an exact result cannot be established.

There is no automatic parent wakeup. The parent receives results while explicitly waiting; child
completion by itself does not start another parent turn.

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
