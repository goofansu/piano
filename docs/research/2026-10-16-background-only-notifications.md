# Background-only completion notifications

Research date: 2026-10-16. Inspected revision: `a15c7e8` (clean working tree).
Status: proposal and source review, not an implementation. Nothing was run against a Piano instance.

## Recommendation

Yes, with one honest limit: Piano can suppress the Slack line while a browser has the session
**on screen and focused**, and it cannot know that a person who left such a window is no longer
reading it. Build design (a) below, named after the HTML spec's own term: a browser attached to a
session reports **attention** (`visible` and `hasFocus()`), the server keeps it only for the life of
that socket's attachment, and the completion worker drops a notification when any attachment to the
session has attention at send time, after a short grace. Concretely:

1. **Wire.** Add `ClientMessage` variant `attention: { selectionId, watching: boolean }` next to
   `select`/`act` in `shared/wire.ts:803-823`, not a `SessionAction`. `SessionAction` is what a
   browser does *to the running Pi session* through `PiSessions.act` (`shared/wire.ts:488-507`,
   `server/PiSessions.ts:591-600`), with stop policy and inbound capacity; attention is a fact about
   the browser's selection, which `server/ClientSessions.ts` already owns per socket (`selected`
   and `attachment` at lines 91-92). Nothing Pi-specific crosses the seam in either direction.
2. **Server state.** A small `SessionAttention` service (in-memory `Map<sessionId, Set<token>>`,
   token = one attachment) with `watch(token, sessionId, watching)`, `release(token)` and
   `watched(sessionId)`. `ClientSessions.attachTo` registers the token in the attachment's `Scope`
   and the existing `detach`/finalizer (`server/ClientSessions.ts:102-107, 115-118`) releases it, so
   a reselect, a closed tab, a dropped socket or a server-closed socket all clear presence without
   a timestamp sweep. A stale selectionId is ignored, as `act` is refused as stale today (line 202).
3. **Worker.** In `server/Notifications.ts:114-130`, after `Queue.take`, sleep a grace
   (`Context.Reference`, default 10 s, like `PiDialogRecoveryMs` in `server/PiSessions.ts:229-231`),
   then apply the existing checks and add `if (yield* attention.watched(sessionId)) return;` on
   line 121, immediately before `send`. A skipped send pushes nothing into `sentAt`, so suppression
   never spends the five-per-minute budget.
4. **Browser.** A pure `web/src/lib/attention.ts` with an environment seam (`visibilityState`,
   `hasFocus`, `visibilitychange`, `focus`, `blur`), as `observation.ts:25-33, 68-76` and
   `checkoutRefresh.ts:12-24` already do, sends `attention` when the computed value changes and
   again whenever `client.select` (re)sends a selection (`web/src/lib/client.ts:155, 164, 203-214`),
   so a reconnect re-establishes presence (INV-05). No UI, no setting, no new HTTP route (INV-11).

Smallest verification (docs/testing.md §The development loop): **claim** "a completion is not
posted while an attached browser has attention and is posted once it has none"; **invariant**
INV-02 (delivery stays server-owned and survives browser lifecycle); **check** extend
`test/Notifications.test.ts` "server-owned completion sends one session link ... without a browser"
(lines 212-278) with a second case that marks attention through the module boundary, settles a
prompt from `test/fake-pi.mjs`, advances `TestClock` past the grace and asserts no send; then
withdraws attention (or closes the attachment scope), settles again and asserts exactly one send.
A `ClientSessions.test.ts` case ("INV-02: retiring the selected session detaches ...", line 261,
is the pattern) asserts that closing the attachment releases attention. One `agent-browser` run on a
scratch instance records the journey: focused tab, no Slack POST (mocked); hidden tab, one POST.

## Browser signals and their limits

- **Visibility is a per-document state the user agent decides.** The spec: "A traversable
  navigable's system visibility state, including its initial value upon creation, is determined by
  the user agent. It represents, for example, whether the browser window is minimized, a browser tab
  is currently in the background, or a system element such as a task switcher obscures the page."
  When it changes the agent updates the document and fires `visibilitychange`. [1]
