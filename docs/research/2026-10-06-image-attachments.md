# Image attachments

Implemented against `6029dc9` plus this change, Node 24.21.0 and the locked dependencies.

## Claim and boundaries

Both composers accept image-only or text-and-image messages through a native file input with
existing shadcn Input/Button controls, removable previews, paste and drop. No new upload library,
fake upload progress, public object store or repository files. The shared attachment `kind` is
explicit so future document support can add a distinct policy and transport without treating files
as images. PNG, JPEG, GIF and WebP: four images, 5 MiB each, 10 MiB total. Browser and server enforce
limits and signatures; Pi/provider still owns actual image processing and model compatibility.

- **INV-01/12:** Pi receives image content through PiSessions and remains the durable history owner.
  The registry never receives image bytes. Unsent drafts are browser-memory-only and session-scoped;
  refreshing discards them, as it does existing text drafts.
- **INV-03:** Images wait until Pi is idle. Its queue restoration returns only text, so image
  submissions omit native `streamingBehavior` (including if another tab starts a run concurrently).
  Rejected/uncertain commands are not automatically resent. General image queue support is deferred.
- **INV-05:** Transcript snapshots contain preview URLs, not base64 payloads. A disposable 64 MiB
  server cache is rebuilt from Pi message projections. Evicted previews show an unavailable state;
  reopening history repopulates the cache, subject to its bound. Very large image-heavy histories
  may not have every preview cached simultaneously. Original images remain in Pi history.
- **INV-11:** Preview routes stay under the existing private loopback control origin, use only
  content hashes, raster MIME types, `nosniff` and private/no-store responses. They are not a new
  public/authenticated file service. Images are binary, not subject to textual secret redaction.

At widths up to 360px, effort and the context number stay in their on-demand details so the new
attachment action does not crush the model label or primary action.

## Observed evidence

- `npm test`: 56/56 pass. New module checks cover image-only forwarding, authoritative refresh,
  late snapshots without embedded bytes, invalid MIME/signatures and busy-image rejection. Wire
  checks cover unsupported kinds/types, count/size and malformed/empty base64.
- `npm run typecheck`: pass (server/shared and web).
- `PIANO_TEST_BACKEND_PORT=7271 PIANO_TEST_FRONTEND_PORT=7272 node test/browser-attachments.mjs
  /tmp/piano-attachments-evidence`: pass. Uses `npx agent-browser`, scratch Git/registry and fake Pi.
  Observed invalid/oversized selection, picker/remove/reselect, image-only new session, exact preview
  bytes and headers, reload, pasted/dropped follow-up, session-scoped drafts (including a read
  paused across navigation) and 320px/1280px layouts.
- Existing `test/browser-composer.mjs --layout-only` on the same alternate ports: pass at 320px and
  390px for both composers. Its initial failure exposed the cramped model label and prompted the
  narrow-screen fix rather than weakening the check.
- Logs: `/tmp/piano-attachments-{tests,typecheck,browser,layout}.log`; browser command output,
  screenshots and server output in `/tmp/piano-attachments-evidence` and `/tmp/piano-attachments-layout`.
  Earlier browser attempts exposed a Node fetch keepalive failure and incorrect sidebar selectors;
  the check now verifies preview bytes through browser fetch and navigates actual buttons. A port
  collision with another scratch checkout led to using 7271/7272; its processes were left alone.

No credentialed vision/model call was made; fake-protocol evidence does not claim provider quality
or universal model image support. Scratch processes and directories created by these checks were
cleaned up. No user registry changes, production build, deployment or service restart performed.
To activate: build the UI, restart `piano.service`, then reload the browser. Proxy restart not needed.
