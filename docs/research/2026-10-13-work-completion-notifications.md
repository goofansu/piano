# Work-completion notifications for web and installed PWAs

Research date: 2026-10-13. Local source baseline: `ab58c93`.
Status: proposal and source review, not an implementation or a verified browser compatibility claim.

## Recommendation

Use **server-originated Web Push**, delivered to a service worker that displays a persistent
notification. This supports a browser tab or installed PWA without requiring the Piano page to
remain open. Installation alone does not deliver notifications. In-page toasts or a WebSocket-only
notification cannot meet the closed-app requirement.

Define the initial product promise as **“Piano finished responding”**, not “work verified” or
“task succeeded.” Keep errors and requests for input separate from normal completion. The server
must remain running; closing the UI is different from stopping Piano or sleeping its host machine.
Delivery is best effort, not an alarm or guaranteed exactly-once message.

## What Piano already has

- [Manifest](../../web/public/manifest.webmanifest): standalone display, stable ID, start URL,
  scope, ordinary and maskable icons. This is a useful PWA foundation, not evidence that installation
  or push works on every device.
- [HTML entry](../../web/index.html): manifest and Apple touch icon links. The manifest explicitly
  uses credentials because the private access boundary otherwise redirects it to login.
- [Client](../../web/src/lib/client.ts) and [App](../../web/src/App.tsx): in-page notifications
  through Sonner; they depend on the running page and received server frames.
- Source search found no service worker registration, PushManager subscription, or
  `showNotification` implementation. [Vite configuration](../../web/vite.config.ts) has no PWA plugin.
- [SessionHosts](../../server/SessionHosts.ts) owns sessions and observes events independently of
  browser attachments. Integrate completion notification policy with this server-owned lifetime,
  not an individual socket or React component.
- [PiRecords](../../server/PiRecords.ts) translates `agent_settled` into non-streaming,
  non-compacting, non-retrying state. [Wire state](../../shared/wire.ts) and
  [projection](../../shared/sessionProjection.ts) distinguish work, closure and quiescence;
  they do not yet provide a durable, classified completion-notification identity.

## Proposed Piano integration

1. **One explicit opt-in per browser/install.** A Notifications settings section explains what is
   sent and offers “Enable notifications,” “Send test notification,” and disable. Detect capability
   and permission; do not prompt on startup or repeatedly after denial. On unsupported iPhone/iPad
   browser contexts, explain the Home Screen installation prerequisite. Match any new global UI
   action in the command palette.
2. **A minimal root-scoped service worker.** Handle `push` and `notificationclick`; use
   `event.waitUntil` for asynchronous work. Do not add offline transcript/API caching merely to
   obtain notifications. Serve the worker as JavaScript rather than the SPA fallback. Validate
   first registration and updates through private access, including expired login sessions.
3. **Subscription storage in Piano's database.** Store subscription endpoint/key material, device
   identity, preference/scope and timestamps. Treat endpoint URLs as sensitive capability URLs;
   do not print them. Keep the VAPID private key server-side, declared through `secretspec.toml`;
   the public key can be served to the browser. Persist keys across restarts.
4. **A browser-independent completion seam.** Translate Pi semantics behind `PiSessions`; expose
   a narrow Piano-domain completion fact if existing state cannot reliably distinguish completion
   from abort/failure. Give each completion a stable ID for deduplication. Do not use assistant
   text, `message_end`, `agent_end`, socket disconnect, an initially idle snapshot, or host retirement
   as proof of completion. Queued follow-ups, retries, compaction and outstanding subagent work need
   an explicit policy: the first feature should notify for the main session response cycle, not
   claim every independently running job has finished.
5. **A bounded sender outside the event-draining path.** Persist a small notification outbox if
   restart recovery is part of the promise; unique `(completionId, subscriptionId)` records prevent
   duplicate enqueue. Retry transient failures with bounds and expire stale notifications. Delete
   expired subscriptions. A push-service acceptance response is not proof the device displayed it.
   A crash before a completion is recorded remains a gap unless completion recording is durable at
   its source; do not promise restart-safe execution or perfect delivery.
6. **Privacy-preserving payload and navigation.** Default to “Piano finished responding” without
   prompt, output, repository title or filesystem path. Include an opaque event/session identity
   and safe same-origin `/s/<sessionId>` destination. Display from the payload without first fetching
   protected APIs: a background worker may encounter an expired private-access login. On click,
   focus/navigate an existing client or open the session, allowing normal login. Validate targets;
   never accept an arbitrary external URL from notification data.
7. **One delivery path initially.** Use push for OS notifications instead of both WebSocket and
   push producers. Per-device opt-in can initially cover all sessions on this single-user instance,
   clearly explained in settings; per-session watches can follow if needed. Prefer always showing
   accepted visible pushes over unreliable foreground-presence suppression. A notification tag
   can replace an older notification for the same session, but does not guarantee exactly-once
   delivery or exactly-once attention.

