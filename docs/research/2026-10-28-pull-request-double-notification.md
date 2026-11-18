# Find from branch produces contradictory notifications

Investigated on October 28, 2026 at `c674970f1b6bb62c44ffac06e48544c8a9354011`.
The investigation below preceded the fix. Follow-up: `discover` now returns a failed outcome
for an error-bearing response before inspecting its retained link. Manual association saves keep
their separate semantics. Regression coverage includes discovery with and without an existing
link, plus saving a manual association while GitHub status is unavailable.

## Finding

When a session already has a PR link and branch discovery finds no replacement, one click
produces both **No matching open pull request for the current branch.** and **Pull request
linked**. The success is new, not the notification left over from manual linking.

The old association is correctly preserved. The client incorrectly treats its presence as proof
that discovery succeeded. This violates the quiet-UI rule that an action answers once with its
actual result; preserving session metadata remains necessary (INV-01/07).

## Causal chain

1. [`SessionPullRequests.result`](../../server/SessionPullRequests.ts), lines 144–149, keeps the
   existing link when discovery finds nothing and adds the no-match `error` to the returned
   snapshot. This is a normal HTTP 200 response, not a rejected request.
2. [`createSessionPullRequest.change`](../../web/src/lib/sessionPullRequest.ts), lines 247–275,
   calls `notify.error(body.error)` but still returns `_tag: "saved"`: only a thrown request
   failure sets its `failed` variable. The comment intentionally allows an association save to
   succeed even when live GitHub status is unavailable.
3. `discover` in that same file, lines 355–372, sees the retained `value.link` and returns the
   saved outcome before reaching its no-link/not-found handling.
4. [`LinkedPullRequestRow`](../../web/src/components/SessionPullRequest.tsx), lines 188–193,
   interprets `saved && value.link` as success and calls `toast.success("Pull request linked")`.
   The form's discovery handler uses the same condition at lines 301–306.
5. [`useSessionPullRequest`](../../web/src/lib/useSessionPullRequest.ts), line 35, connects the
   module's error notification directly to Sonner. Thus the error and success have separate,
   explicit producers; Sonner is displaying both as requested.

## Reproduction and evidence

Environment: Linux exe.dev VM, Node v24.22.1, isolated scratch database and seeded fake-Pi
history, real application UI/backend, controlled `gh` process fixture (no GitHub credentials or
network). The user's deployed Piano was not modified.

- Opened seeded **Loose session**, opened **Changes**, and manually linked
  `https://github.com/example/repo/pull/42` through the PR dialog.
- The controlled forge supplies that PR, but no matching branch candidate.
- Waited until **zero** toast elements remained before opening **Pull request actions → Find
  from branch**. Repeated twice; both runs reproduced the pair.
- Browser fetch instrumentation on the second run recorded exactly one discovery request:

  ```json
  {
    "body": { "action": "discover" },
    "status": 200,
    "response": {
      "link": {
        "source": "manual",
        "url": "https://github.com/example/repo/pull/42"
      },
      "error": "No matching open pull request for the current branch."
    }
  }
  ```

  The response also contained the existing PR's facts (omitted above). The DOM had one toaster.
  This rules out duplicate discovery requests and duplicate toaster mounts in this reproduction.

The repeatable browser check asserted one unsuccessful-discovery notification and failed:

```text
bash /tmp/verify-piano-evidence/20261028-035528-815926/reproduce.sh
Expected one unsuccessful-discovery notification; got
["Pull request linked","No matching open pull request for the current branch."]
```

Evidence directory: `/tmp/verify-piano-evidence/20261028-035528-815926/`:
`double-toast.png`, `reproduce.sh`, `requests.json`, and cleanup's `_run/` logs. The script targets
this scratch run and requires a newly launched/linked instance after cleanup. Temporary evidence
is not durable across VM cleanup.

## Existing coverage and proposed correction

These focused tests passed (2/2):

```bash
node --test --import ./test/setup.ts \
  --test-name-pattern='Find from branch with nothing found|unknown/auth/malformed' \
  test/SessionPullRequestLink.test.ts test/SessionPullRequests.test.ts
```

The [client test](../../test/SessionPullRequestLink.test.ts), starting at line 692, proves one
notification only for an **unlinked** session receiving `{ link: null, pullRequest: null }`.
The [server test](../../test/SessionPullRequests.test.ts), lines 164–170, protects preservation of
the existing association after unsuccessful discovery, not the resulting client notifications.
Neither tests the full combination of a retained link, a discovery error, and the UI success
handler.

Recommended follow-up:

- Give unsuccessful discovery an outcome distinct from a saved association, even when its
  snapshot retains an existing link. Do not infer action success from `value.link` alone.
- Preserve the old link; do not fix the notification by deleting user metadata.
- Make one layer responsible for choosing the discovery notification.
- Add coverage for an already-linked session with no branch match: exactly one no-match
  notification, no success toast, existing link unchanged. Also retain coverage for successful
  discovery and for a manual association saved while GitHub status is unavailable; globally
  treating every snapshot `error` as a failed save would conflate those cases.

The initial investigation did not apply a fix or run the full baseline checks. Browser evidence
verifies Piano's handling of the controlled response, not live GitHub behavior.