- **Visible is not attended.** MDN: `visible` means "the foreground tab of a non-minimized window";
  "While `onblur` and `onfocus` will tell you if the user switches windows, it doesn't necessarily
  mean it's hidden. Pages only become hidden when the user switches tabs or minimizes the browser
  window containing the tab." A Piano tab behind another application's window is `visible`. [2]
- **The composite exists in the spec.** "A top-level traversable has user attention when its
  system visibility state is 'visible', and it either has system focus ..." [1]. Chrome's lifecycle
  guide names the same split: active is "visible and has input focus", passive "visible and does
  not have input focus", and its sample derives the state from `visibilityState` then
  `document.hasFocus()`. [3] `hasFocus()` "returns a boolean value indicating whether the document
  or any element inside the document has focus"; "an active element within a popup window that is
  not the foreground doesn't have focus". [4] Window `blur` "fires when the window has lost focus,
  for example when the user moves focus from the page to the address bar". [5]
- **Obscured windows are undetermined.** MDN's API page says the event fires when "the document is
  entirely obscured by another window", while its `visible` definition and `onblur` note say only
  tab switches and minimising hide a page [2]; the spec leaves it to the agent [1]. Treat macOS
  Spaces, full-screen apps and overlapping windows as unknown; `hasFocus()` is the usable signal
  there, and it is what the proposal uses.
- **Hidden is the last reliable event; frozen pages are silent.** "The transition to hidden is also
  often the last state change that's reliably observable"; on mobile "the beforeunload, pagehide,
  and unload events are not fired" when a tab or the app is closed; a frozen page runs no timers or
  fetch callbacks; discard from hidden fires no events. [3] Piano is covered because `hidden`
  precedes freeze: the browser sends `watching: false` on that transition. The remaining stale case
  is a focused, visible page whose machine stops (sleep, crash). Here the socket bounds staleness:
  each written frame must be acknowledged within 10 s or the server closes the socket
  (`server/BoundedDelivery.ts:73, 114-120`), every attached socket receives the completion's
  frames (`server/ClientSessions.ts:120-137`), and a closed socket closes the attachment scope.
  A grace of 10 s or more therefore means a watcher still present at send time acknowledged the
  completion frame: a live browser, not a ghost. The browser side already treats a socket as alive
  only while pongs arrive (`web/src/lib/ws.ts:87-92, 127-139`).
- **Several tabs and devices.** Attention is per attachment; the policy is "suppress if any
  attachment has attention", which is the user's stated preference (no ping while working in the
  session). A second device's open tab with focus suppresses the first device's Slack line; that is
  the intended semantics, not a bug, and only a per-device rule would change it.
- **Not idle detection.** Nothing above notices a person who left a focused window. Slack solves this
  with inactivity timers (§Prior art); Piano can add a last-input timestamp later. The Web
  Notification and Push APIs are out of scope: the channel stays Slack through the server, as the
  13 October research chose "accepted visible pushes over unreliable foreground-presence
  suppression" for OS notifications and this note is about suppressing a *remote* channel. [6]

## What Piano's server knows today

- **One event stream per attached browser.** A socket claims one selection and `attachTo` runs
  `session.events` in a per-attachment `Scope` (`server/ClientSessions.ts:110-150`); `detach` closes
  it on reselect, retire or client scope end (lines 102-107, 255-271). The publication keeps a
  `subscribers` set and adds/removes a delivery per subscriber (`server/SessionPublication.ts:80,
  134, 146`). So the server already *has* a per-session attachment count, with one caveat: the
  host's own observer is a subscriber too (`server/SessionHost.ts:164`), so "browsers attached" is
  `subscribers - 1` or, better, counted in `ClientSessions`, the only other subscriber
  (`grep "\.events\b" server/` finds exactly those two).
- **No presence or watching notion exists.** `SessionState` (`shared/wire.ts:353-392`) has
  `isQuiescent` and `closure` but nothing about viewers; the glossary has no term for it. Browser
  focus/visibility appears only as read triggers (`web/src/lib/observation.ts:29-32, 223-226`;
  `checkoutRefresh.ts:1-24, 100-101`; `sidebarList.ts:336-339`; `useExeDev` per
  `docs/notifications.md:41-48`). None of it reaches the server.
