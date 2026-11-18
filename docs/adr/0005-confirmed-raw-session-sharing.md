# Confirmed raw session sharing

Session Share uploads the full saved Pi JSONL, unredacted, using the owning machine's Radius
provider sign-in and the organization's default visibility. This deliberately supersedes INV-11's
export-redaction guardrail for this explicit action only: preserving the native session file,
including saved branches and tool output, is the requested contract rather than a sanitized
transcript projection. Confirmation names the destination only ("Share to Radius"); by the owner's
decision it does not restate that the content is unredacted or that the default audience may be
public. Piano neither forces a private audience nor promises secret detection.

Each confirmed action creates a new artifact. No registry association, version synchronization or
automatic mutation retry is introduced (INV-01/02). On peers, main relays only the registered
identity and confirmation; the file and provider credential stay on the owner until the owner
uploads directly to Radius (INV-07/11/12). Missing sign-in names that machine in the UI, not main's
Providers. An unconfirmed upload is not success and warns the user to inspect Radius before sharing
again. Verification uses synthetic data; live transcript publication requires separate permission.

[Session sharing](../session-sharing.md) maps the implementation and checks.
