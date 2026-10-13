---
name: claude-improve-loop
description: "Send a fixed sequence of prompts to a dedicated Claude Code agent through Herdr. Leave implementation, review, verification, and publishing to Claude."
disable-model-invocation: true
---

# Claude improvement loop

Control Claude Code through Herdr. Send the prompts below and wait for Claude to finish. Do not review code, inspect PRs, run tests, collect evidence, delegate work, or send repair prompts. Claude owns the work.

## 1. Start Claude

Read the installed `herdr` skill in full. Follow its instructions for CLI discovery, pane creation, agent identity, waits, and errors. If `HERDR_ENV` is not `1`, stop.

Use one round unless the user gives a finite round count. Ask for a finite count if the request is unbounded. Merging requires explicit user permission. Record whether that permission covers one stack or every stack in the run.

Tell the user that Claude can create worktrees, branches, and stacked PRs. Do not ask again for choices the user already supplied.

Create a sibling pane in the caller's current tab. Preserve the working directory and use `--no-focus`. Start a uniquely named Claude agent in the returned pane with permission prompts disabled:

```bash
herdr agent start <name> --kind claude --pane <pane-id> -- --dangerously-skip-permissions
```

The flag skips Claude's permission prompts. It does not authorize merging, deployment, or work outside the user's request.

Keep the pane ID, Claude session identity, working directory, round count, merge permission, and last delivered prompt in the conversation. Use this dedicated agent for every round. Do not use an existing unrelated Claude pane.

## 2. Send the architecture prompt

Before each submission, confirm that the pane hosts the intended Claude session in the intended repository. Read its state and recent output. Wait if Claude or its background agents are still working. If Claude asks a question or needs approval, pass the question to the user.

Before the first round, send this prompt separately:

```text
/clear
```

Confirm that the reset completed. A reset can change the session identity without normal working activity. Record the new identity.

Then send exactly this single-line prompt:

```text
/mattpocock-skills:improve-codebase-architecture find strong points and fanout worktrees to implement in parallel, and create stack pull requests
```

Use `herdr agent prompt <target> <text> --wait --timeout <milliseconds>` with a finite timeout. Do not append instructions or round metadata.

Invoke the architecture command only once per cleared session. If a wait times out, inspect Claude's state and output. Do not resend a prompt that may already have arrived. If delivery is uncertain, pause and tell the user.

Wait until Claude reports completion, no useful candidates, or a blocker. A settled Herdr state does not mean background agents have finished. Do not send follow-up work. If Claude cannot proceed, report the blocker and stop.

## 3. Send the merge prompt when authorized

If the user has not authorized merging, report Claude's result and stop. Do not start another round on an unmerged stack.

If merging is authorized and Claude reports that the stack is ready, send exactly:

```text
merge all
```

Wait for Claude's result. Do not inspect GitHub or verify the merge yourself. If Claude reports a partial merge or a blocker, stop and preserve the session.

## 4. Reset and repeat

After Claude reports a successful merge with no outstanding work, send this prompt separately:

```text
/clear
```

Confirm the reset and record the current session identity. If rounds remain, send the architecture prompt from section 2 without another reset.

Stop when the round count is exhausted, Claude reports no useful candidates, a blocker remains, or the user intervenes. Do not deploy or send `/sync-piano`.

Report the completed rounds, the PRs and merge results Claude reported, and any blocker. Label results as Claude-reported. Do not claim independent review or verification.
