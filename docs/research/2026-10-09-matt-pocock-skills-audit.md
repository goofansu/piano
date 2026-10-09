# Matt Pocock skills: Piano bundle audit

Date: 2026-10-09. Research and recommendation only; no skills installed or runtime changed.

## Recommendation

Bundle a curated, Pi-adapted subset, not the engineering directory wholesale:

- **Adapt and include 15 selected skills:** code-review, codebase-design, diagnosing-bugs,
  domain-modeling, grill-with-docs, implement, improve-codebase-architecture, pr, prototype,
  research, retro, tdd, to-spec, to-tickets, writing-for-agents.
- **Add one dependency:** productivity/grilling. This is a proposed exception to the requested
  engineering + writing-for-agents selection, not an approved scope expansion.
- **Exclude:** ask-matt and setup-matt-pocock-skills, with the dependency repairs below.
- **Defer from the default bundle:** implement-spec, wayfinder, triage, wizard.

That makes **16 proposed bundled skills**, conditional on the adaptations and later runtime checks.
“Include” does not mean verified unchanged. Keep the upstream disciplines, patch harness assumptions,
respect existing project conventions, and make the changes reviewable. Do not build an orchestration
engine merely to make every upstream skill work.

## Sources and scope

Audited upstream commit [`b0618bc436ad893b3c5e84e55fba86586d34a404`][upstream], cached at
`~/.cache/checkouts/github.com/mattpocock/skills`. Read all 20 engineering `SKILL.md` files,
`writing-for-agents`, their Markdown references and two bundled shell templates, plus the
out-of-selection `grilling` dependency, upstream README and LICENSE. Inspected engineering
`agents/openai.yaml` headers for host-specific invocation metadata.

Piano baseline: `f548507` on `main`; installed Pi package: **1.1.0**. Pi facts below come from the
installed README, `docs/skills.md`, `docs/settings.md`, `docs/packages.md`, `docs/cli.md`, and
`dist/core/skills.js`. Inspected Piano's session launch in `server/PiSessions.ts`. This is source
and documentation inspection, not an execution compatibility claim. No background-agent tool was
available in this audit session, so the reading was performed directly.

[upstream]: https://github.com/mattpocock/skills/tree/b0618bc436ad893b3c5e84e55fba86586d34a404

## Findings that affect the bundle

### 1. Remove ask-matt, not replace it with another mandatory router

[ask-matt][ask-matt] routes the entire upstream collection, including excluded productivity skills,
and prescribes a main workflow, context-clearing advice, and a setup precondition. Its value is
navigation, not a capability the engineering skills require. No retained skill in this audit
requires ask-matt. Piano already has skill discovery in its composer; start there.

Removing it also removes recommendations to invoke unavailable `handoff`, `grill-me`,
`to-questionnaire`, `wait-what`, and `teach`, and avoids presenting `/clear` and `/compact` as
portable browser commands. Do not copy its context-size heuristics as model-independent policy.

### 2. The requested folders are not dependency-closed

The following are operational dependencies, not just related-skill suggestions:

| Consumer | Dependency |
| --- | --- |
| grill-with-docs | grilling + domain-modeling |
| improve-codebase-architecture | codebase-design + grilling + domain-modeling |
| triage (deferred) | grilling + domain-modeling + tracker/label configuration |
| wayfinder (deferred) | grilling + domain-modeling + research + prototype + tracker configuration |
| implement | tdd + code-review |
| tdd | codebase-design when designing the interface |
| retro | writing-for-agents |
| implement-spec (deferred) | tdd + code-review + tracker configuration |

[grilling][grilling] lives in `skills/productivity/grilling`, outside the user's initial selection.
Include it as the single additional dependency, with a direct-exploration fallback for its subagent
instruction. Alternatively drop the dependent skills; leaving broken references is not acceptable.

### 3. Removing setup requires replacing its configuration contract

Correction to the initial discussion: [setup-matt-pocock-skills][setup] is **not an installer**.
It scaffolds per-repository issue-tracker, triage-label, and domain-doc instructions; edits
AGENTS.md/CLAUDE.md; and can create forge labels after user confirmation.

