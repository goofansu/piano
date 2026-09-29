import { useEffect, useState } from "react";
import { GitBranchIcon, ListCollapseIcon, ListIcon, MenuIcon } from "lucide-react";
import type { ClientMessage } from "@shared/wire";
import type { AppState } from "@/store";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Composer } from "@/components/Composer";
import { MessageList, type TranscriptView } from "@/components/MessageList";

interface Props {
  state: AppState;
  send: (m: ClientMessage) => void;
  onMenu: () => void;
}

const VIEW_KEY = "piano.transcriptView";
const loadView = (): TranscriptView => {
  try {
    return localStorage.getItem(VIEW_KEY) === "replies" ? "replies" : "all";
  } catch {
    return "all";
  }
};

export function SessionView({ state, send, onMenu }: Props) {
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
  const project = t ? state.projects.find((p) => p.worktrees.some((w) => w.path === t.cwd)) : undefined;
  const worktree = project?.worktrees.find((w) => w.path === t?.cwd);
  const [model, setModel] = useState<string | undefined>(undefined);
  // Follow the session's own model when it is known; otherwise pi's default.
  useEffect(() => setModel(t?.state.model), [t?.cwd, t?.sessionId, t?.state.model]);

  const startOptions = () => ({ model: model || state.catalog?.defaultModel });
  const streaming = !!t?.state.isStreaming;
  const [workingSince, setWorkingSince] = useState<number | null>(null);
  useEffect(() => setWorkingSince(streaming ? Date.now() : null), [streaming, t?.sessionId]);

  // Herdr's colours: yellow is working, hollow green is idle, hollow grey is no process, red is attention.
  const status = !state.connected
    ? { word: "Reconnecting", dot: "border border-err", why: "The connection to piano dropped. Retrying." }
    : !t
      ? { word: "Loading", dot: "bg-ink-3", why: "Fetching this session." }
      : streaming
        ? { word: "Working", dot: "animate-live bg-busy", why: "pi is running a turn." }
        : t.hosted
          ? { word: "Ready", dot: "border border-ok", why: "pi is running for this session and waiting for your message." }
          : { word: "Not running", dot: "border border-ink-3", why: "pi is not running. Your next message starts it and continues this session." };

  return (
    <>
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line px-4 text-sm">
        <Button variant="ghost" size="icon-sm" className="-ml-2 md:hidden" aria-label="Menu" onClick={onMenu}><MenuIcon /></Button>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="flex items-center gap-2 text-ink-2">
              <span className={cn("size-2 shrink-0 rounded-full", status.dot)} aria-hidden />
              <span role="status">{status.word}</span>
            </span>
          </TooltipTrigger>
          <TooltipContent>{status.why}</TooltipContent>
        </Tooltip>
        {t && (
          <span className="flex min-w-0 items-center gap-2 truncate" title={t.cwd}>
            <span className="h-4 w-px bg-line-strong" aria-hidden />
            {project && <span className="font-medium">{project.name}</span>}
            <span className="inline-flex items-center gap-1 rounded-md bg-fill px-1.5 font-mono text-ink-2">
              <GitBranchIcon className="size-3.5" /> {worktree?.branch || "root"}
            </span>
            {t.state.sessionName ? <span className="truncate text-ink-2">{t.state.sessionName}</span> : null}
          </span>
        )}
        <span className="flex-1" />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="-mr-2 font-normal"
              aria-label="Show end-of-turn messages only"
              aria-pressed={view === "replies"}
              onClick={() => setView(view === "all" ? "replies" : "all")}
            >
              {view === "all" ? <ListIcon className="text-ink-3" /> : <ListCollapseIcon className="text-ink-3" />}
              <span className="hidden sm:inline">{view === "all" ? "All messages" : "End of turn only"}</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>{view === "all" ? "See end-of-turn messages only" : "See all messages"}</TooltipContent>
        </Tooltip>
      </header>

      {t?.closedReason && !/released|code 0\b/.test(t.closedReason) && (
        <div className="border-b border-line bg-err-soft px-4 py-2 text-sm text-err">pi stopped: {t.closedReason}</div>
      )}

      {t ? (
        <MessageList
          messages={t.messages}
          pending={t.pending}
          activeTools={t.activeTools}
          placeholder="Nothing here yet. Send the first message."
          workingSince={workingSince}
          view={view}
        />
      ) : (
        <div className="flex flex-1 items-center justify-center text-base text-ink-2">Loading</div>
      )}
      <Composer
        disabled={!state.connected || !t}
        streaming={streaming}
        onSend={(text) => send({ _tag: "act", action: { _tag: "prompt", text }, start: startOptions() })}
        onStop={() => send({ _tag: "act", action: { _tag: "abort" } })}
        catalog={state.catalog}
        model={model}
        onModelChange={(ref) => {
          setModel(ref);
          if (t?.hosted) send({ _tag: "act", action: { _tag: "set_model", model: ref } });
        }}
        context={t?.state.context}
        cost={t?.state.cost}
      />
    </>
  );
}
