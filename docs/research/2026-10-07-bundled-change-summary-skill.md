# Bundling a change-summary skill inspired by Matt Pocock's pr

Date: 2026-10-07. Research and recommendation only; no runtime skill installed.

## Conclusion

Yes: adapt the `pr` skill into a bundled `piano-change-summary` skill. Its Summary / Evidence /
Merge Danger structure is a useful human-review entry point. Do not copy it as the complete workflow:
it is a presentation template, not a diff collector, verifier, or independent review.

## Primary sources

Inspected `mattpocock/skills` at `0e1b345683aa137d8e9c343e3573f31cfc185c43`, cached under
`~/.cache/checkouts/github.com/mattpocock/skills`:

- [pr/SKILL.md](https://github.com/mattpocock/skills/blob/0e1b345683aa137d8e9c343e3573f31cfc185c43/skills/engineering/pr/SKILL.md)
- [pr documentation](https://github.com/mattpocock/skills/blob/0e1b345683aa137d8e9c343e3573f31cfc185c43/docs/engineering/pr.md)
- [MIT license](https://github.com/mattpocock/skills/blob/0e1b345683aa137d8e9c343e3573f31cfc185c43/LICENSE)

Also read the installed Pi docs in `node_modules/@earendil-works/pi-coding-agent/`: README,
`docs/skills.md`, `docs/packages.md`, `docs/settings.md`, and `docs/cli.md`; inspected the child
launch in `server/PiSessions.ts`. This establishes a documented integration route, not a tested
runtime implementation. Research was direct because no background-agent tool is exposed.

## What upstream actually provides

The skill triggers when writing a PR body. It prescribes:

1. Summary: the smallest useful visual—pseudocode, call/component/file tree, Mermaid, or a shaped diff.
2. Evidence: concrete before/after screenshots, test runs, or output.
3. Merge Danger: reversibility (one-way/two-way door) and blast radius.

It asks for brief prose using the project's domain language. Its companion documentation explicitly
says it does not push, open PRs, choose the change scope, or keep the summary updated. It also notes
that the implementation agent's own risk judgment should not be trusted blindly, and that upstream
does not resolve conflicts with repository PR templates. [Skill and documentation]

This is useful because it explains the shape and consequence of a change before the reader opens
individual patches. It does not eliminate review: the summary is a model-authored navigation aid,
and its omissions and confidence can be wrong.

## Recommended adaptation

Use a distinct name, `piano-change-summary`, not `pr`: users may already have a PR skill, and Piano
also serves local changes and documents with no PR. Suggested user-facing action: **Summarize changes**.

Preserve the three ideas, but adapt the contract:

- **What changed:** a short user-visible outcome plus the smallest useful before/after sketch.
  Group by behavior, not by file. Link important claims to the relevant files or inspected diff.
- **Evidence:** cite observed commands/artifacts and their outcomes, and name missing checks.
  Never fabricate a failing-before run or screenshot to fill the template. Pseudocode can explain
  a check, but must not masquerade as an executed test.
- **Risks and review focus:** explain what could break, whether rollback reverses external effects,
  and what deserves human attention. Allow unknown rather than forcing a reassuring risk grade.
- Inspect an explicit comparison scope and revision. If missing, clarify it; do not assume a clean
  working tree means a session made no changes. A conversation summary is not repository evidence.
- Respect existing project instructions and PR templates when actually drafting a PR.
- Prefer text sketches initially: Piano's current Markdown renderer shows fenced code but does not
  render Mermaid diagrams. Local file links/artifact previews also need separate viewer work.
- Generate on request. Do not edit files, commit, push, create PRs, deploy, or start costly checks
  merely because the user asked for a summary. Read-only instructions are guidance, not sandboxing.

A skill can include scope/revision in its response, but reliable freshness and stored UI summaries
must be owned by Piano. If a future Changes panel caches a summary, bind it to the inspected content
and show that it needs updating after changes; do not infer currentness from fluent prose.

## Bundling route

Ship an application resource, for example:

```
resources/skills/piano-change-summary/SKILL.md
resources/skills/piano-change-summary/LICENSE
resources/skills/piano-change-summary/NOTICE.md
```

Pass its absolute path when Piano opens a real Pi session:

```
pi --mode rpc --skill /absolute/piano/resources/skills/piano-change-summary
```

Pi documents repeatable `--skill` paths, additive to normal skill loading. Do not use `--no-skills`,
replace the system prompt, install into users' home directories, or modify registered project files.
The `PiSessions` launch seam can supply the resource regardless of project/worktree cwd. Keep model
probes separate from this product capability. Include the resource in deployment/distribution.

Pi advertises skill names/descriptions and loads full instructions on demand. Explicit invocation
is `/skill:piano-change-summary <scope>`. Therefore "always available" should mean bundled in every
Piano-managed session by default, not always injected in full or automatically executed every turn.
Allow an explicit opt-out. Existing live children need a supported reload/resource update or safe
reopen; changing launch arguments does not retrofit them. Verify name-collision handling (Pi retains
the first discovered skill) rather than claiming the prefix makes collisions impossible.

A later Summarize changes control should invoke through Pi's normal prompt/action seam and have a
matching palette entry. Display absence or errors honestly; do not build another skill interpreter.

## License and policy

The inspected repository has an MIT license, copyright 2026 Matt Pocock. Copying/adaptation is
permitted with its copyright and permission notice retained. The skill also credits Dex Horthy /
Humanlayer's `show-me`; preserve that attribution in an adaptation and record the upstream revision.
Do not imply upstream endorsement. If importing additional Humanlayer material, inspect its license
separately rather than assuming Matt's repository notice covers that extra material.

This fits [INV-01, INV-09, INV-12–13](../development-invariants.md): Pi owns skill loading/history;
Piano may offer optional bundled guidance but does not make a particular skill mandatory or treat
its invocation/output as verification, approval, or an integration gate. Other compatible skills and
ordinary prompts must remain usable. Evidence should remain separate from registry config.

## Proposed implementation checks

- In a scratch project outside Piano, a real RPC child discovers and explicitly invokes the bundle.
- Existing project/user skills remain available, including a user skill named `pr`.
- New and resumed sessions have the resource; deployment contains it; explicit opt-out works.
- A short fixture with known changes yields the right scope, concise outcome, honest missing evidence,
  and specific risk, without modifying the checkout or publishing anything.
- A clean checkout with committed work is not described as "no changes" when that commit is the scope.
- A browser journey confirms invocation and readable output; `npm test` and typecheck for runtime edits.

Research-only checks: source/license inspection and local link review. No application tests, model
calls, installation, or deployment performed for this note.
