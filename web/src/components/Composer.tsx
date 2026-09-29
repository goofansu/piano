import { useRef, useState } from "react";
import { ArrowUpIcon, SquareIcon } from "lucide-react";
import type { ContextUsage, ModelCatalog, ThinkingLevel } from "@shared/wire";
import { cn } from "cn";
import { composerCard } from "@/lib/styles";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { EffortSelect, levelsFor } from "@/components/EffortSelect";
import { ModelSelect } from "@/components/ModelSelect";

interface Props {
  disabled: boolean;
  streaming: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
  catalog: ModelCatalog | null;
  model: string | undefined;
  onModelChange: (ref: string) => void;
  effort: ThinkingLevel;
  onEffortChange: (level: ThinkingLevel) => void;
  context?: ContextUsage;
  cost?: number;
}

const k = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));

/** The composer: a layer-1 card that lines up with the transcript column. */
export function Composer({ disabled, streaming, onSend, onStop, catalog, model, onModelChange, effort, onEffortChange, context, cost }: Props) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  const send = () => {
    const t = text.trim();
    if (!t) return;
    onSend(t);
    setText("");
    if (ref.current) ref.current.style.height = "auto";
  };
  const percent = context?.percent ?? null;
  const left = percent === null ? null : Math.max(0, 100 - percent);

  return (
    <div className="px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2 md:px-6">
      <div className={cn("mx-auto w-full max-w-2xl", composerCard)}>
        <Textarea
          ref={ref}
          value={text}
          disabled={disabled}
          rows={1}
          aria-label="Message"
          placeholder={streaming ? "pi is working. Type to queue the next message." : "What should pi do next?"}
          className="max-h-48 min-h-12 resize-none border-0 bg-transparent px-4 pt-3 shadow-none focus-visible:ring-0"
          onChange={(e) => {
            setText(e.target.value);
            e.target.style.height = "auto";
            e.target.style.height = `${Math.min(e.target.scrollHeight, 192)}px`;
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            } else if (e.key === "Escape" && streaming) {
              e.preventDefault();
              onStop();
            }
          }}
        />
        <div className="flex items-center gap-1 px-2.5 pb-2.5 text-sm text-ink-2">
          <ModelSelect catalog={catalog} value={model} onChange={onModelChange} disabled={disabled} />
          <EffortSelect value={effort} onChange={onEffortChange} levels={levelsFor(catalog, model || catalog?.defaultModel)} defaultLevel={catalog?.defaultThinkingLevel} disabled={disabled} />
          {context && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className={cn("inline-flex h-8 items-center gap-1.5 rounded-md px-2 tabular-nums", left !== null && left < 15 && "text-warn")}>
                  <span className="relative inline-block size-3.5 rounded-full border border-current/40">
                    {percent !== null && (
                      <span className="absolute inset-0 rounded-full" style={{ background: `conic-gradient(currentColor ${Math.min(100, percent)}%, transparent 0)` }} />
                    )}
                  </span>
                  {left === null ? `${k(context.contextWindow)} context` : `${Math.round(left)}% context left`}
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {context.tokens === null ? "Context usage not known yet" : `${k(context.tokens)} of ${k(context.contextWindow)} tokens used`}
                {cost !== undefined ? `, $${cost.toFixed(2)} so far` : ""}
              </TooltipContent>
            </Tooltip>
          )}
          <span className="flex-1" />
          {streaming ? (
            <Button size="icon-sm" variant="outline" className="rounded-full" aria-label="Stop" disabled={disabled} onClick={onStop}>
              <SquareIcon className="size-3.5 fill-current" />
            </Button>
          ) : (
            <Button size="icon-sm" className="rounded-full" aria-label="Send" disabled={disabled || !text.trim()} onClick={send}>
              <ArrowUpIcon />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
