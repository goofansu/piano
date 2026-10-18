import { isWorking } from "@shared/sessionProjection";
import type { ClientCommand as ClientMessage, ExtensionState } from "@shared/wire";
import { cn } from "cn";
import { useEffect, useMemo, useState } from "react";
import { Banner } from "@/components/Banner";
import { Composer } from "@/components/Composer";
import { LocalFileContext } from "@/components/Markdown";
import { MessageList } from "@/components/MessageList";
import { AddToChat } from "@/components/Quotes";
import { SessionHeader } from "@/components/SessionHeader";
import { SessionPullRequestControl } from "@/components/SessionPullRequest";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { drafts, sessionDraftKey } from "@/lib/messageDraft";
import { catalogEntry } from "@/lib/sessionCatalog";
import {
  completionTarget,
  sessionActivity,
  sessionContext,
  sessionPane,
} from "@/lib/sessionContext";
import { type SessionNotice, sessionNotices } from "@/lib/sessionNotices";
import { useMessagesOnly } from "@/lib/useMessagesOnly";
import { useNavigation } from "@/lib/useNavigation";
import { useSessionPullRequest } from "@/lib/useSessionPullRequest";
import { TranscriptViewportContext, useNewTranscriptViewport } from "@/lib/useTranscriptViewport";
import { type AppState, sessionKey } from "@/store";

interface Props {
  state: AppState;
  send: (m: ClientMessage) => void;
}

export function SessionView({ state, send }: Props) {
  // The selected session's PR popover; hidden while Settings covers the view. Its Changes and
  // open file live in the right sidebar (SessionPanel).
  const { settings, pullRequest: pullRequestOpened, openPanel, closePullRequest } = useNavigation();
  const pullRequestOpen = !settings && pullRequestOpened;
  const onPullRequestOpenChange = (open: boolean) => (open ? openPanel("pr") : closePullRequest());
  const [messagesOnly] = useMessagesOnly();
  const t = state.session;
  // The transcript looks executions up by tool call ID.
  const tools = useMemo(
    () => Object.fromEntries((t?.tools ?? []).map((tool) => [tool.id, tool])),
    [t?.tools],
  );
  const input = state.pendingCreate;
  const { workspace, changesWorkspace } = sessionContext(state);
  // The registry's workspace for the directory, like Changes: it outlives a closed folder.
  const pullRequest = useSessionPullRequest(
    workspace?.id,
    t?.sessionId,
    !!t && isWorking(t.state),
    {
      open: pullRequestOpen,
      onOpenChange: onPullRequestOpenChange,
    },
  );
  const { status, replyActivity } = sessionActivity(state, messagesOnly);
  const parentId = t?.state.dispatchedFrom;
  const parent = parentId ? catalogEntry(state, parentId) : undefined;
  const dispatchedFrom = !parentId
    ? undefined
    : parent && !parent.disabled
      ? { sessionId: parentId, cwd: parent.cwd, title: parent.title || "Untitled" }
      : ("unlisted" as const);
  const pane = sessionPane(state);
  const notices = sessionNotices(state, messagesOnly);
  const readOnly = notices.find((n) => n.placement === "composer");
  const draftKey = t ? sessionDraftKey(t) : null;
  const [usedEditorRequest, setUsedEditorRequest] = useState<string>();
  // The transcript reports where the reader is; the composer's jump list reads and moves it.
  const viewport = useNewTranscriptViewport();

  return (
    <TranscriptViewportContext value={viewport}>
      <SessionHeader
        state={state}
        status={status}
        pullRequest={(menuTrigger) =>
          t?.sessionId && (
            <SessionPullRequestControl
              key={sessionKey(t)}
              pr={pullRequest}
              menuTrigger={menuTrigger}
            />
          )
        }
      />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {notices
          .filter((n) => n.placement === "banner")
          .map((n) => (
            <Banner
              key={n.id}
              variant={n.tone === "destructive" ? "destructive" : "warning"}
              title={n.title}
              action={
                n.action && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => n.action && send(n.action.command)}
                  >
                    {n.action.label}
                  </Button>
                )
              }
            >
              {n.details.length
                ? n.details.map((detail) => (
                    <p key={detail} className="whitespace-pre-wrap break-words">
                      {detail}
                    </p>
                  ))
                : undefined}
            </Banner>
          ))}
        <AddToChat
          draftKey={readOnly ? null : draftKey}
          className="relative flex min-h-0 flex-1 flex-col"
        >
          {pane.list && (
            <LocalFileContext value={(path) => openPanel({ kind: "file", path })}>
              <MessageList
                showTools={!messagesOnly}
                messages={t?.messages ?? []}
                pending={t?.pending ?? null}
                submittedInput={input}
                tools={tools}
                activity={replyActivity}
                working={!!t && isWorking(t.state)}
                placeholder={pane.placeholder}
                dispatchedFrom={dispatchedFrom}
              />
            </LocalFileContext>
          )}
          {pane.skeleton !== "none" && <TranscriptSkeleton hidden={pane.skeleton === "hidden"} />}
          {!state.connected && (
            <div
              role="status"
              className="late-enter pointer-events-none absolute inset-x-0 top-3 flex justify-center"
            >
              <span className="flex items-center gap-2 rounded-full border border-line bg-surface-2 px-3 py-1.5 text-sm text-ink-2 shadow-2">
                <Spinner className="size-3.5" /> Reconnecting…
              </span>
            </div>
          )}
        </AddToChat>
        {notices
          .filter((n) => n.placement === "status")
          .map((n) =>
            n.extension ? (
              <ExtensionBlock
                key={n.id}
                extension={n.extension}
                used={usedEditorRequest}
                onAppend={(request) => {
                  if (draftKey) {
                    drafts.paragraph(draftKey, request.text);
                    setUsedEditorRequest(request.id);
                  }
                }}
              />
            ) : (
              <StatusLine key={n.id} notice={n} />
            ),
          )}
        <Composer
          session={t}
          workspace={changesWorkspace}
          draftKey={draftKey}
          completion={completionTarget(state)}
          disabled={!draftKey || input?.outcome === "starting"}
          actionsDisabled={pane.composerDisabled}
          readOnly={readOnly}
          send={send}
        />
      </div>
    </TranscriptViewportContext>
  );
}

