import { cn } from "cn";
import { Keys } from "@/components/PianoMark";
import type { SessionActivity } from "@/lib/sessionCatalog";

/**
 * A session's activity as a 16px glyph, decorative: callers say it in text for screen readers. The
 * keys play while the session works; afterwards Herdr's dots: tidal-blue done, hollow sage idle,
 * nothing when no process.
 */
export function ActivityGlyph({ activity }: { activity: SessionActivity }) {
  const dot = activity === "done" ? "bg-done" : activity === "idle" ? "border border-ok" : null;
  return (
    <span className="flex size-4 shrink-0 items-center justify-center" aria-hidden>
      {activity === "working" ? (
        <Keys playing className="text-brand" />
      ) : (
        dot && <span className={cn("size-2 rounded-full", dot)} />
      )}
    </span>
  );
}