- **Completion path.** `PiRecords` emits `response_completed` on a live settled success
  (`server/PiRecords.ts:770`; `test/ResponseCompletion.test.ts:9` covers the negatives);
  `SessionHost` forwards it to `notifications.completed(sessionId)` (`server/SessionHost.ts:176-177`),
  which enqueues `{ name, sessionId }` into `Queue.dropping(32)` (`server/Notifications.ts:113,
  167-175`); the worker rechecks `availableName` and the saved selection "immediately before
  sending" (lines 119-121). `response_completed` and the browser's `attention` frame are not
  ordered with respect to each other, which is one reason for the grace.
- **Vocabulary.** `SessionEvent` variants: snapshot, state, response_completed, queue_update,
  submission, message_update, message_end, context, tool_update, dialog, dialog_resolved, notice,
  closed (`shared/wire.ts:403-423`). `SessionAction`: prompt, steer, abort, stop, restore_queue,
  set_model, set_thinking_level, set_name, answer (lines 488-507). `ClientMessage` already carries
  socket-scoped intents with `selectionId` (`select`, `create_session`, `act`, lines 803-823).

## Candidate designs

| | Suppresses when | Misses | Invariants |
|---|---|---|---|
| (a) Attention reported, socket-bound | tab visible and focused on any attached browser | person away from a focused window | INV-01 (policy in Piano, presence is a projection, never in the registry), INV-02 (server still decides and sends; socket lifetime clears state), INV-03 (trigger unchanged), INV-05 (attention resent on reselect; stale selectionId ignored), INV-07 (keyed by the selection's session), INV-11 (rides the origin-checked socket) |
| (b) Socket-only presence | any browser attached to the session | the common case: tab left open in the background while the user is in Slack, so nothing is ever sent | INV-02 only; no browser change |
| (c) Delay, send unless the user interacted | a prompt, steer or answer arrived within N s | a person reading the reply without typing; adds N s to every send | INV-02, INV-03; needs no new wire message but reads `act` traffic as a proxy for attention |
| (d) Browser decides and asks the server to send | whatever the tab decides | every closed or frozen tab; two tabs can both ask or neither | breaks INV-02's "server ownership survives browser lifecycle" and reintroduces per-tab delivery that `docs/research/2026-10-16-exe-notifications.md:134-135` ("no per-tab observer should own delivery") already rejected |

(a) with a grace subsumes (c)'s useful part: an `act` on the session during the grace can also
count as attention at no extra cost. (b) is the fallback if the browser change is unwanted, but it
answers a different question ("is Piano open anywhere") and would silence the notification exactly
when the user wants it. (d) is rejected.

Failure modes of (a) and their handling: lost socket (scope closes, presence gone within the 10 s
ack deadline once frames flow); browser crash or sleep while focused (same bound, because the
completion itself produces frames); `visibilitychange` not firing for an obscured window (`blur`
still fires; `hasFocus()` is false); multiple tabs (any attention suppresses); server restart
(in-memory presence and the queue are both lost, consistent with `docs/notifications.md:79-81`).

## Interaction with the existing worker

- **Where.** `server/Notifications.ts:121` is the recheck point; attention goes there. The grace
  sleep goes before `waitMs` so the rate-limit wait (up to 60 s, line 117) and the grace do not add
  up; attention is checked once, after both, so a watcher who arrived during a long rate-limit wait
  still suppresses.
- **Queue.** `Queue.dropping(32)` has no time dimension; a grace only lengthens each item's stay.
  The loop is sequential (`Effect.forever`, line 128), so a 10 s grace caps throughput at six
  notifications a minute, above the five-per-minute Slack limit already enforced by `waitMs`
  (lines 72-78). Overflow therefore needs more than 32 completions inside one grace, which the
  per-minute limit would already have throttled.
- **Rate limit.** Skips never call `send`, so `sentAt` is untouched; suppressed completions cost no
  quota and a user working in the browser leaves the budget for the runs they are not watching.
- **Tests.** Existing cases remain valid: the fixture at `test/Notifications.test.ts:23-40` gains a
  `SessionAttention` layer with nobody watching; "replacement skips queued sends" (line 159) already
  advances `TestClock` 60 s, which also covers a 10 s grace; the router case (line 212) is where the
  attended and unattended sends are asserted. Settlement tests in `test/ResponseCompletion.test.ts`
  are untouched because the trigger does not change.

## Prior art

Slack's desktop and mobile apps coordinate exactly this way: by default mobile notifications arrive
"one minute after locking your desktop screen or 10 minutes after Slack stops detecting cursor
activity", configurable under "When I'm not active on desktop" to "as soon as they're sent, as soon
as you're inactive, or after an additional delay", with an "Immediately, even if I'm active"
option. [7] Two points carry over: suppression is a timing preference, not a hard rule, and the
activity signal is desktop-wide, not per conversation. Piano's first version is per session and has
no idle timer; a "Notify me even while I'm watching" setting is the natural follow-up if anyone
misses the always-on behaviour. Discord's help page on its inactive-timeout setting returned HTTP
403 to this research and is not cited.

## Open questions

1. Whether the scratch browser run should include an obscured-but-visible window on macOS; no
   primary source states what Chrome or Safari do there, so observe it rather than assume.
2. Grace length: 10 s matches the ack deadline; anything shorter weakens the liveness argument above.
3. Whether `act` during the grace should count as attention (cheap, closes the (c) gap).

## Sources

1. [WHATWG HTML, §6.2 Page visibility and §6.6 Focus](https://html.spec.whatwg.org/multipage/interaction.html#page-visibility):
   system visibility state, `visibilitychange`, "has user attention".
2. [MDN, Page Visibility API](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API):
   `hidden`/`visible` definitions, `onblur`/`onfocus` note, background throttling and the WebSocket
   exemption, iframe rule. [MDN, `visibilitychange` event](https://developer.mozilla.org/en-US/docs/Web/API/Document/visibilitychange_event).
3. [Chrome Developers, Page Lifecycle API](https://developer.chrome.com/docs/web-platform/page-lifecycle-api):
   active/passive/hidden/frozen/discarded, hidden as the last reliable transition, mobile close
   without unload events, the `visibilityState` + `hasFocus()` sample.
4. [MDN, `Document.hasFocus()`](https://developer.mozilla.org/en-US/docs/Web/API/Document/hasFocus).
5. [MDN, Window `blur` event](https://developer.mozilla.org/en-US/docs/Web/API/Window/blur_event).
6. Piano: [`server/Notifications.ts`](../../server/Notifications.ts), [`server/SessionHost.ts`](../../server/SessionHost.ts),
   [`server/ClientSessions.ts`](../../server/ClientSessions.ts), [`server/SessionPublication.ts`](../../server/SessionPublication.ts),
   [`server/BoundedDelivery.ts`](../../server/BoundedDelivery.ts), [`shared/wire.ts`](../../shared/wire.ts),
   [`web/src/lib/ws.ts`](../../web/src/lib/ws.ts), [`web/src/lib/observation.ts`](../../web/src/lib/observation.ts),
   [`web/src/lib/checkoutRefresh.ts`](../../web/src/lib/checkoutRefresh.ts), [`web/src/lib/client.ts`](../../web/src/lib/client.ts),
   [`test/Notifications.test.ts`](../../test/Notifications.test.ts), [`test/ResponseCompletion.test.ts`](../../test/ResponseCompletion.test.ts),
   [development invariants](../development-invariants.md), [testing policy](../testing.md),
   [notifications guide](../notifications.md) and the earlier notes
   [2026-10-13](2026-10-13-work-completion-notifications.md) and [2026-10-16](2026-10-16-exe-notifications.md).
7. [Slack Help Center, Configure your Slack notifications](https://slack.com/help/articles/201355156-Configure-your-Slack-notifications):
   "When I'm not active on desktop" timing.
