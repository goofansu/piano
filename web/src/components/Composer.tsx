import { useRef, useState } from "react";
import { SendHorizonalIcon, SquareIcon } from "lucide-react";
import type { ContextUsage, ModelCatalog } from "@shared/wire";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ModelSelect } from "@/components/ModelSelect";

interface Props {
  disabled: boolean;
  streaming: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
  catalog: ModelCatalog | null;
  model: string | undefined;
  onModelChange: (ref: string) => void;
  context?: ContextUsage;
  cost?: number;
}

const k = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));

export function Composer({ disabled, streaming, onSend, onStop, catalog, model, onModelChange, context, cost }: Props) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  const submit = () => {
    if (streaming) return onStop();
    const t = text.trim();
    if (!t) return;
    onSend(t);
    setText("");
    if (ref.current) ref.current.style.height = "auto";
  };
  const percent = context?.percent ?? null;
  const left = percent === null ? null : Math.max(0, 100 - percent);

  return (
    <div className="border-t bg-card p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
      <div className="rounded-xl border bg-background focus-within:ring-1 focus-within:ring-ring">
        <Textarea
          ref={ref}
          value={text}
          disabled={disabled}
          rows={1}
          placeholder={streaming ? "Agent is working… type to queue a follow-up" : "Message…"}
          className="max-h-40 min-h-10 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
          onChange={(e) => {
            setText(e.target.value);
            e.target.style.height = "auto";
            e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (streaming && text.trim()) {
                onSend(text.trim());
                setText("");
              } else submit();
            }
          }}
        />
        <div className="flex items-center gap-2 px-2 pb-2 text-xs text-muted-foreground">
          <ModelSelect catalog={catalog} value={model} onChange={onModelChange} disabled={disabled} />
          {context && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className={cn("inline-flex items-center gap-1.5 tabular-nums", left !== null && left < 15 && "text-amber-600 dark:text-amber-400")}>
                  <span className="relative inline-block size-3.5 rounded-full border border-current/40">
                    {percent !== null && (
                      <span
                        className="absolute inset-0 rounded-full"
                        style={{ background: `conic-gradient(currentColor ${Math.min(100, percent)}%, transparent 0)` }}
                      />
                    )}
                  </span>
                  {left === null ? `${k(context.contextWindow)} window` : `${Math.round(left)}% left`}
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {context.tokens === null ? "Context usage not known yet" : `${k(context.tokens)} of ${k(context.contextWindow)} tokens used`}
                {cost !== undefined ? ` · $${cost.toFixed(2)} so far` : ""}
              </TooltipContent>
            </Tooltip>
          )}
          <span className="flex-1" />
          <Button
            size="icon"
            className="size-8"
            aria-label={streaming ? "Stop" : "Send"}
            disabled={disabled || (!streaming && !text.trim())}
            variant={streaming ? "destructive" : "default"}
            onClick={submit}
          >
            {streaming ? <SquareIcon /> : <SendHorizonalIcon />}
          </Button>
        </div>
      </div>
    </div>
  );
}
