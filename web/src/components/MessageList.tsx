import { useEffect, useRef } from "react";
import { CheckIcon, LoaderCircleIcon, XIcon } from "lucide-react";
import type { RenderMsg } from "@shared/wire";
import { clamp, modelShort } from "@/lib/format";
import { renderMarkdown } from "@/lib/markdown";
import { cn } from "cn";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

interface Props {
  messages: RenderMsg[];
  pending: RenderMsg | null;
  activeTools: Record<string, string>;
  placeholder: string;
}

export function MessageList({ messages, pending, activeTools, placeholder }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  // Keep the view pinned to the bottom unless the reader scrolled up.
  useEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages, pending, activeTools]);

  const tools = Object.entries(activeTools);
  return (
    <div
      ref={ref}
      onScroll={(e) => {
        const el = e.currentTarget;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      }}
      className="min-h-0 flex-1 overflow-y-auto py-4"
    >
      {messages.length === 0 && !pending && <p className="px-6 py-12 text-center text-sm text-muted-foreground">{placeholder}</p>}
      {messages.map((m) => <Message key={m.id} msg={m} />)}
      {pending && <Message msg={pending} streaming />}
      {tools.length > 0 && (
        <div className="flex flex-wrap gap-1 px-4 py-1">
          {tools.map(([id, name]) => (
            <span key={id} className="inline-flex items-center gap-1 rounded border bg-muted px-2 py-0.5 font-mono text-xs text-amber-600 dark:text-amber-400">
              <LoaderCircleIcon className="size-3 animate-spin" /> {name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function Message({ msg, streaming }: { msg: RenderMsg; streaming?: boolean }) {
  if (msg.role === "user") {
    return (
      <article className="px-4 py-2">
        <Label className="text-sky-600 dark:text-sky-400">You</Label>
        <div className="whitespace-pre-wrap break-words text-sm">{msg.text}</div>
      </article>
    );
  }
  if (msg.role === "assistant") {
    return (
      <article className="px-4 py-2">
        <div className="flex items-baseline gap-2">
          <Label className={streaming ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}>Assistant</Label>
          {msg.model && <span className="text-xs text-muted-foreground">{modelShort(msg.model)}</span>}
        </div>
        {(msg.text || streaming) && (
          <div
            className={cn("prose prose-sm max-w-none break-words text-sm dark:prose-invert", streaming && "after:ml-0.5 after:inline-block after:h-3.5 after:w-1.5 after:animate-pulse after:bg-amber-500 after:align-text-bottom")}
            // renderMarkdown escapes all HTML before adding its own tags
            dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.text) }}
          />
        )}
        {msg.toolCalls?.map((tc) => (
          <Collapsible key={tc.id} className="mt-1.5 rounded-md border">
            <CollapsibleTrigger className="flex w-full items-center gap-2 bg-muted px-3 py-1.5 text-left font-mono text-xs text-violet-600 dark:text-violet-400">
              ▸ {tc.name}
            </CollapsibleTrigger>
            <CollapsibleContent>
              <pre className="overflow-x-auto whitespace-pre-wrap break-all p-3 font-mono text-xs text-muted-foreground">{clamp(tc.args, 4000)}</pre>
            </CollapsibleContent>
          </Collapsible>
        ))}
      </article>
    );
  }
  return (
    <article className="px-4 py-2">
      <Label className={msg.isError ? "text-red-600 dark:text-red-400" : "text-violet-600 dark:text-violet-400"}>
        <span className="inline-flex items-center gap-1">{msg.isError ? <XIcon className="size-3" /> : <CheckIcon className="size-3" />} {msg.toolName || "result"}</span>
      </Label>
      {msg.text && (
        <Collapsible>
          <CollapsibleTrigger className="text-xs text-muted-foreground">▸ output</CollapsibleTrigger>
          <CollapsibleContent>
            <pre className={cn("mt-1 overflow-x-auto whitespace-pre-wrap break-all rounded-md border bg-muted p-3 font-mono text-xs", msg.isError ? "text-red-600 dark:text-red-400" : "text-muted-foreground")}>{clamp(msg.text, 4000)}</pre>
          </CollapsibleContent>
        </Collapsible>
      )}
    </article>
  );
}

function Label({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("mb-1 text-[11px] font-semibold uppercase tracking-wider", className)}>{children}</div>;
}
