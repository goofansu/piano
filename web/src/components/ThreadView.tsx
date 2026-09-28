import { useEffect, useState } from "react";
import { MenuIcon, PowerIcon } from "lucide-react";
import { toast } from "sonner";
import type { ClientMessage } from "@shared/wire";
import type { AppState } from "@/store";
import { abbrevHome, modelShort } from "@/lib/format";
import { cn } from "cn";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Composer } from "@/components/Composer";
import { MessageList } from "@/components/MessageList";
import { ModelSelect } from "@/components/ModelSelect";

interface Props {
  state: AppState;
  send: (m: ClientMessage) => void;
  onMenu: () => void;
}

export function ThreadView({ state, send, onMenu }: Props) {
  const t = state.thread;
  const [model, setModel] = useState<string | undefined>(undefined);
  const [name, setName] = useState("");
  // Follow the thread's own model when it is known; otherwise pi's default.
  useEffect(() => setModel(t?.state.model), [t?.cwd, t?.sessionId, t?.state.model]);

  const startOptions = () => ({ model: model || state.catalog?.defaultModel, name: name.trim() || undefined });
  const streaming = !!t?.state.isStreaming;

  const status = !state.connected ? "Disconnected, reconnecting…" : !t ? (state.selecting ? "Loading…" : "Connected") : streaming ? "Agent working…" : t.hosted ? "Idle" : "Not running";

  return (
    <>
      <header className="flex items-center gap-2 border-b bg-card px-3 py-2 text-xs text-muted-foreground">
        <Button variant="ghost" size="icon" className="md:hidden" aria-label="Menu" onClick={onMenu}><MenuIcon /></Button>
        <span className={cn("size-2 shrink-0 rounded-full", !state.connected ? "bg-muted-foreground" : streaming ? "animate-pulse bg-amber-500" : "bg-emerald-500")} />
        <span className="shrink-0">{status}</span>
        {t && (
          <span className="min-w-0 truncate font-mono text-[11px]" title={t.cwd}>
            {abbrevHome(t.cwd)}
            {t.state.sessionName ? `  ·  ${t.state.sessionName}` : ""}
          </span>
        )}
        <span className="flex-1" />
        {t?.state.model && <span className="shrink-0 text-foreground">{modelShort(t.state.model)}</span>}
      </header>

      {t && (
        <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2 text-xs">
          <span className="text-muted-foreground">model</span>
          <ModelSelect
            catalog={state.catalog}
            value={model}
            onChange={(ref) => {
              setModel(ref);
              if (t.hosted) send({ _tag: "act", action: { _tag: "set_model", model: ref } });
            }}
          />
          {t.hosted ? (
            <>
              <Badge variant="outline" className="gap-1"><span className="size-1.5 rounded-full bg-emerald-500" /> pi running</Badge>
              {t.state.sessionFile && <span className="hidden truncate font-mono text-[10px] text-muted-foreground lg:inline" title={t.state.sessionFile}>{abbrevHome(t.state.sessionFile)}</span>}
              <span className="flex-1" />
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-destructive"
                    onClick={() => (!streaming || confirm("The agent is still working. Release anyway?")) && send({ _tag: "release" })}
                  >
                    <PowerIcon /> Release
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Stop pi for this thread; the session file is kept</TooltipContent>
              </Tooltip>
            </>
          ) : (
            <>
              {!t.sessionId && <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="thread name (optional)" className="h-8 w-48 text-xs" />}
              <Button
                size="sm"
                onClick={() => {
                  toast("Starting pi…");
                  send({ _tag: "start", options: startOptions() });
                }}
              >
                Start
              </Button>
              {t.closedReason && <span className="text-destructive">{t.closedReason}</span>}
            </>
          )}
        </div>
      )}

      {t ? (
        <MessageList
          messages={t.messages}
          pending={t.pending}
          activeTools={t.activeTools}
          placeholder={t.hosted ? "pi is running for this thread. Say something." : "Not running yet. Pick a model if you want, then send a message (or press Start)."}
        />
      ) : (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          {state.selecting ? "Loading…" : "Pick a thread on the left, or add a project."}
        </div>
      )}
      <Separator />
      <Composer
        disabled={!state.connected || !t}
        streaming={streaming}
        onSend={(text) => send({ _tag: "act", action: { _tag: "prompt", text }, start: t?.hosted ? undefined : startOptions() })}
        onStop={() => send({ _tag: "act", action: { _tag: "abort" } })}
      />
    </>
  );
}
