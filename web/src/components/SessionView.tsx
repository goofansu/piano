import { useEffect, useMemo, useState } from "react";
import { PanelLeftOpenIcon } from "lucide-react";
import type { ClientCommand as ClientMessage, ThinkingLevel } from "@shared/wire";
import { type AppState, sessionKey } from "@/store";
import { cn } from "cn";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { Composer } from "@/components/Composer";
import { clampEffort, levelsFor } from "@/components/EffortSelect";
import { MessageList } from "@/components/MessageList";
import { PullRequestStack } from "@/components/PullRequestStack";
import { pullRequestUrls, usePullRequests } from "@/lib/pullRequests";

interface Props {
  state: AppState;
  send: (m: ClientMessage) => void;
  onMenu: () => void;
  onDraftChange: (key: string, text: string) => void;
  onDraftAppend: (key: string, text: string) => void;
}

export function SessionView({ state, send, onMenu, onDraftChange, onDraftAppend }: Props) {
  const t = state.session;
  const ready = state.connected && !state.resync && !state.selecting && state.selectionId !== null;
  const draftKey = t ? sessionKey(t) : undefined;
  const project = t ? state.projects.find((p) => p.worktrees.some((w) => w.path === t.cwd)) : undefined;
  const [model, setModel] = useState<string | undefined>(undefined);
  // Follow the session's own model and effort when known; otherwise Pi's defaults.
  useEffect(() => setModel(t?.state.model), [t?.cwd, t?.sessionId, t?.state.model]);
  const [effort, setEffort] = useState<ThinkingLevel | undefined>(undefined);
  useEffect(() => setEffort(t?.state.thinkingLevel as ThinkingLevel | undefined), [t?.cwd, t?.sessionId, t?.state.thinkingLevel]);
  const catalog = t ? state.catalogs[t.cwd] ?? null : null;
  useEffect(() => { if (state.connected && t?.cwd) send({ _tag: "models", cwd: t.cwd }); }, [t?.cwd, state.connected, send]);
  const effectiveModel = model || catalog?.defaultModel;
  const effectiveEffort = (t?.hosted ? t.state.thinkingLevel as ThinkingLevel | undefined : undefined)
    ?? clampEffort(levelsFor(catalog, effectiveModel), effort || (catalog?.defaultThinkingLevel as ThinkingLevel | undefined) || "medium");
  const extension = t?.state.extension;
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

  const prUrls = useMemo(() => (t ? pullRequestUrls(t.messages) : []), [t?.messages]);
  const prs = usePullRequests(prUrls, !streaming);

  const status = !state.connected || (t !== null && !ready) ? "Reconnecting"
    : !t ? "Loading"
    : t.closedReason ? "Exited"
    : activity || (streaming ? "Working" : t.hosted ? "Ready" : "Not running");

  return (
    <>
      <header className="flex h-12 shrink-0 items-center border-b border-line px-4 md:h-0 md:border-0">
        <Button variant="ghost" size="icon-sm" className="-ml-2 md:hidden" aria-label="Show sidebar" onClick={onMenu}><PanelLeftOpenIcon /></Button>
        <span role="status" className="sr-only">{status}</span>
      </header>

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
      {t ? (
        <MessageList
          messages={t.messages}
          pending={t.pending}
          tools={t.tools}
          placeholder="Nothing here yet. Send the first message."
        />
      ) : (
        <div className="flex flex-1 items-center justify-center"><Spinner className="text-muted-foreground" /></div>
      )}
      {t && <PullRequestStack prs={prs} />}
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
      {extension && <><Separator /><section aria-label="Extension state" className="max-h-40 overflow-auto px-4 py-2 text-xs text-ink-2">
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
      </section></>}
      <Composer
        key={draftKey}
        draftKey={draftKey ?? "loading"}
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
      />
    </>
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
