import { cn } from "cn";

export type StatusTone = "busy" | "ok" | "warn" | "err" | "done" | "muted";

const tones: Record<StatusTone, string> = {
  busy: "bg-busy",
  ok: "bg-ok",
  warn: "bg-warn",
  err: "bg-err",
  done: "bg-done",
  muted: "bg-ink-3/45",
};

export function StatusDot({ tone, className }: { tone: StatusTone; className?: string }) {
  return (
    <span
      aria-hidden
      data-slot="status-dot"
      data-tone={tone}
      data-motion={tone === "busy" ? "pulse" : undefined}
      className={cn("inline-block size-1.5 shrink-0 rounded-full", tones[tone], className)}
    />
  );
}
