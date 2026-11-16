import { cn } from "cn";

/**
 * The selectable session ID at the top of the session menu, in the dropdown and in the sheet, its
 * copy controls beside it.
 */
export function SessionIdDetails({
  sessionId,
  className,
}: {
  sessionId?: string;
  className?: string;
}) {
  return (
    // Static, selectable metadata has no menu-item primitive; a definition list keeps field names accessible.
    <dl
      className={cn(
        "flex min-w-0 flex-1 select-text flex-col gap-1 py-2 font-mono text-xs",
        className,
      )}
    >
      <div className="min-w-0">
        <dt className="sr-only">Session ID</dt>
        <dd className="break-all text-muted-foreground">{sessionId ?? "Not available"}</dd>
      </div>
    </dl>
  );
}
