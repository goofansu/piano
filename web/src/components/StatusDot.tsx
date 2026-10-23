import { cn } from "cn";

/** The states a dot can name, in the palette's status vocabulary. */
export type StatusTone = "busy" | "ok" | "warn" | "err" | "done" | "muted";

const tones: Record<StatusTone, string> = {
  busy: "bg-busy",
  ok: "bg-ok",
  warn: "bg-warn",
  err: "bg-err",
  done: "bg-done",
  muted: "bg-ink-3/45",
};

/**
 * The one status glyph: a 6px dot whose colour is the state, beside the word that names it. It
 * breathes while the state is in progress (`pulse`), as Linear's agent status does, and holds still
 * otherwise. Hand-written: no shadcn component is a bare status indicator.
 */
export function StatusDot({
  tone,
  pulse = false,
  className,
}: {
  tone: StatusTone;
  pulse?: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      data-slot="status-dot"
      data-tone={tone}
      data-motion={pulse ? "pulse" : undefined}
      className={cn("inline-block size-1.5 shrink-0 rounded-full", tones[tone], className)}
    />
  );
}
