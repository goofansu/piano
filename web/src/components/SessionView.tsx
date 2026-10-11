import type { ClientCommand as ClientMessage, ExtensionState } from "@shared/wire";
import { cn } from "cn";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Banner } from "@/components/Banner";
import { ChangesSheet } from "@/components/Changes";
import { Composer } from "@/components/Composer";
import { MessageList } from "@/components/MessageList";
import { SessionHeader } from "@/components/SessionHeader";
import { SessionPullRequestControl } from "@/components/SessionPullRequest";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { deliveryAction } from "@/lib/composerControl";
import { type DraftKey, sessionDraftKey } from "@/lib/messageDraft";
import { completionTarget, sessionActivity, sessionContext } from "@/lib/sessionContext";
import { type SessionNotice, sessionNotices } from "@/lib/sessionNotices";
import { useModelChoice } from "@/lib/useModelChoice";
import { useNavigation } from "@/lib/useNavigation";
import { useSessionDisplay } from "@/lib/useSessionDisplay";
import type { useSessionPullRequest } from "@/lib/useSessionPullRequest";
import { type AppState, sessionKey } from "@/store";

interface Props {
  state: AppState;
  send: (m: ClientMessage) => void;
  onMenu: () => void;
  onDraftChange: (key: DraftKey, text: string) => void;
  onDraftAppend: (key: DraftKey, text: string) => void;
  /** Adds text to a draft as a new paragraph. */
  onDraftParagraph: (key: DraftKey, text: string) => void;
  openProject: (id: string) => void;
  pullRequest: ReturnType<typeof useSessionPullRequest>;
}