/** A status line under the transcript: the last dialog's or input's outcome. Hand-written: no shadcn component is a plain live line. */
function StatusLine({ notice }: { notice: SessionNotice }) {
  return (
    <section
      aria-label={notice.id === "dialog-resolution" ? "Last dialog" : "Last input"}
      role="status"
      className={cn(
        "px-4 pt-2 text-sm md:px-6",
        notice.tone === "warning" ? "text-warning" : "text-ink-2",
      )}
    >
      <div className="mx-auto max-w-3xl break-words">
        <p>{notice.title}</p>
        {notice.details.map((detail) => (
          <p key={detail} className="mt-1">
            {detail}
          </p>
        ))}
      </div>
    </section>
  );
}

/** What Pi's extensions report: title, statuses, widgets and a suggested message to append. */
function ExtensionBlock({
  extension,
  used,
  onAppend,
}: {
  extension: ExtensionState;
  used: string | undefined;
  onAppend: (request: { id: string; text: string }) => void;
}) {
  return (
    <section
      aria-label="Extension state"
      className="mx-auto w-full max-w-3xl max-h-40 overflow-auto px-4 pt-2 text-xs text-ink-2 md:px-6"
    >
      {extension.title && <p>Extension title: {extension.title}</p>}
      {extension.statuses.map((status) => (
        <p key={status.key}>
          {status.key}: {status.text}
        </p>
      ))}
      {extension.widgets.map((widget) => (
        <div key={widget.key}>
          <p>
            {widget.key} · {widget.placement === "aboveEditor" ? "above editor" : "below editor"}
          </p>
          <pre className="whitespace-pre-wrap break-words">{widget.lines.join("\n")}</pre>
        </div>
      ))}
      {extension.editorRequest && (
        <div>
          <p>Suggested message</p>
          <pre className="whitespace-pre-wrap break-words">{extension.editorRequest.text}</pre>
          <Button
            size="sm"
            variant="outline"
            disabled={used === extension.editorRequest.id}
            onClick={() => {
              if (extension.editorRequest) onAppend(extension.editorRequest);
            }}
          >
            Append to draft
          </Button>
        </div>
      )}
    </section>
  );
}

/**
 * A skeleton in the transcript's own geometry: a prompt card, a reply with three lines and a
 * tool row. `sessionPane` decides when it shows; once hidden it fades out as the real transcript
 * fades in, staying mounted just long enough to finish leaving.
 */
function TranscriptSkeleton({ hidden }: { hidden: boolean }) {
  const [lingering, setLingering] = useState(false);
  useEffect(() => {
    if (!hidden) {
      setLingering(false);
      return;
    }
    setLingering(true);
    const timer = setTimeout(() => setLingering(false), 200);
    return () => clearTimeout(timer);
  }, [hidden]);
  if (hidden && !lingering) return null;
  return (
    <div
      aria-hidden
      data-hidden={hidden}
      className="skeleton-layer absolute inset-0 overflow-hidden bg-conversation px-4 md:px-6"
    >
      {/* The lines wait like the sidebar's, so a quick load shows the transcript without them. */}
      <div className="late-enter mx-auto flex w-full max-w-3xl flex-col gap-6 py-6 md:py-8">
        <div className="rounded-2xl border border-line bg-fill px-4 py-3.5">
          <div className="flex gap-3">
            <span className="flex h-[1lh] w-4 items-center justify-center">
              <Skeleton className="h-3 w-1.5 rounded-sm" />
            </span>
            <Skeleton className="h-4 w-[52%]" />
          </div>
        </div>
        <div className="flex gap-3">
          <span className="flex h-[1lh] w-4 items-center justify-center">
            <Skeleton className="size-1.5 rounded-full" />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-2.5 pt-0.5">
            <Skeleton className="h-4 w-[88%]" />
            <Skeleton className="h-4 w-[72%]" />
            <Skeleton className="h-4 w-[44%]" />
          </div>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="flex h-[1lh] w-4 items-center justify-center">
            <Skeleton className="size-2 rounded-full" />
          </span>
          <Skeleton className="h-3.5 w-10" />
          <Skeleton className="h-3.5 w-36" />
        </div>
      </div>
    </div>
  );
}
