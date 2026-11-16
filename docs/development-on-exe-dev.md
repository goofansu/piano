# Developing on exe.dev

Private access, contributor skills and PR evidence when developing Piano on an exe.dev VM. The
deployed instance is covered by [hosted deployment](hosted-development.md); scratch verification by
[verify-piano](../.agents/skills/verify-piano/SKILL.md).

## Private access

Keep `HOST=127.0.0.1`. The current application has no auth and can execute commands with the
developer's credentials. Access the loopback listener with SSH forwarding from your local machine:

```bash
ssh -N -L 127.0.0.1:7070:127.0.0.1:7070 <your-machine-ssh-destination>
```

Open `http://127.0.0.1:7070` locally. Substitute the SSH destination supplied for your machine;
this is a standard tunnel recipe, not an asserted exe.dev-specific hostname. If the local port is
busy, choose another local port.

Do not publish the raw control port or set `HOST=0.0.0.0` as an access shortcut. Any authenticated
proxy alternative must protect both HTTP and WebSocket routes, prevent bypass of the proxy and apply
the origin/access controls in INV-11. Serve generated application previews separately from control.

## Optional contributor skills

You may use Matt Pocock's skills, custom skills or ordinary prompting to develop Piano. Configure
them through your normal Pi environment and follow the installed version's instructions; the
[upstream collection](https://github.com/mattpocock/skills) evolves independently of Piano.
Use the repository's glossary, ADRs and invariant IDs as project context. Skill-generated specs,
plans and review findings can reference these documents without dictating Piano's product schema.

No specific skill package, invocation sequence or document template is required to use Piano.
Skill execution does not establish verification: retain the actual test/browser evidence and the
requirement and revision it supports. See INV-09 and INV-13.

## PR evidence

The GitHub proxy rejects `gh pr comment --attach` with “attaching files is not supported on GitHub
Enterprise Server”. Include textual results directly in the PR. For screenshots or recordings,
use a supported publication route when available; before reporting delivery, verify that the link
in the PR shows the intended visual evidence and is accessible to reviewers.

If publication is unavailable, retain the captures locally and continue commit → push → open PR
without pausing for delivery instructions. State in the PR and completion summary: “Visual evidence
captured locally; not published.” Local paths are staging, not delivered evidence; textual results
do not substitute for visual evidence. This fallback permits PR creation, not a claim that required
visual evidence has been delivered or verification requirements have been waived.