export function SessionView({ state, send, onMenu, onDraftChange, onDraftAppend, onDraftParagraph, openProject, pullRequest }: Props) {
  // The selected session's Changes sheet and PR popover; hidden while Settings covers the view.
  const { settings, panel, openPanel, closePanel } = useNavigation();
  const changesOpen = !settings && panel === "changes";
  const onChangesOpenChange = (open: boolean) => open ? openPanel("changes") : closePanel();
  const pullRequestOpen = !settings && panel === "pr";
  const onPullRequestOpenChange = (open: boolean) => open ? openPanel("pr") : closePanel();
  const [display] = useSessionDisplay();
  const t = state.session;
  // The transcript looks executions up by tool call ID.
  const tools = useMemo(() => Object.fromEntries((t?.tools ?? []).map(tool => [tool.id, tool])), [t?.tools]);
  const input = state.pendingCreate;
  const { ready, changesWorkspace } = sessionContext(state);
  const { status, streaming, replyActivity, firstMessageOnItsWay } = sessionActivity(state, display);
  const notices = sessionNotices(state, display);
  const readOnly = notices.find(n => n.placement === "composer");
  const draftKey = t ? sessionDraftKey(t) : null;
  const catalog = t ? state.catalogs[t.cwd] ?? null : null;
  // A running Pi owns the selection; a saved session's picks wait for its first prompt and
  // override only what was picked, so Pi restores the rest of its recorded selection.
  const choice = useModelChoice(catalog, { kind: "session", hosted: !!t?.hosted, model: t?.state.model, thinkingLevel: t?.state.thinkingLevel },
    `${t?.cwd}\0${t?.sessionId}\0${t?.hosted}`, action => send({ _tag: "act", action }));
  const [usedEditorRequest, setUsedEditorRequest] = useState<string>();

  return (
    <>
      <SessionHeader state={state} onMenu={onMenu} openProject={openProject} status={status}
        pullRequest={t?.sessionId && <SessionPullRequestControl key={sessionKey(t)} open={pullRequestOpen} onOpenChange={onPullRequestOpenChange} pr={pullRequest} />} />
      {t && <ChangesSheet open={changesOpen} onOpenChange={onChangesOpenChange} workspace={changesWorkspace} session={t}
        onAsk={text => {
          if (!draftKey) return;
          onDraftParagraph(draftKey, text);
          onChangesOpenChange(false);
          toast.success("Added to your message");
        }} />}

      {notices.filter(n => n.placement === "banner").map(n => (
        <Banner key={n.id} variant={n.tone === "destructive" ? "destructive" : "warning"} title={n.title}
          action={n.action && <Button variant="ghost" size="sm" onClick={() => n.action && send(n.action.command)}>{n.action.label}</Button>}>
          {n.details.length ? n.details.map(detail => <p key={detail} className="whitespace-pre-wrap break-words">{detail}</p>) : undefined}
        </Banner>
      ))}
      {/* Submitted input renders immediately outside Pi's history. Only an ordinary
          history load uses the skeleton; terminal input outcomes retain the original. */}
      <div className="relative flex min-h-0 flex-1 flex-col">
        {(t || input) && (
          <MessageList
            className="transcript-enter"
            showTools={display === "everything"}
            messages={t?.messages ?? []}
            pending={t?.pending ?? null}
            submittedInput={input}
            tools={tools}
            activity={replyActivity}
            placeholder={firstMessageOnItsWay ? undefined : "No messages yet."}
          />
        )}
        {!input && <TranscriptSkeleton hidden={!!t && (t.messages.length > 0 || !!t.pending || !firstMessageOnItsWay)} />}
        {!state.connected && (
          <div role="status" className="late-enter pointer-events-none absolute inset-x-0 top-3 flex justify-center">
            <span className="flex items-center gap-2 rounded-full border border-line bg-surface-2 px-3 py-1.5 text-sm text-ink-2 shadow-2"><Spinner className="size-3.5" /> Reconnecting…</span>
          </div>
        )}
      </div>
      {notices.filter(n => n.placement === "status").map(n => n.extension
        ? <ExtensionBlock key={n.id} extension={n.extension} used={usedEditorRequest} onAppend={request => {
            if (draftKey) { onDraftParagraph(draftKey, request.text); setUsedEditorRequest(request.id); }
          }} />
        : <StatusLine key={n.id} notice={n} />)}
      {readOnly ? (
        <Alert className="mx-4 my-3 w-auto md:mx-6">
          <AlertTitle>{readOnly.title}</AlertTitle>
          <AlertDescription>{readOnly.details.join(" ")}</AlertDescription>
        </Alert>
      ) : <Composer
        draftKey={draftKey}
        completion={completionTarget(state)}
        text={draftKey ? state.drafts[draftKey] ?? "" : ""}
        onTextChange={(text) => { if (draftKey) onDraftChange(draftKey, text); }}
        onTextAppend={(text) => { if (draftKey) onDraftAppend(draftKey, text); }}
        onRestoreQueue={() => send({ _tag: "act", action: { _tag: "restore_queue" } })}
        disabled={!ready || !t || input?.outcome === "starting"}
        streaming={streaming}
        compacting={t?.state.isCompacting}
        onSend={(text, kind, attachments) => send({ _tag: "act", action: { _tag: deliveryAction(kind), text, attachments }, start: choice.start() })}
        onStop={() => send({ _tag: "act", action: { _tag: "stop" } })}
        stopping={t?.state.isStopping}
        catalog={catalog}
        onRefreshModels={t ? () => send({ _tag: "models", cwd: t.cwd, refresh: true }) : undefined}
        model={choice.model}
        onModelChange={choice.onModelChange}
        effort={choice.effort}
        onEffortChange={choice.onEffortChange}
        context={t?.state.context}
        cost={t?.state.cost}
        totals={t?.state.tokens}
        subagents={t?.state.subagents}
        messages={t?.messages}
        queuedMessages={t?.state.queuedMessages}
      />}
    </>
  );
}

