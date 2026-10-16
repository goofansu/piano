# exe.dev Settings and discovered Slack integrations

Research date: 2026-10-16. Inspected revision: `9965d47` (clean working tree).
Status: proposal only; this note does not implement the page or change deployed behavior.

## Recommendation

Rename **Settings → Notifications** to **Settings → exe.dev**. Make it the home for Piano's
exe.dev integration preferences, adding sections only when a feature needs them. The first section
is **Notifications**, with one clearable selection from the Slack integrations attached to this VM.
Keep the existing single-destination policy, completion event, session links and delivery limits.

The user explicitly requested a quiet UI with **no descriptions**:

```text
exe.dev

Notifications
Slack integration  [ slack-hook ▾ ]  [Clear]  [Test]
```

- Options show integration names only, sorted by name. No webhook input, helper paragraph,
  integration comments, connection diagnostics, introduction or placeholder future sections.
- Selection saves immediately; no separate Save button. Selecting never sends a message.
- Clear appears when something is selected and persists `null`, disabling future notifications.
  Test is available only for a selected, currently usable integration and is an explicit send.
- With no selection, the picker says “Select integration”. Do not select the only option
  automatically: notification delivery remains opt-in.
- Keep labels and accessible control names. “No descriptions” does not remove accessible names
  or concise, actionable errors.
- Empty result: “No Slack integrations” and a **Manage integrations** link to exe.dev.
  Failed discovery: “Couldn’t load integrations” and **Retry**. These are different states.
  No always-visible healthy status, detected-VM banner, timestamps or discovery internals.

Use the existing [`PianoSelect`](../../web/src/components/PianoSelect.tsx) wrapper over shadcn
Select, plus standard Field and Button controls. Select already supplies a scrollable option list;
there is no need to add a searchable combobox until actual option counts justify it. Put SelectItem
inside SelectGroup. Clearing is a separate button and a nullable saved preference, not a fabricated
Slack integration option. No upstream `ui/` edits are needed. [4]

## What exe.dev provides

The documented Reflection integration exposes:

- `GET https://reflection.int.exe.xyz/`: VM metadata and advertised metadata paths.
- `GET https://reflection.int.exe.xyz/integrations`: attached integrations with `name`, `type`,
  `comment` and `help` in the documented examples. [1]

Filter on **`type === "slack"`**, not a name prefix, substring or URL guess. This includes differently
named Slack webhook integrations and excludes mobile `notify`, Slack bots and generic HTTP proxies.
The catalog is **integrations attached to the current VM**, not every integration in the owner's
account. Reflection fields/attachments can be restricted; missing discovery is not an empty list. [1]

A read-only probe from this VM, with a one-second socket timeout, returned HTTP 200 and:

```json
[{"name":"slack-hook","type":"slack"}]
```

Only matching names/types were printed; no comments, help text, owner email or unrelated inventory
was retained. This proves that the proposed picker currently has one choice here, not that delivery
has been tested. No notification POST or integration configuration change was performed.

Official Slack examples attach `slack-hook` and POST Slack JSON to
`https://slack-hook.int.exe.xyz/`; custom names are supported, each integration targets one channel,
and exe.dev retains the actual secret Slack webhook. Integration names are not documented as Slack
channel labels: display the name without inventing a channel name. [2]

