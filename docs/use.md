# Using Piano

For local installation and startup, see [Use](../README.md#use).
For ports, storage, backups and the access model, see [configuration](configuration.md).

## Sign in to a model provider

Open **Settings** at the bottom of the sidebar, then click **Sign in** next to a provider under
**Providers**. Start a new session afterwards, because a running session keeps the models it started
with. For remote sign-in and limits, see [provider sign-in](provider-sign-in.md).

## Search sessions, projects and commands

Click the sidebar’s **Search sessions, projects and commands** button or press **Cmd+K / Ctrl+K**
to open search. Type `!p` to browse active projects, or `!p <name>` to search project names.
Press **Enter** to open the selected project.

Type `!` on its own to list available filters: currently only **Projects only · !p**. Selecting it
with Enter or a click inserts `!p` followed by a space, keeping the dialog open and the search
field focused so you can type a project name.

## Archive and restore sessions

A session's **Archive** action stops its Pi and hides it, keeping the transcript.
In **Settings → Data controls**, use **Unarchive** to restore its listing without starting Pi;
a closed folder stays closed. **Archive all** keeps pinned sessions and every running or starting
Pi, including idle sessions and app owners. It never stops work. See [Data controls](data-controls.md).

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
but ends with its owning Pi process (including that session's Archive/Delete or Piano shutdown).
Data controls' **Archive all** keeps app-owning sessions running.
Ask the agent to stop the exact instance when finished. See [setup and limits](live-previews.md).
The app opens in its own browser tab; see [external app access](live-previews.md#external-app-access).

## Dispatch work to another session

Ask **“Dispatch this work in a new session.”** The agent starts a fresh, visible session with a
self-contained brief, returns an **Open session** link, and can wait for its answer. Use separate
prepared worktrees for concurrent writing tasks. See [session dispatch](session-dispatch.md)
for setup, checkout semantics and bounded observation, or use the bundled
[terminal dispatch script](session-dispatch.md#from-a-terminal-linux-and-macos).

## Send session events to a webhook

Open **Settings → Webhooks**, click **New webhook**, enter your receiver URL and optional Bearer
token, and choose the events to send. Use **Test** in the webhook's menu to check delivery. See
[payloads, delivery limits and privacy](webhooks.md).
