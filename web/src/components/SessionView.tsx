import { useEffect, useState } from "react";
import { GitBranchIcon, MenuIcon } from "lucide-react";
import type { ClientMessage } from "@shared/wire";
import type { AppState } from "@/store";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Composer } from "@/components/Composer";
import { MessageList } from "@/components/MessageList";

interface Props {
  state: AppState;
  send: (m: ClientMessage) => void;
  onMenu: () => void;
  select: (cwd: string, sessionId: string | null) => void;
}

export function SessionView({ state, send, onMenu, select }: Props) {
  const t = state.session;
  const project = t ? state.projects.find((p) => p.worktrees.some((w) => w.path === t.cwd)) : undefined;
  const worktree = project?.worktrees.find((w) => w.path === t?.cwd);
  const [model, setModel] = useState<string | undefined>(undefined);
  // Follow the session's own model when it is known; otherwise pi's default.
  useEffect(() => setModel(t?.state.model), [t?.cwd, t?.sessionId, t?.state.model]);

  const startOptions = () => ({ model: model || state.catalog?.defaultModel });
  const streaming = !!t?.state.isStreaming;

  const status = !state.connected ? "Disconnected, reconnecting…" : !t ? (state.selecting ? "Loading…" : "Connected") : streaming ? "Agent working…" : "Idle";

  return (
    <>
      <header className="flex items-center gap-2 border-b bg-card px-3 py-2 text-xs text-muted-foreground">
        <Button variant="ghost" size="icon" className="md:hidden" aria-label="Menu" onClick={onMenu}><MenuIcon /></Button>
        <span className={cn("size-2 shrink-0 rounded-full", !state.connected ? "bg-muted-foreground" : streaming ? "animate-pulse bg-amber-500" : "bg-emerald-500")} />
        <span className="shrink-0">{status}</span>
        {t && (
          <span className="flex min-w-0 items-center gap-1.5 truncate" title={t.cwd}>
            {project && <span className="font-semibold text-foreground">{project.name}</span>}
            <span className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px]">
              <GitBranchIcon className="size-3" /> {worktree?.branch || "root"}
            </span>
            {t.state.sessionName ? <span className="truncate">· {t.state.sessionName}</span> : null}
          </span>
        )}
        <span className="flex-1" />
      </header>

      {t && !t.sessionId && project && (
        <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2 text-xs">
          <span className="text-muted-foreground">worktree</span>
          <Select value={t.cwd} onValueChange={(cwd) => select(cwd, null)}>
            <SelectTrigger className="h-8 w-[200px] text-xs" aria-label="Worktree">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {project.worktrees.map((w) => (
                <SelectItem key={w.path} value={w.path}>{w.branch || "root"}{w.main ? " (root)" : ""}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      {t?.closedReason && !/released|code 0\b/.test(t.closedReason) && (
        <div className="border-b px-3 py-1 text-xs text-destructive">{t.closedReason}</div>
      )}

      {t ? (
        <MessageList
          messages={t.messages}
          pending={t.pending}
          activeTools={t.activeTools}
          placeholder="Send a message to start this session."
        />
      ) : (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          {state.selecting ? "Loading…" : "Pick a session on the left, or add a project."}
        </div>
      )}
      <Separator />
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