### Security boundary

Preserve [INV-11](../development-invariants.md#inv-11--private-development-is-an-explicit-trust-boundary):
Piano currently has no application authentication and must stay behind private access. Push delivery
is an outbound request to the browser vendor's push service; it does not require publicly exposing
Piano's control port or an inbound webhook. The UI still needs a reachable secure origin for
installation, subscription and opening a session. A localhost origin on a laptop is not that same
origin on a phone.

Subscription registration/deletion and test sends need origin/CSRF protection, rate/size limits and
ownership checks appropriate to the current single-user trust boundary. Subscriptions become an
SSRF surface when the server POSTs to client-supplied endpoint URLs: require HTTPS and a deliberately
maintained supported-provider policy or hardened outbound validation, reject private/link-local
addresses, and do not follow unchecked redirects. Do not assume VAPID validates an endpoint's safety.
A future multi-user product needs authenticated user/device ownership and session authorization,
not instance-wide broadcasts.

### Invariants affected

- **INV-01:** Pi owns history/semantics; Piano owns delivery preferences and subscription metadata.
- **INV-02:** notification production must survive browser disconnect and multiple tabs.
- **INV-03:** settled is not verified success; cancellation/failure must not masquerade as completion.
- **INV-05:** snapshots, duplicate events and reconnection must not cause duplicate completion alerts.
- **INV-09:** notification wording is not evidence that changes were tested or accepted.
- **INV-11:** preserve private access and keep sensitive data out of lock-screen payloads and logs.

## Smallest useful implementation checks

Claim: an opted-in device receives one useful completion notification after leaving Piano, and
opening it returns to the correct session without exposing private content.

- Module checks for one completion per real response cycle, excluding initial idle snapshots,
  intermediate `agent_end`, retry/compaction, explicit abort and process failure; dedup on observer
  reattachment; transient send failures and expired subscription cleanup.
- Scratch-instance browser journey: enable, send test, run a minimal response, hide/close the tab,
  receive notification, click back to the correct session. Keep output and identity of tested build.
- Real iPhone/iPad Home Screen installation and Android PWA journeys with screen locked and app
  closed. Desktop Safari/Chromium/Firefox where supported. Use real devices/manual observations
  for OS delivery that browser automation cannot establish.
- Denial/revocation, app restart, duplicate tabs, stale notifications, offline reconnect and expired
  private-access login. Explicitly distinguish closed tab from force-quit/disabled browser or OS
  background restrictions. Do not promise delivery in the latter cases without device evidence.
- Keep tests focused on notification contracts, not push-library internals. No model call is needed
  for most coverage; use a minimal exact-response prompt only for the final real Pi journey.

## Research verification

Only source and document review performed. No application behavior changed, no dependency selected
or installed, no permission prompt shown and no real push delivered. Platform support and private
access/service-worker behavior remain unverified on actual devices. Documentation-only work does
not require an app run under [the testing policy](../testing.md).

## Platform evidence

### Display is different from delivery

The **Notifications API** displays an OS notification; the **Push API** receives a server message
without a page being open. For the broadly supported path, a push event wakes a service worker,
which calls `ServiceWorkerRegistration.showNotification()`. A page can also call that method
without push, but cannot receive future WebSocket messages after it closes. Persistent notifications
can outlive the page that created them. Prefer the worker API over `new Notification()` for mobile
compatibility. Sources: [MDN Push API](https://developer.mozilla.org/en-US/docs/Web/API/Push_API),
[MDN showNotification](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration/showNotification).

### Platform constraints

| Platform | Practical support boundary |
| --- | --- |
| iPhone/iPad | Web Push supported for Home Screen web apps from iOS/iPadOS 16.4; do not promise it from an ordinary browser tab. Permission must follow direct user interaction. |
| Android | Supporting browsers can receive push without an open site tab; installing a PWA is not generally required. Browser/OS notification settings and background restrictions still apply. |
| Desktop Chromium/Firefox | Web Push does not require PWA installation or an open site tab. Fully quitting the browser is different from closing the tab; behavior depends on browser/OS/background settings. |
| Safari on macOS | Standards-based Web Push arrived in Safari 16 on macOS Ventura. Apple uses its system push service; do not apply Chromium background-process requirements to every Safari environment. |

Sources: [WebKit iOS/iPadOS announcement](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/),
[WebKit Web Push for Safari](https://webkit.org/blog/12945/meet-web-push/),
[web.dev push FAQ](https://web.dev/articles/push-notifications-faq),
[MDN Push API compatibility](https://developer.mozilla.org/en-US/docs/Web/API/Push_API#browser_compatibility).
Feature-detect `serviceWorker`, `PushManager` and `Notification`; support tables do not establish
that permission, private browsing policy or OS settings allow delivery on a particular device.

Use HTTPS in deployed environments. Localhost is a potentially trustworthy development exception,
not a way to make a plain-HTTP LAN address secure. Permission should be requested through an
explicit button; denial should lead to settings guidance, not repeated prompts. Sources:
[MDN secure contexts](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts),
[MDN requestPermission](https://developer.mozilla.org/en-US/docs/Web/API/Notification/requestPermission_static),
[MDN push best practices](https://developer.mozilla.org/en-US/docs/Web/API/Push_API/Best_Practices).

### Subscription and delivery sequence

```text
User taps Enable notifications
  → permission + service-worker registration
  → pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: VAPID_PUBLIC_KEY })
  → POST subscription to Piano
Pi response cycle settles
  → server records completion and notification intent
  → sender encrypts payload and POSTs to subscription's vendor push endpoint
  → browser/OS wakes service worker
  → showNotification("Piano finished responding", …)
User taps notification
  → focus/navigate/open same-origin /s/<sessionId>
```

The returned subscription includes an endpoint and payload-encryption key material. VAPID is a
separate application-server key pair that authenticates the sender; it is not the payload-encryption
key. Use an established Web Push sender library rather than implementing the cryptography.
`web-push` is a candidate to evaluate during implementation, not an audited or selected dependency.
Apple supports standard Web Push without Apple Developer Program membership or an app-specific
APNs integration. Sources:
[MDN subscribe](https://developer.mozilla.org/en-US/docs/Web/API/PushManager/subscribe),
[RFC 8292 (VAPID)](https://datatracker.ietf.org/doc/html/rfc8292),
[RFC 8291 (payload encryption)](https://datatracker.ietf.org/doc/html/rfc8291),
[WebKit iOS/iPadOS announcement](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/).

A browser-vendor push service is part of the architecture, but Firebase application setup or a
paid notification SaaS is not inherently required. The server sends outbound HTTPS to the endpoint
returned by the browser. Encrypted payloads protect message content in transit through the push
service, not timing/size metadata or text displayed on a lock screen. Sources: the Push API,
RFC 8291 and RFC 8292 above.

### Expiry, lifecycle and visible-notification rules

- Set a finite **TTL** so an offline phone does not receive a days-old completion alert; an initial
  product choice of 30 minutes is reasonable, not a platform requirement. **Topic** can replace a
  queued push for the same subscription; notification **tag** replaces a displayed notification.
  Neither is an exactly-once guarantee. Sources:
  [RFC 8030](https://datatracker.ietf.org/doc/html/rfc8030),
  [MDN showNotification](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration/showNotification).
- Handle invalid/expired endpoints according to the push provider's response (commonly 404/410),
  bounded retry for transient failures, and subscription reconciliation on app launch. Handle
  `pushsubscriptionchange` where available, but do not depend solely on it or on background access
  to authenticated APIs. Sources: RFC 8030 and
  [MDN pushsubscriptionchange](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerGlobalScope/pushsubscriptionchange_event).
- Use visible pushes, not silent background synchronization. WebKit explicitly requires visible
  notification handling and can revoke subscriptions for violations. Wrap asynchronous display
  work in `event.waitUntil()`. Sources:
  [WebKit Web Push](https://webkit.org/blog/12945/meet-web-push/),
  [MDN push event](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerGlobalScope/push_event).
- Click handling can enumerate existing windows, focus one or call `clients.openWindow()`; preserve
  a real deep link rather than relying on a specific tab/PWA window type. Source:
  [MDN notificationclick](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerGlobalScope/notificationclick_event).

### Apple declarative push: optional enhancement

WebKit's **Declarative Web Push** can display a notification from a declarative JSON payload even
when service-worker execution is unavailable. This is worth investigating for extra resilience on
supporting Apple releases, not a substitute for a cross-browser worker baseline. A compatible
payload can carry both the declarative notification and data a conventional worker understands;
validate that the fallback and worker do not double-notify. Do not require it in the first version.
Source: [WebKit: Meet Declarative Web Push](https://webkit.org/blog/16535/meet-declarative-web-push/).

### Decisions before implementation

1. Confirm the scope: **main-session response finished**, or separately every delegated job finished?
2. Confirm which opted-in devices receive which sessions; start with explicit instance-wide opt-in
   for this trusted single-user tool, or add per-session watches if that is too noisy.
3. Choose whether restart recovery warrants a durable outbox in the first release.
4. Confirm deployment origins and target real devices, especially the iPhone Home Screen/private
   login journey. A manifest alone does not verify that journey.
