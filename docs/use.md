# Using Piano

For local installation and startup, see [Use](../README.md#use).
For ports, storage, backups and the access model, see [configuration](configuration.md).

## Sign in to a model provider

Open **Settings** at the bottom of the sidebar, then click **Sign in** next to a provider under
**Providers**. Start a new session afterwards, because a running session keeps the models it started
with. For remote sign-in and limits, see [provider sign-in](provider-sign-in.md).

## Preview local files

Click a local file link in a session to read it beside the conversation. Markdown offers
**Preview / Source**; code, images, audio, video and PDFs use type-aware viewers. **Download**
saves the file as it is on disk. Click the link again to reread. See
[supported formats, limits and privacy](file-previews.md).

## Publish an artifact

With Radius signed in, ask **“Create an artifact containing this report.”** The agent publishes it
privately to Radius and returns a confirmed viewing link. Ask to update or view the same artifact
on later turns. See [setup, supported formats and failure handling](radius-artifacts.md).

## Run an app preview

On macOS, or on a configured private exe.dev host, ask **“Run this app so I can try it.”** The
agent launches an app in the session's workspace and returns a preview link (on a Mac,
`http://localhost:<port>/`). It keeps running after the reply, Stop and browser disconnect,
but ends with its owning Pi process (including archive/delete or Piano shutdown).
Ask the agent to stop the exact instance when finished. See [setup and limits](live-previews.md).
If a link, sign-in or pop-up does nothing in Preview, choose **More preview actions → Not working
here?** and open the app in a new tab; see
[something does nothing when clicked](live-previews.md#something-does-nothing-when-clicked).

## Dispatch work to another session

Ask **“Dispatch this work in a new session.”** The agent starts a fresh, visible session with a
self-contained brief, returns an **Open session** link, and can wait for its answer. Use separate
prepared worktrees for concurrent writing tasks. See [session dispatch](session-dispatch.md)
for setup, checkout semantics and bounded observation, or use the bundled
[terminal dispatch script](session-dispatch.md#from-a-terminal-linux-and-macos).

## Reuse a prompt

Open **Settings → Prompts**, click **New prompt**, and give it a name, an optional description and
argument hint, and the prompt. Type `/<name>` in the composer of a new session to use it. See
[prompts](prompts.md).

## Send session events to a webhook

Open **Settings → Webhooks**, click **Add webhook**, enter your receiver URL and optional Bearer
token, and choose the events to send. Use **Send test** to check delivery. See
[payloads, delivery limits and privacy](webhooks.md).
