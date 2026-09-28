import { useRef, useState } from "react";
import { SendHorizonalIcon, SquareIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface Props {
  disabled: boolean;
  streaming: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
}

export function Composer({ disabled, streaming, onSend, onStop }: Props) {
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
  return (
    <div className="flex items-end gap-2 border-t bg-card p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
      <Textarea
        ref={ref}
        value={text}
        disabled={disabled}
        rows={1}
        placeholder={streaming ? "Agent is working… queue a follow-up" : "Message…"}
        className="max-h-32 min-h-10 resize-none"
        onChange={(e) => {
          setText(e.target.value);
          e.target.style.height = "auto";
          e.target.style.height = `${Math.min(e.target.scrollHeight, 128)}px`;
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
      <Button
        size="icon"
        aria-label={streaming ? "Stop" : "Send"}
        disabled={disabled || (!streaming && !text.trim())}
        variant={streaming ? "destructive" : "default"}
        onClick={submit}
      >
        {streaming ? <SquareIcon /> : <SendHorizonalIcon />}
      </Button>
    </div>
  );
}