/** A status line under the transcript: the last dialog's or input's outcome. Hand-written: no shadcn component is a plain live line. */
function StatusLine({ notice }: { notice: SessionNotice }) {
  return (
    <section aria-label={notice.id === "dialog-resolution" ? "Last dialog" : "Last input"} role="status"
      className={cn("animate-in px-4 pt-2 text-sm fade-in-0 slide-in-from-bottom-1 md:px-6", notice.tone === "warning" ? "text-warning" : "text-ink-2")}>
      <div className="mx-auto max-w-3xl break-words">
        <p>{notice.title}</p>
        {notice.details.map(detail => <p key={detail} className="mt-1">{detail}</p>)}
      </div>
    </section>
  );
}

/** What Pi's extensions report: title, statuses, widgets and a suggested message to append. */
function ExtensionBlock({ extension, used, onAppend }: { extension: ExtensionState; used: string | undefined; onAppend: (request: { id: string; text: string }) => void }) {
  return (
    <section aria-label="Extension state" className="mx-auto w-full max-w-3xl max-h-40 overflow-auto px-4 pt-2 text-xs text-ink-2 md:px-6">
      {extension.title && <p>Extension title: {extension.title}</p>}
      {extension.statuses.map(status => <p key={status.key}>{status.key}: {status.text}</p>)}
      {extension.widgets.map(widget => <div key={widget.key}><p>{widget.key} · {widget.placement === "aboveEditor" ? "above editor" : "below editor"}</p><pre className="whitespace-pre-wrap break-words">{widget.lines.join("\n")}</pre></div>)}
      {extension.editorRequest && <div>
        <p>Suggested message</p>
        <pre className="whitespace-pre-wrap break-words">{extension.editorRequest.text}</pre>
        <Button size="sm" variant="outline" disabled={used === extension.editorRequest.id} onClick={() => {
          if (extension.editorRequest) onAppend(extension.editorRequest);
        }}>Append to draft</Button>
      </div>}
    </section>
  );
}

/**
 * A skeleton in the transcript's own geometry: a prompt card, a reply with three lines and a
 * tool row. It is visible while a session is being fetched or its first message is on its way, and
 * fades out as the real transcript fades in; it stays mounted just long enough to finish leaving.
 */
function TranscriptSkeleton({ hidden }: { hidden: boolean }) {
  const [lingering, setLingering] = useState(false);
  useEffect(() => {
    if (!hidden) { setLingering(false); return; }
    setLingering(true);
    const timer = setTimeout(() => setLingering(false), 200);
    return () => clearTimeout(timer);
  }, [hidden]);
  if (hidden && !lingering) return null;
  return (
    <div aria-hidden data-hidden={hidden} className="skeleton-layer absolute inset-0 overflow-hidden bg-conversation px-4 md:px-6">
      {/* The lines wait like the sidebar's, so a quick load shows the transcript without them. */}
      <div className="late-enter mx-auto flex w-full max-w-3xl flex-col gap-6 py-6 md:py-8">
        <div className="rounded-2xl border border-line bg-fill px-4 py-3.5">
          <div className="flex gap-3">
            <span className="flex h-[1lh] w-4 items-center justify-center"><Skeleton className="h-3 w-1.5 rounded-sm" /></span>
            <Skeleton className="h-4 w-[52%]" />
          </div>
        </div>
        <div className="flex gap-3">
          <span className="flex h-[1lh] w-4 items-center justify-center"><Skeleton className="size-1.5 rounded-full" /></span>
          <div className="flex min-w-0 flex-1 flex-col gap-2.5 pt-0.5">
            <Skeleton className="h-4 w-[88%]" />
            <Skeleton className="h-4 w-[72%]" />
            <Skeleton className="h-4 w-[44%]" />
          </div>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="flex h-[1lh] w-4 items-center justify-center"><Skeleton className="size-2 rounded-full" /></span>
          <Skeleton className="h-3.5 w-10" />
          <Skeleton className="h-3.5 w-36" />
        </div>
      </div>
    </div>
  );
}
