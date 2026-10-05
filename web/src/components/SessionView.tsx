import { useEffect, useMemo, useState } from "react";
import { PanelLeftOpenIcon } from "lucide-react";
import type { ClientCommand as ClientMessage, ThinkingLevel } from "@shared/wire";
import { type AppState, sessionKey } from "@/store";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Composer } from "@/components/Composer";
import { SessionMenu } from "@/components/SessionMenu";
import { clampEffort, levelsFor } from "@/components/EffortSelect";
import { MessageList, type TranscriptView } from "@/components/MessageList";
import { PullRequestStack } from "@/components/PullRequestStack";
import { pullRequestUrls, usePullRequests } from "@/lib/pullRequests";

interface Props {
  state: AppState;
  send: (m: ClientMessage) => void;
  onMenu: () => void;
  onDraftChange: (key: string, text: string) => void;
  onDraftAppend: (key: string, text: string) => void;
}

const VIEW_KEY = "piano.transcriptView";
const loadView = (): TranscriptView => {
  try {
    return localStorage.getItem(VIEW_KEY) === "replies" ? "replies" : "all";
  } catch {
    return "all";
  }
};

export function SessionView({ state, send, onMenu, onDraftChange, onDraftAppend }: Props) {
  const [view, setViewState] = useState<TranscriptView>(loadView);
  const setView = (v: TranscriptView) => {
    setViewState(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* ignore */
    }
  };
  const t = state.session;
  const draftKey = t ? sessionKey(t) : undefined;
  const project = t ? state.projects.find((p) => p.worktrees.some((w) => w.path === t.cwd)) : undefined;
  const worktree = project?.worktrees.find((w) => w.path === t?.cwd);
  const title = t?.state.sessionName || project?.sessions.find(s => s.cwd === t?.cwd && s.sessionId === t?.sessionId)?.title || "Untitled session";
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
  const lastResponse = t?.messages.findLast(message => message.role === "assistant");
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
  const [workingSince, setWorkingSince] = useState<number | null>(null);
  useEffect(() => setWorkingSince(streaming ? Date.now() : null), [streaming, t?.sessionId]);

  // Herdr's colours: yellow is working, hollow green is idle, hollow grey is no process, red is attention.
  const prUrls = useMemo(() => (t ? pullRequestUrls(t.messages) : []), [t?.messages]);
  const prs = usePullRequests(prUrls, !streaming);

  const status = !state.connected
    ? { word: "Reconnecting", dot: "border border-err", why: "The connection to piano dropped. Retrying." }
    : !t
      ? { word: "Loading", dot: "bg-ink-3", why: "Fetching this session." }
      : t.closedReason
        ? { word: "Exited", dot: "border border-ink-3", why: `Pi stopped: ${t.closedReason}. A new message restarts Pi, not the interrupted operation.` }
      : activity
        ? { word: activity, dot: "animate-live bg-busy", why: "Pi's reported activity and retained dialogs. Waiting, compaction and retry are separate from input acceptance." }
      : streaming
        ? { word: "Working", dot: "animate-live bg-busy", why: "Pi has not settled; it can still continue automatically." }
        : t.hosted
          ? { word: "Ready", dot: "border border-ok", why: "Pi is running for this session and waiting for your message." }
          : { word: "Not running", dot: "border border-ink-3", why: "Pi is not running. Your next message starts it and continues this session." };

  return (
    <>
      <header className="flex h-12 shrink-0 items-center justify-end border-b border-line px-4">
        <Button variant="ghost" size="icon-sm" className="-ml-2 mr-auto md:hidden" aria-label="Show sidebar" onClick={onMenu}><PanelLeftOpenIcon /></Button>
        {/* Preserve live status announcements; visible session facts live in the menu. */}
        <span role="status" className="sr-only">{status.word}</span>
        {t && <SessionMenu key={draftKey} session={t} title={title} projectName={project?.name} worktree={worktree}
          status={status} connected={state.connected && !state.resync} view={view} onViewChange={setView} send={send} />}
      </header>

      {project?.discovery.status === "error" && <div role="alert" className="border-b border-line px-4 py-2 text-sm text-err">
        Git status unavailable. <Button variant="ghost" size="sm" onClick={() => send({ _tag: "projects" })}>Refresh</Button>
        <details><summary className="cursor-pointer">Details</summary><p className="whitespace-pre-wrap break-words">{project.discovery.detail}</p></details>
      </div>}
      {t?.closedReason && t.closedReason !== "released" && (
        <div role="alert" className="border-b border-line bg-err-soft px-4 py-2 text-sm text-err">Pi stopped: {t.closedReason}. Interrupted operations are not resumed. Inspect the checkout before continuing.</div>
      )}

      {t?.state.projectionError && (
        <div role="alert" className="border-b border-line px-4 py-2 text-sm text-warn">
          <p>Unable to refresh the conversation. Recent changes may be missing.</p>
          <details className="mt-1"><summary className="cursor-pointer">Details</summary><p className="break-words">{t.state.projectionError}</p></details>
        </div>
      )}
      {(t?.state.stateRefreshError || t?.state.statsRefreshError) && (
        <div role="alert" className="border-b border-line px-4 py-2 text-sm text-warn">
          <p>Unable to refresh session details. Some information may be stale.</p>
          <details className="mt-1"><summary className="cursor-pointer">Details</summary>
            <p className="break-words">{t.state.stateRefreshError}</p><p className="break-words">{t.state.statsRefreshError}</p>
          </details>
        </div>
      )}
      {t ? (
        <MessageList
          messages={t.messages}
          pending={t.pending}
          tools={t.tools}
          placeholder="Nothing here yet. Send the first message."
          workingSince={workingSince}
          view={view}
        />
      ) : (
        <div className="flex flex-1 items-center justify-center text-base text-ink-2">Loading</div>
      )}
      {t && <PullRequestStack prs={prs} />}
      {t?.state.dialogResolution && (
        <section aria-label="Last dialog" role="status" className="px-4 pt-2 text-sm text-ink-2 md:px-6">
          <p className="mx-auto max-w-2xl break-words">Dialog {t.state.dialogResolution.reason}: {t.state.dialogResolution.detail}</p>
        </section>
      )}
      {submissionText && (
        <section aria-label="Last input" role="status" className={cn("px-4 pt-2 text-sm md:px-6", submission?.outcome === "uncertain" || submission?.outcome === "rejected" ? "text-warn" : "text-ink-2")}>
          <div className="mx-auto max-w-2xl break-words">
            <p>{submissionText}</p>
            {submission?.detail && <p className="mt-1">{submission.detail}</p>}
          </div>
        </section>
      )}
      {extension && <section aria-label="Extension state" className="max-h-40 overflow-auto border-t border-line px-4 py-2 text-xs text-ink-2">
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
      <Composer
        text={draftKey ? state.drafts[draftKey] ?? "" : ""}
        onTextChange={(text) => { if (draftKey) onDraftChange(draftKey, text); }}
        onTextAppend={(text) => { if (draftKey) onDraftAppend(draftKey, text); }}
        onRestoreQueue={() => send({ _tag: "act", action: { _tag: "restore_queue" } })}
        disabled={!state.connected || !t}
        streaming={streaming}
        compacting={t?.state.isCompacting}
        onSend={(text) => send({ _tag: "act", action: { _tag: "prompt", text }, start: startOptions() })}
        onStop={() => send({ _tag: "act", action: { _tag: "abort" } })}
        catalog={catalog}
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
        contextIsLastKnown={!state.connected || state.resync || !t?.hosted || t.state.contextIsLastKnown !== false}
        cost={t?.state.cost}
        totalTokens={t?.state.tokens?.total}
        responseModel={lastResponse?.model}
        responseEffort={lastResponse?.thinkingLevel}
        queuedMessages={t?.state.queuedMessages}
      />
    </>
  );
}
