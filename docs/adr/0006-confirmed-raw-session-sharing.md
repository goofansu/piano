# ADR 0006: Confirmed raw session sharing

Session Share uploads the full saved Pi JSONL, unredacted, using Piano's Radius
provider sign-in and an explicit `private` visibility. This deliberately supersedes INV-11's
export-redaction guardrail for this explicit action only: preserving the native session file,
including saved branches and tool output, is the requested contract rather than a sanitized
transcript projection. Confirmation states the destination and the `private` visibility
Piano requests; it makes no claim about who can view a private artifact and promises no secret
detection.

Each confirmed action creates a new artifact. No registry association, version synchronization or
automatic mutation retry is introduced (INV-01/02). The browser sends only the registered
identity and confirmation; the file and provider credential stay on the server, which uploads
directly to Radius (INV-07/11/12). An unconfirmed upload is not success and warns the user to inspect Radius before sharing
again. Verification uses synthetic data; live transcript publication requires separate permission.

[Session sharing](../../features/sharing/README.md) maps the implementation and checks.