code-review, implement-spec, to-spec, to-tickets, triage, and wayfinder explicitly refer users to it
when configuration is missing. Merely excluding it leaves workflows incomplete.

For retained skills, replace that prerequisite with:

1. Read the repository's existing instructions, tracker conventions, glossary location and templates.
2. Accept a task description or local spec without a tracker. code-review does not need setup to
   inspect a diff; label the Spec axis unavailable when no requirement source is supplied.
3. For spec/ticket output, use the requested destination. If unspecified, ask whether to draft locally
   or publish; use the repo's conventions rather than inventing a required `.scratch/` hierarchy.
4. Do not create labels, publish issues, or edit steering files as an automatic setup side effect.

This is a small adaptation to the skills, not a new Piano tracker registry or settings loader.
If exact upstream tracker flows are wanted later, retain an optional adapted setup skill instead.

### 4. Native Pi skill loading is compatible; tool instructions need translation

Pi supports SKILL.md, relative supporting files, `disable-model-invocation`, explicit
`/skill:name` invocation, and repeatable `--skill` paths. Its default tools are read/bash/edit/write;
there is no built-in Claude-style **Skill tool**. Replace “call the Skill tool” with instructions to
read the dependency's SKILL.md using its known location and follow it. Keep user-facing examples in
Pi's `/skill:name` syntax. Do not send nested slash-command text and assume it executes a skill.

Pi's README explicitly says it does not ship subagents. Extensions can add them, but their presence,
interface and lifecycle cannot be assumed in a default Piano-managed session. Current Piano session
launch does not provision a bundle-specific subagent capability.

For research, grilling, architecture exploration and design-it-twice, allow direct/sequential work
when delegation is unavailable. For code-review, two passes by one model are **not independent
reviewers**: label that limitation. Never simulate a subagent report or claim background execution.
For implement-spec, parallel worktrees, merges and cleanup are the workflow itself; defer rather than
pretend a prose fallback preserves it.

`writing-for-agents/SKILL-MECHANICS.md` needs a Pi-specific correction: hiding a skill's description
with `disable-model-invocation` is discovery control, not access control. A known file remains
readable by another skill. Pi's loader filters these skills out of the advertised prompt; it does
not make the files inaccessible. Retain the intended distinction between explicit workflow commands
and automatically selected reference skills without promising enforcement.

### 5. Browser-hosted operation changes artifact and human-input assumptions

- improve-codebase-architecture writes HTML in `/tmp` and runs `xdg-open`/`open`. That opens on the
  server, not the user's browser. Prefer Markdown/Mermaid in the conversation for the initial bundle.
  Its HTML reference loads CDN scripts and uses Mermaid `securityLevel: loose`; do not embed that
  generated document on Piano's control origin. A future artifact viewer needs a separate security
  design, not a skill workaround.
- prototype expects a double-clickable HTML file or a reachable dev URL. Make delivery explicit;
  do not promise that a remote local-file path is clickable or expose an unauthenticated dev server.
  Scratch data and read-only variants remain important.
- diagnosing-bugs' HITL template waits on terminal stdin. Replace that fallback with conversational
  steps and user-reported observations, or hand off to a terminal the user actually controls.
- wizard correctly says the agent must not run the wizard end-to-end, but still needs a human terminal,
  secret capture and forge access. Keep it optional for now. Its template is not a general security
  boundary: it preserves existing `.env` modes and follows symlinks; hidden input alone does not make
  every destination safe. Any later adaptation must validate where secrets are written, avoid logging
  their values and account for the user's forge host/auth setup.

### 6. Preserve methods without turning them into universal product policy

- codebase-design prescribes vocabulary aggressively; domain-modeling assumes a root GLOSSARY.md.
  Resolve the project's real docs and preserve its established terms instead of overwriting them.
