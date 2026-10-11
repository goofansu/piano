import type { ClientCommand as ClientMessage } from "@shared/wire";
import { cn } from "cn";
import { useEffect, useState } from "react";
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
import { sessionActivity, sessionContext } from "@/lib/sessionContext";
import { useModelChoice } from "@/lib/useModelChoice";
import { useSessionDisplay } from "@/lib/useSessionDisplay";
import type { useSessionPullRequest } from "@/lib/useSessionPullRequest";
import { type AppState, sessionKey } from "@/store";

interface Props {
  state: AppState;
  send: (m: ClientMessage) => void;
  onMenu: () => void;
  onDraftChange: (key: string, text: string) => void;
  onDraftAppend: (key: string, text: string) => void;
  openProject: (id: string) => void;
  changesOpen: boolean;
  onChangesOpenChange: (open: boolean) => void;
  pullRequest: ReturnType<typeof useSessionPullRequest>;
  pullRequestOpen: boolean;
  onPullRequestOpenChange: (open: boolean) => void;
}

export function SessionView({ state, send, onMenu, onDraftChange, onDraftAppend, openProject, changesOpen, onChangesOpenChange, pullRequest, pullRequestOpen, onPullRequestOpenChange }: Props) {
  const [display] = useSessionDisplay();
  const t = state.session;
  const input = state.pendingCreate;
  const { ready, checkoutMissing, folder: located, changesWorkspace } = sessionContext(state);
  const folder = t ? located : undefined;
  const { status, streaming, replyActivity, firstMessageOnItsWay, submissionText } = sessionActivity(state, display);
  const draftKey = t ? sessionKey(t) : undefined;
  const catalog = t ? state.catalogs[t.cwd] ?? null : null;
  useEffect(() => { if (state.connected && t?.cwd && !checkoutMissing) send({ _tag: "models", cwd: t.cwd }); }, [t?.cwd, checkoutMissing, state.connected, state.catalogRevision, send]);
  // A running Pi owns the selection; a saved session's picks wait for its first prompt and
  // override only what was picked, so Pi restores the rest of its recorded selection.
  const choice = useModelChoice(catalog, { kind: "session", hosted: !!t?.hosted, model: t?.state.model, thinkingLevel: t?.state.thinkingLevel },
    `${t?.cwd}\0${t?.sessionId}\0${t?.hosted}`, action => send({ _tag: "act", action }));
  const extension = t?.state.extension;
  // Pi reports an extension block for every session; only one that says something is shown.
  const extensionContent = !!extension && !!(extension.title || extension.statuses.length || extension.widgets.length || extension.editorRequest);
  const [usedEditorRequest, setUsedEditorRequest] = useState<string>();
  const submission = t?.state.submission;

  return (
    <>
      <SessionHeader state={state} onMenu={onMenu} openProject={openProject} status={status}
        pullRequest={t?.sessionId && <SessionPullRequestControl key={sessionKey(t)} open={pullRequestOpen} onOpenChange={onPullRequestOpenChange} pr={pullRequest} />} />
      {t && <ChangesSheet open={changesOpen} onOpenChange={onChangesOpenChange} workspace={changesWorkspace} session={t}
        onAsk={text => {
          if (!draftKey) return;
          onDraftAppend(draftKey, `${state.drafts[draftKey]?.trim() ? "\n\n" : ""}${text}`);
          onChangesOpenChange(false);
          toast.success("Added to your message");
        }} />}

      {folder?.discovery.status === "error" && (
        <Banner variant="destructive" title="Git status unavailable." action={<Button variant="ghost" size="sm" onClick={() => send({ _tag: "registry" })}>Refresh</Button>}>
          <p className="whitespace-pre-wrap break-words">{folder.discovery.detail}</p>
        </Banner>
      )}
      {t?.closedReason && t.closedReason !== "released" && (
        <Banner variant="destructive" title={`Pi stopped: ${t.closedReason}.`}>
          <p>Interrupted operations are not resumed. Inspect the checkout before continuing.</p>
        </Banner>
      )}
      {t?.state.projectionError && (
        <Banner variant="warning" title="Unable to refresh the conversation. Recent changes may be missing.">
          <p className="break-words">{t.state.projectionError}</p>
        </Banner>
      )}
      {(t?.state.stateRefreshError || t?.state.statsRefreshError) && (
        <Banner variant="warning" title="Unable to refresh session details. Some information may be stale.">
          <p className="break-words">{t.state.stateRefreshError}</p>
          <p className="break-words">{t.state.statsRefreshError}</p>
        </Banner>
      )}
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
            tools={t?.tools ?? {}}
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
      {t?.state.dialogResolution && (
        <section aria-label="Last dialog" role="status" className="animate-in px-4 pt-2 text-sm text-ink-2 fade-in-0 slide-in-from-bottom-1 md:px-6">
          <p className="mx-auto max-w-3xl break-words">Dialog {t.state.dialogResolution.reason}: {t.state.dialogResolution.detail}</p>
        </section>
      )}
      {submissionText && (
        <section aria-label="Last input" role="status" className={cn("animate-in px-4 pt-2 text-sm fade-in-0 slide-in-from-bottom-1 md:px-6", submission?.outcome === "uncertain" || submission?.outcome === "rejected" ? "text-warning" : "text-ink-2")}>
          <div className="mx-auto max-w-3xl break-words">
            <p>{submissionText}</p>
            {(input?.detail ?? submission?.detail) && <p className="mt-1">{input?.detail ?? submission?.detail}</p>}
          </div>
        </section>
      )}
      {extension && extensionContent && <section aria-label="Extension state" className="mx-auto w-full max-w-3xl max-h-40 overflow-auto px-4 pt-2 text-xs text-ink-2 md:px-6">
        {extension.title && <p>Extension title: {extension.title}</p>}
        {extension.statuses.map(status => <p key={status.key}>{status.key}: {status.text}</p>)}
        {extension.widgets.map(widget => <div key={widget.key}><p>{widget.key} · {widget.placement === "aboveEditor" ? "above editor" : "below editor"}</p><pre className="whitespace-pre-wrap break-words">{widget.lines.join("\n")}</pre></div>)}
        {extension.editorRequest && <div>
          <p>Suggested message</p>
          <pre className="whitespace-pre-wrap break-words">{extension.editorRequest.text}</pre>
          <Button size="sm" variant="outline" disabled={usedEditorRequest === extension.editorRequest.id} onClick={() => {
            if (draftKey && extension.editorRequest) { onDraftAppend(draftKey, `${state.drafts[draftKey] ? "\n\n" : ""}${extension.editorRequest.text}`); setUsedEditorRequest(extension.editorRequest.id); }
          }}>Append to draft</Button>
        </div>}
      </section>}
      {checkoutMissing ? (
        <Alert className="mx-4 my-3 w-auto md:mx-6">
          <AlertTitle>Checkout removed · Read-only session</AlertTitle>
          <AlertDescription>History is still available. You can archive or delete this session, or restore the checkout at its original path and reload to continue.</AlertDescription>
        </Alert>
      ) : <Composer
        draftKey={draftKey ?? "loading"}
        completion={ready && t ? { cwd: t.cwd, sessionId: t.hosted ? t.sessionId ?? undefined : undefined, revision: `${state.selectionId}:${t.cursor?.generation}:${t.hosted}:${catalog?.fetchedAt}` } : undefined}
        text={draftKey ? state.drafts[draftKey] ?? "" : ""}
        onTextChange={(text) => { if (draftKey) onDraftChange(draftKey, text); }}
        onTextAppend={(text) => { if (draftKey) onDraftAppend(draftKey, text); }}
        onRestoreQueue={() => send({ _tag: "act", action: { _tag: "restore_queue" } })}
        disabled={!ready || !t || input?.outcome === "starting"}
        streaming={streaming}
        compacting={t?.state.isCompacting}
        onSend={(text, kind, attachments) => send({ _tag: "act", action: { _tag: kind === "steering" ? "steer" : "prompt", text, attachments }, start: choice.start() })}
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
        messages={t?.messages}
        queuedMessages={t?.state.queuedMessages}
      />}
    </>
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
