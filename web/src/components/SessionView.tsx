import { useEffect, useState } from "react";
import { SessionHeader } from "@/components/SessionHeader";
import { toast } from "sonner";
import { ChangesSheet } from "@/components/Changes";
import { sessionWorkspace } from "@/components/SessionActions";
import type { ClientCommand as ClientMessage, ThinkingLevel } from "@shared/wire";
import { type AppState, sessionKey } from "@/store";
import { cn } from "cn";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Composer } from "@/components/Composer";
import { clampEffort, levelsFor } from "@/components/EffortSelect";
import { MessageList } from "@/components/MessageList";
import { SessionPullRequestBadge, SessionPullRequestDialog } from "@/components/SessionPullRequest";
import { useSessionPullRequest } from "@/lib/useSessionPullRequest";

interface Props {
  state: AppState;
  send: (m: ClientMessage) => void;
  onMenu: () => void;
  onDraftChange: (key: string, text: string) => void;
  onDraftAppend: (key: string, text: string) => void;
  openNew: (cwd?: string) => void;
  changesOpen: boolean;
  onChangesOpenChange: (open: boolean) => void;
  pullRequestOpen: boolean;
  onPullRequestOpenChange: (open: boolean) => void;
}

export function SessionView({ state, send, onMenu, onDraftChange, onDraftAppend, openNew, changesOpen, onChangesOpenChange, pullRequestOpen, onPullRequestOpenChange }: Props) {
  const t = state.session;
  const checkoutMissing = !!t?.state.checkoutMissing;
  const ready = state.connected && !state.resync && !state.selecting && state.selectionId !== null;
  const draftKey = t ? sessionKey(t) : undefined;
  const project = t ? state.projects.find((p) => p.worktrees.some((w) => w.path === t.cwd)) : undefined;
  const [model, setModel] = useState<string | undefined>(undefined);
  // Follow the session's own model and effort when known; otherwise Pi's defaults.
  useEffect(() => setModel(t?.state.model), [t?.cwd, t?.sessionId, t?.state.model]);
  const [effort, setEffort] = useState<ThinkingLevel | undefined>(undefined);
  useEffect(() => setEffort(t?.state.thinkingLevel as ThinkingLevel | undefined), [t?.cwd, t?.sessionId, t?.state.thinkingLevel]);
  const catalog = t ? state.catalogs[t.cwd] ?? null : null;
  useEffect(() => { if (state.connected && t?.cwd && !checkoutMissing) send({ _tag: "models", cwd: t.cwd }); }, [t?.cwd, checkoutMissing, state.connected, send]);
  const effectiveModel = model || catalog?.defaultModel;
  const effectiveEffort = (t?.hosted ? t.state.thinkingLevel as ThinkingLevel | undefined : undefined)
    ?? clampEffort(levelsFor(catalog, effectiveModel), effort || (catalog?.defaultThinkingLevel as ThinkingLevel | undefined) || "medium");
  const extension = t?.state.extension;
  // Pi reports an extension block for every session; only one that says something is shown.
  const extensionContent = !!extension && !!(extension.title || extension.statuses.length || extension.widgets.length || extension.editorRequest);
  const [usedEditorRequest, setUsedEditorRequest] = useState<string>();
  const [overrides, setOverrides] = useState<{ model?: string; thinkingLevel?: ThinkingLevel }>({});
  useEffect(() => setOverrides({}), [t?.cwd, t?.sessionId]);
  // Continuing a file lets Pi restore/check its own selection. Only deliberate
  // offline picker changes override that, not a read-only recorded-model hint.
  const startOptions = () => overrides;
  const streaming = !!(t?.state.isStreaming || t?.state.isCompacting || t?.state.isRetrying);
  const activity = [
    t?.dialogs.length ? "Waiting for input" : null,
    t?.state.isCompacting ? "Compacting" : null,
    t?.state.isRetrying ? "Retrying" : null,
  ].filter(Boolean).join(" · ");
  const submission = t?.state.submission;
  const submissionText = submission ? {
    submitting: "Submitting — waiting for Pi.",
    started: undefined, // Running/ready state already describes the work.
    queued: undefined, // The queue itself shows pending input.
    handled: "Command handled.",
    rejected: "Message rejected.",
    uncertain: "Delivery uncertain — inspect the session and queue before deciding whether to send again. Piano will not resend automatically.",
  }[submission.outcome] : undefined;

  const pullRequest = useSessionPullRequest(t?.cwd, t?.sessionId, streaming);

  const status = !state.connected || (t !== null && !ready) ? "Reconnecting"
    : !t ? "Loading"
    : checkoutMissing ? "Read-only"
    : t.closedReason ? "Exited"
    : activity || (streaming ? "Working" : t.hosted ? "Ready" : "Not running");

  return (
    <>
      <SessionHeader state={state} send={send} onMenu={onMenu} openNew={openNew} status={status} openChanges={() => onChangesOpenChange(true)} openPullRequest={() => onPullRequestOpenChange(true)} pullRequest={<SessionPullRequestBadge value={pullRequest.value} />} />
      {t?.sessionId && <SessionPullRequestDialog key={sessionKey(t)} open={pullRequestOpen} onOpenChange={onPullRequestOpenChange} pr={pullRequest} />}
      {t && <ChangesSheet open={changesOpen} onOpenChange={onChangesOpenChange} workspace={sessionWorkspace(state)} session={t}
        onAsk={text => {
          if (!draftKey) return;
          onDraftAppend(draftKey, `${state.drafts[draftKey]?.trim() ? "\n\n" : ""}${text}`);
          onChangesOpenChange(false);
          toast.success("Added to your message");
        }} />}

      {project?.discovery.status === "error" && (
        <Banner variant="destructive" title="Git status unavailable." action={<Button variant="ghost" size="sm" onClick={() => send({ _tag: "projects" })}>Refresh</Button>}>
          <p className="whitespace-pre-wrap break-words">{project.discovery.detail}</p>
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
      {/* The transcript fades in over a skeleton of itself; the skeleton is on screen within a frame of a switch. */}
      <div className="relative flex min-h-0 flex-1 flex-col">
        {t && (
          <MessageList
            key={sessionKey(t)}
            className="transcript-enter"
            messages={t.messages}
            pending={t.pending}
            tools={t.tools}
            working={streaming && !t.pending?.text}
            placeholder="Nothing here yet. Send the first message."
          />
        )}
        <TranscriptSkeleton hidden={!!t} />
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
            {submission?.detail && <p className="mt-1">{submission.detail}</p>}
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
        disabled={!ready || !t}
        streaming={streaming}
        compacting={t?.state.isCompacting}
        onSend={(text, kind, attachments) => send({ _tag: "act", action: { _tag: kind === "steering" ? "steer" : "prompt", text, attachments }, start: startOptions() })}
        onStop={() => send({ _tag: "act", action: { _tag: "abort" } })}
        catalog={catalog}
        onRefreshModels={t ? () => send({ _tag: "models", cwd: t.cwd, refresh: true }) : undefined}
        model={model}
        onModelChange={(ref) => {
          if (t?.hosted) send({ _tag: "act", action: { _tag: "set_model", model: ref } });
          else { setModel(ref); setOverrides(o => ({ ...o, model: ref })); }
        }}
        effort={effectiveEffort}
        onEffortChange={(level) => {
          if (t?.hosted) send({ _tag: "act", action: { _tag: "set_thinking_level", level } });
          else { setEffort(level); setOverrides(o => ({ ...o, thinkingLevel: level })); }
        }}
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
 * tool row. It is visible while a session is being fetched and fades out as the real transcript
 * fades in; it stays mounted just long enough to finish leaving.
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
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 py-6 md:py-8">
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

/** A notice above the transcript: it slides in, and its details fold out on request. */
function Banner({ variant, title, action, children }: { variant: "destructive" | "warning"; title: string; action?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <Alert variant={variant} className="mx-4 mt-3 w-auto animate-in fade-in-0 slide-in-from-top-1 md:mx-6">
      <AlertTitle className="flex items-center gap-2">{title}{action}</AlertTitle>
      {children && (
        <AlertDescription>
          <Collapsible>
            <CollapsibleTrigger asChild><Button variant="link" size="sm" className="h-auto p-0">Details</Button></CollapsibleTrigger>
            <CollapsibleContent className="disclosure-content">{children}</CollapsibleContent>
          </Collapsible>
        </AlertDescription>
      )}
    </Alert>
  );
}