- tdd requires confirmed seams and explicitly defers refactoring to review. This differs from the
  upstream README's red-green-refactor description. Treat the pinned SKILL.md as the actual source;
  do not impose that workflow on every Piano task or add tests solely to satisfy a ritual.
- diagnosing-bugs' demand for a fast, red-capable repro is useful, but not a promise every production
  or performance bug will yield one. Retain honest limitations and bound time/cost before escalation.
- to-spec demands an extremely extensive story list. Make scope proportional and preserve unresolved
  questions instead of inventing decisions to fill a template.
- pr demands before/after evidence. Permit “not captured” and “not run”; never fabricate a failing run
  or represent illustrative pseudocode as executed evidence. Respect the repository's PR template.
- implement commits by default; prototype captures branches and folds decisions into real code;
  wayfinder pushes research branches; triage comments, labels and closes issues. These are real side
  effects. Make them follow the user's request and project policy, not merely a skill being available.
- retro may inspect session logs and propose global instruction changes. Scope history to the requested
  session, keep Pi authoritative, and present recommendations before editing global configuration.

## Per-skill disposition

All included rows also need the shared compatibility and policy corrections above where applicable.

| Skill | Disposition | Specific adaptation or reason |
| --- | --- | --- |
| [ask-matt][ask-matt] | Exclude | Whole-collection router; unnecessary dependencies and nonportable context commands. |
| [code-review][code-review] | Adapt/include | Remove setup prerequisite; conditional subagents, honest sequential fallback. Correct scope: upstream advertises WIP but `git diff <base>...HEAD` omits uncommitted work; ask/capture the actual comparison and freeze refs/content for reviewers. |
| [codebase-design][codebase-design] | Adapt/include | Keep deep-module guidance and both references; allow sequential alternative designs; project vocabulary wins. Preserve meaningful checks when replacing tests, not indiscriminate deletion. |
| [diagnosing-bugs][diagnosing-bugs] | Adapt/include | Replace terminal-only HITL fallback; retain redaction, meaningful repro and bounded escalation. |
| [domain-modeling][domain-modeling] | Adapt/include | Discover existing glossary/ADR paths and formats before creating root duplicates. |
| [grill-with-docs][grill-with-docs] | Adapt/include | Almost entirely a Skill-tool wrapper; read grilling + domain-modeling through Pi. |
| [implement][implement] | Adapt/include | Resolve local/remote task; load tdd/review natively; define review scope before work; commit only per authorized workflow. |
| [implement-spec][implement-spec] | Defer | Assumes a task scheduler, implementer/merger subagents, worktree resets, integration and cleanup. Too much lifecycle ownership for an initial skill bundle. |
| [improve-codebase-architecture][improve-codebase-architecture] | Adapt/include | Load dependencies natively; sequential exploration fallback; Markdown report instead of server-local browser/CDN HTML. |
| [pr][pr] | Adapt/include | Preserve template intent and CREDITS.md; project template precedence, honest absent evidence, explicit unknown risk. No implicit publishing. |
| [prototype][prototype] | Adapt/include | Keep LOGIC.md/UI.md; deliver artifacts accessibly, isolate mutations, and request/observe authorization before production edits or branch operations. |
| [research][research] | Adapt/include | Direct research fallback; preserve cited primary-source note and actual tool-access limitations. |
| [retro][retro] | Adapt/include | Read writing-for-agents natively; limit session-log scope; proposals before edits. Do not assume every standards rule belongs only in review. |
| [setup-matt-pocock-skills][setup] | Exclude after repairs | Avoid mandatory repository scaffolding; replace its retained consumers' prerequisites as described above. |
| [tdd][tdd] | Adapt/include | Load codebase-design natively; recognize existing agreed seams/project policy; expose its actual red-green methodology honestly. |
| [to-spec][to-spec] | Adapt/include | Local-first option without mandatory tracker or labels; proportional stories and explicit publication destination. |
| [to-tickets][to-tickets] | Adapt/include | Retain approved vertical slices/dependencies; no setup requirement; local or requested tracker destination without mandatory labels. |
| [triage][triage] | Defer | Maintainer-specific label state machine, external writes and `.out-of-scope/` convention; useful optional workflow after tracker setup is designed. Untrusted PR execution also needs an explicit trust decision. |
| [wayfinder][wayfinder] | Defer | Heavy tracker conventions, session claims, research subagents and branch publishing. Assigning an issue is not an atomic concurrency lock for Piano. |
| [wizard][wizard] | Defer | Human terminal and secret/forge workflow, not browser-native; can remain user-installed. |
| [writing-for-agents][writing-for-agents] | Adapt/include | Keep writing guidance and SKILL-MECHANICS.md; correct host-specific discovery/invocation claims. |
| [grilling][grilling] (additional) | Adapt/include dependency | Required by retained interview workflows; replace mandatory subagent fact-finding with capability-aware exploration. |

