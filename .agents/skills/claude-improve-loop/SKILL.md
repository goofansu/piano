---
name: claude-improve-loop
description: "Send a fixed sequence of prompts to a dedicated Claude Code agent through Herdr. Leave implementation, review, verification, and publishing to Claude."
disable-model-invocation: true
---

# Claude improvement loop

Control Claude Code through Herdr. Send the prompts below and wait for Claude to finish. Do not review code, run tests, collect evidence, delegate work, or send repair prompts. Claude owns the work.

## 1. Start Claude

Read the installed `herdr` skill in full. Follow its instructions for CLI discovery, pane creation, agent identity, waits, and errors. If `HERDR_ENV` is not `1`, stop.

Run five rounds by default, or the round count the user supplies. Within that count, stop early only when Claude reports no useful candidates; otherwise start the next round whenever Claude reports that all PRs from the current round are merged.

Tell the user that Claude organizes improvements as a dependency-ordered stack of branches and worktrees, publishes PRs, and merges them in dependency order. Do not ask again for choices the user already supplied.

Create a sibling pane in the caller's current tab. Preserve the working directory and use `--no-focus`. Start a uniquely named Claude agent in the returned pane with permission prompts disabled:

```bash
herdr agent start <name> --kind claude --pane <pane-id> -- --dangerously-skip-permissions
```

The flag skips Claude's permission prompts. It does not authorize deployment or work outside the user's request.

Keep the pane ID, Claude session identity, working directory, round count, and last delivered prompt in the conversation. Use this dedicated agent for every round. Do not use an existing unrelated Claude pane.

## 2. Send the architecture prompt

Before each submission, confirm that the pane hosts the intended Claude session in the intended repository. Read its state and recent output. Wait if Claude or its background agents are still working. If Claude asks a question or needs approval, pass the question to the user.

Start each round by sending exactly this single-line prompt:

```text
/mattpocock-skills:improve-codebase-architecture find strong points, organize improvements as a dependency-ordered stack of branches and worktrees, parallelize only independent non-overlapping changes, base dependent changes on their prerequisite branches, verify according to repository instructions, publish pull requests for the stack, resolve review feedback and required checks, merge all pull requests in dependency order, verify the combined result, and report when every pull request is merged
```

Use `herdr agent prompt <target> <text> --wait --timeout <milliseconds>` with a finite timeout. Do not append instructions or round metadata.

Invoke the architecture command only once per round. If a wait times out, inspect Claude's state and output. Do not resend a prompt that may already have arrived. If delivery is uncertain, pause and tell the user.

Wait until Claude reports completion, no useful candidates, or a blocker. A settled Herdr state does not mean background agents have finished. Do not send follow-up work. If Claude cannot proceed, report the blocker and pause with the session preserved; resume waiting when it is resolved.

## 3. Reset and repeat

A round is complete when Claude reports that every PR from the round is merged and combined verification passed, with no outstanding work. While any PR remains unmerged or verification is blocked, preserve the session and wait rather than clearing it or starting another round. Leave verification of those results to Claude.

As the last command of each completed round, send this prompt separately:

```text
/clear
```

Confirm the reset and record the current session identity; a reset can change it without normal working activity. If rounds remain, always start the next round with the architecture prompt from section 2, without another reset or a request for approval to continue.

End when the round count is exhausted or Claude reports no useful candidates. Blockers pause the loop rather than end it; user instructions to pause or stop still take precedence. Do not deploy or send `/sync-exe-dev`.

Report the completed rounds, the PRs and merge results Claude reported, and any blocker. Label results as Claude-reported. Do not claim independent review or verification.