exe.dev's dashboard/SSH commands own creating, attaching and removing integrations. Reflection is
a discovery surface, not a documented write interface. In this first slice, “manages all exe.dev
integrations” means a home for **Piano's use of them**, not a replacement for exe.dev account-wide
administration. Link to [Manage integrations](https://exe.dev/integrations) for setup and attachment;
full remote administration would need separate research and authorization design. [3]

## Detection must not freeze the catalog

Preserve the agreed **one-second environment-detection timeout** and backend-lifetime positive
cache. Environment detection and the integration inventory have different lifetimes:

1. Detect from the Reflection index as today. Once detected, keep the exe.dev page visible until
   backend restart, even if later inventory requests fail.
2. Fetch the fixed `/integrations` path when the index advertises it. Give discovery its own
   one-second deadline, including reading/decoding the response, with a bounded body and no redirects.
   Do not turn the environment check into a combined two-second gate.
3. Refresh inventory on page entry, window focus and explicit Retry/Refresh; use a short backend
   cache (suggestion: 30 seconds) to coalesce callers. An explicit refresh bypasses that cache.
   Do not inherit the current “stop polling once detected” rule as a permanent inventory cache.
4. Represent available-with-zero-results, unavailable/error and not-yet-loaded separately. Preserve
   the saved selection when an inventory request fails; do not quietly overwrite it with null.
5. A successfully loaded list that no longer contains the saved name renders it as unavailable.
   Do not silently select another integration. Keep Clear usable and allow selecting a replacement.

The current implementation has only a detection result and scalar webhook; it does not yet query
`/integrations`. Its browser observation stops interval reads after detection, though it still
refreshes on focus. These are concrete changes, not just a label rename. [5]

## Selection, persistence and sending

The browser should submit an **integration name or null**, not an arbitrary URL. On selection,
the backend validates the name against a fresh discovery result of type `slack`, then constructs
the integration URL itself. Validate the name as a single DNS label before interpolation; never
execute or parse an integration's free-form `help` as a command. The documented Slack host convention
supports this approach; an unexpected name must be rejected rather than interpolated unsafely. [1; 2]

Keep the existing scalar database preference to minimize migration work: store the canonical URL
internally, but expose the selected integration name in the new Settings interface. For an already
saved URL, match it exactly to a discovered Slack destination. If it does not match, retain the saved
value as an unavailable selection that can be cleared/replaced; do not silently keep sending to an
unverified type or discard the user's configuration. Reflection's documented examples do not provide
an immutable integration ID, so a rename is treated as a missing old choice plus a new choice. [1; 5]

Before Test or queued delivery, resolve the selection against the current bounded-age Slack catalog.
Do not send if a successful refresh says it was detached or changed type. If the catalog is unavailable
and the last valid view has expired, skip automatic delivery rather than guessing; preserve the
preference for later recovery. This is a conservative recommendation, not an exe.dev delivery guarantee.

Clearing must not depend on successful discovery or a configured public link origin. It is a local
preference change, not detaching an exe.dev integration. Recheck the preference immediately before
sending so Clear/replacement skips old queued notifications; an in-flight POST cannot be recalled.
If selection fails or a concurrent read finishes late, the displayed selection must still reflect
what was actually saved. Existing observation mutation sequencing can be reused. [5]

Retain existing behavior: server-owned `response_completed` observation after a successful live
`agent_settled`, no extension, no replay on reopening history, fixed text plus **Open session**,
no Slack link previews, first configured HTTPS Piano origin for links, rate limiting, bounded queue
and best-effort delivery. No browser-owned sending and no model call needed to test a webhook. [5]

## Implementation shape and affected contracts

This fits the existing [ADR](../adr/0001-pi-rpc-workspace-workbench.md) and daily-use
[roadmap](../roadmap.md), without changing Pi ownership or the private hosting model.
Affected [invariants](../development-invariants.md): INV-01 (preferences versus external facts),
INV-02 (server-owned delivery), INV-03 (settled semantics), INV-05 (late read/mutation ordering),
and INV-11 (fixed network destinations and existing private access).

Suggested scope:

- One Settings destination named **exe.dev**, canonical route `/settings/exe-dev`, with Notifications
  as its first section. Keep `/settings/notifications` as a route alias for existing bookmarks, not
  an extra navigation/palette entry. Rename the shared destination so both surfaces agree. [6]
- An exe.dev discovery module owns Reflection validation, the positive detection cache and the
  separately refreshable catalog behind a small interface. The current HTTP adapter seam can be
  reused for tests. This keeps those decisions out of the page and the notification sender; do not
  build a generic integration plugin framework for future, unrequested features.
- Notifications continues to own the single preference, queued delivery and Slack payload. The
  Settings interface combines detection, discovered Slack choices and the saved selection. Future
  exe.dev sections can use the same discovery module without copying environment logic.
- Replace the URL form with the selector. Remove FieldDescription and routine success paragraphs;
  the selected value is the normal saved-state feedback. Keep short explicit Test feedback and
  actionable errors only. An old selection missing from inventory still has a clearable rendering.
- Update HTTP schemas/routes, route/command tests and the user guide. Keep credential-bearing
  inventory fields server-side; return only names/types needed by the implemented sections.

## Smallest useful verification

Claim: only an explicitly selected, currently recognized Slack integration receives a completion
notification; clearing stops future sends, and discovery errors never masquerade as an empty catalog.

- Fake Reflection: two Slack names plus non-Slack entries, empty list, missing advertised path,
  malformed/oversized response and one-second timeout. Detection success remains cached while
  inventory updates; no display or execution of `comment`/`help`.
- Settings contract: select one discovered name, reject an unknown/non-Slack name, replace, clear,
  reload, preserve a legacy URL, retain a stale selection across inventory errors and clear it even
  during an outage. A failed save or late read cannot misrepresent the persisted value.
- Delivery: a selected integration disappears or changes type; Clear/replacement races a queued
  send. Reuse existing settled/abort/retry/session-link checks instead of adding parallel versions.
- Scratch browser: exe.dev navigation/palette entry and old URL alias; quiet initial page, open
  selector, choose/test/clear, empty/error/unavailable states, keyboard and phone layout. Use actual
  pointer clicks for Radix. Retain style-shot pairs for the page rename/layout change.

This research changed documentation only: reviewed sources and local links, not application suites
or browser journeys. Deployment from the preceding request was separately confirmed by `DEPLOY OK`
in `/var/log/piano-deploy/manual.log`; no additional deployment was initiated by this research.
No push is authorized. The proposal remains unimplemented.

## Sources

1. [exe.dev Reflection integration](https://exe.dev/docs/integrations-reflection.md), reviewed earlier
   in this conversation; its documented inventory shape was checked against the read-only VM probe.
2. [exe.dev Slack integration](https://exe.dev/docs/integrations-slack.md), reviewed earlier in this
   conversation: named integration hosts, attachment, channel scope, payload and limits.
3. [exe.dev integrations overview](https://exe.dev/docs/integrations.md), fetched for this research:
   integration administration, default Reflection attachment and off-VM secrets.
4. [shadcn Select](https://ui.shadcn.com/docs/components/radix/select), fetched for this research;
   existing [`PianoSelect`](../../web/src/components/PianoSelect.tsx).
5. Current [`Notifications`](../../server/Notifications.ts), [wire settings](../../shared/notifications.ts),
   [settings page](../../web/src/components/NotificationSettings.tsx),
   [observation hook](../../web/src/lib/useNotifications.ts),
   [mutation ordering](../../web/src/lib/observation.ts) and [user guide](../notifications.md).
6. Shared [Settings destinations](../../web/src/lib/routes.ts),
   [page map/navigation](../../web/src/components/SettingsPage.tsx) and
   [global commands](../../web/src/lib/globalCommands.ts).