## Packaging and maintenance proposal

1. Vendor only approved skill directories and their needed references/scripts as application resources,
   outside Piano's own `.agents/skills`. Contributor skills must not silently become the product bundle.
2. Pin upstream SHA, record selected paths, retain upstream MIT license (copyright 2026 Matt Pocock),
   and maintain a small adaptation changelog. Preserve pr/CREDITS.md and Humanlayer attribution.
   [The upstream license][license] permits redistribution/adaptation with its notice retained; this audit
   is not an independent legal provenance review of every attributed passage.
3. Use Pi's native loading through explicit application-resource paths. Do not mutate user-global
   settings or registered repositories, replace the system prompt, or disable their existing skills.
4. Decide name collisions before implementation. Native first-discovered-wins behavior is not an
   override policy. Distinct `piano-*` names avoid most accidental collisions but require consistent
   dependency/example rewrites; same names need a tested user-override policy. Recommendation: distinct
   names for modified skills plus a bundle opt-out, with names/provenance clear in command discovery.
5. Preserve explicit-only frontmatter for workflow commands; install does not mean execute. Package
   updates apply at a defined reload/reopen boundary, not by silently changing an active workflow.
6. Review updates as pinned diffs. No automatic tracking of upstream main and no import of its plugin
   marketplace configuration or Codex-specific YAML as if it configured Pi.

This preserves [INV-01, INV-09, INV-11–13](../development-invariants.md): Pi owns skill loading/history;
Piano owns its action boundaries; instructions and fluent summaries do not establish verification,
approval, sandboxing, or restart-safe orchestration. No ADR change is needed merely for optional defaults.
A mandatory sequence or new orchestrator would need a separate decision.

## Verification and limitations

Completed for this audit:

- Read the selected source bodies and supporting references/scripts at the pinned SHA, and inspect
  the extra grilling dependency. Count: 20 engineering skills + writing-for-agents; recommendation
  accounts for all 21, plus the proposed dependency.
- Compare assumptions against installed Pi 1.1.0 docs and Piano launch source at baseline `f548507`.
- Review this document's local links and pinned upstream file references, and run `git diff --check`.

No application code changed, no skill/model execution, no installation, no tracker writes, no registry
changes and no deployment. Application tests/typecheck/lint/browser checks are unnecessary for this
research-only change. Subagent extensions, tracker APIs and shell templates were not runtime-tested;
source recommendations do not establish their behavior in a user's configured environment.

Before shipping the bundle, verify the adapted files rather than merely proving discovery:

- Discover and explicitly invoke the bundle in a scratch checkout outside Piano, in new/resumed sessions.
- Exercise opt-out, existing same-name user/project skills, trust behavior and deployment resource paths.
- Check every dependency pointer/support file and explicit-only invocation behavior.
- Observe a short browser journey for planning, direct research and diff review with no subagent tool.
  Reports must disclose lack of independent review, include dirty/committed changes in the chosen scope,
  and show missing evidence honestly.
- Confirm a local plan does not create tracker issues/labels and a review does not commit or publish.
- Run required code-change gates only when runtime integration is actually implemented.

## Pinned upstream file references

[ask-matt]: https://github.com/mattpocock/skills/blob/b0618bc436ad893b3c5e84e55fba86586d34a404/skills/engineering/ask-matt/SKILL.md
[code-review]: https://github.com/mattpocock/skills/blob/b0618bc436ad893b3c5e84e55fba86586d34a404/skills/engineering/code-review/SKILL.md
[codebase-design]: https://github.com/mattpocock/skills/blob/b0618bc436ad893b3c5e84e55fba86586d34a404/skills/engineering/codebase-design/SKILL.md
[diagnosing-bugs]: https://github.com/mattpocock/skills/blob/b0618bc436ad893b3c5e84e55fba86586d34a404/skills/engineering/diagnosing-bugs/SKILL.md
[domain-modeling]: https://github.com/mattpocock/skills/blob/b0618bc436ad893b3c5e84e55fba86586d34a404/skills/engineering/domain-modeling/SKILL.md
[grill-with-docs]: https://github.com/mattpocock/skills/blob/b0618bc436ad893b3c5e84e55fba86586d34a404/skills/engineering/grill-with-docs/SKILL.md
[implement]: https://github.com/mattpocock/skills/blob/b0618bc436ad893b3c5e84e55fba86586d34a404/skills/engineering/implement/SKILL.md
[implement-spec]: https://github.com/mattpocock/skills/blob/b0618bc436ad893b3c5e84e55fba86586d34a404/skills/engineering/implement-spec/SKILL.md
[improve-codebase-architecture]: https://github.com/mattpocock/skills/blob/b0618bc436ad893b3c5e84e55fba86586d34a404/skills/engineering/improve-codebase-architecture/SKILL.md
[pr]: https://github.com/mattpocock/skills/blob/b0618bc436ad893b3c5e84e55fba86586d34a404/skills/engineering/pr/SKILL.md
[prototype]: https://github.com/mattpocock/skills/blob/b0618bc436ad893b3c5e84e55fba86586d34a404/skills/engineering/prototype/SKILL.md
[research]: https://github.com/mattpocock/skills/blob/b0618bc436ad893b3c5e84e55fba86586d34a404/skills/engineering/research/SKILL.md
[retro]: https://github.com/mattpocock/skills/blob/b0618bc436ad893b3c5e84e55fba86586d34a404/skills/engineering/retro/SKILL.md
[setup]: https://github.com/mattpocock/skills/blob/b0618bc436ad893b3c5e84e55fba86586d34a404/skills/engineering/setup-matt-pocock-skills/SKILL.md
[tdd]: https://github.com/mattpocock/skills/blob/b0618bc436ad893b3c5e84e55fba86586d34a404/skills/engineering/tdd/SKILL.md
[to-spec]: https://github.com/mattpocock/skills/blob/b0618bc436ad893b3c5e84e55fba86586d34a404/skills/engineering/to-spec/SKILL.md
[to-tickets]: https://github.com/mattpocock/skills/blob/b0618bc436ad893b3c5e84e55fba86586d34a404/skills/engineering/to-tickets/SKILL.md
[triage]: https://github.com/mattpocock/skills/blob/b0618bc436ad893b3c5e84e55fba86586d34a404/skills/engineering/triage/SKILL.md
[wayfinder]: https://github.com/mattpocock/skills/blob/b0618bc436ad893b3c5e84e55fba86586d34a404/skills/engineering/wayfinder/SKILL.md
[wizard]: https://github.com/mattpocock/skills/blob/b0618bc436ad893b3c5e84e55fba86586d34a404/skills/engineering/wizard/SKILL.md
[writing-for-agents]: https://github.com/mattpocock/skills/blob/b0618bc436ad893b3c5e84e55fba86586d34a404/skills/productivity/writing-for-agents/SKILL.md
[grilling]: https://github.com/mattpocock/skills/blob/b0618bc436ad893b3c5e84e55fba86586d34a404/skills/productivity/grilling/SKILL.md
[license]: https://github.com/mattpocock/skills/blob/b0618bc436ad893b3c5e84e55fba86586d34a404/LICENSE
