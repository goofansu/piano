import { type RefObject, useEffect, useRef, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/** Temporary [DEBUG-pwa-keyboard] probe. Remove after the iPhone failure is diagnosed.
 * No text, keys, paths, IDs or DOM attributes are collected, persisted or uploaded.
 * Passive capture observes missed taps too; it never focuses or cancels an event.
 */
export function KeyboardDiagnostics({ textarea }: { textarea: RefObject<HTMLTextAreaElement | null> }) {
  const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const [open, setOpen] = useState(false);
  const [report, setReport] = useState("");
  const [copyStatus, setCopyStatus] = useState("");
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!standalone || !open) return;
    let disposed = false;
    const started = performance.now();
    const lines: string[] = [];
    const pending = new Set<ReturnType<typeof setTimeout>>();
    const describe = (target: EventTarget | null) => target === textarea.current ? "composer" : target instanceof Element ? target.tagName.toLowerCase() : "none";
    const record = (event?: Event) => {
      if (disposed) return;
      const el = textarea.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const css = getComputedStyle(el);
      const viewport = window.visualViewport;
      const eventLine = event ? `${Math.round(performance.now() - started)}ms ${event.type} target=${describe(event.target)} prevented=${event.defaultPrevented} active=${describe(document.activeElement)}` : "Started";
      lines.push(eventLine);
      if (lines.length > 10) lines.shift();
      setReport([
        "[DEBUG-pwa-keyboard] v1",
        `standalone=${standalone} coarse=${matchMedia("(pointer: coarse)").matches}`,
        `disabled=${el.disabled} readonly=${el.readOnly} connected=${el.isConnected}`,
        `active=${describe(document.activeElement)} centerHit=${describe(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2))}`,
        `pointer=${css.pointerEvents} visibility=${css.visibility} display=${css.display}`,
        `box=${[rect.x, rect.y, rect.width, rect.height].map(Math.round).join(",")}`,
        `viewport=${Math.round(viewport?.width ?? innerWidth)}x${Math.round(viewport?.height ?? innerHeight)} offset=${Math.round(viewport?.offsetTop ?? 0)}`,
        ...lines,
      ].join("\n"));
    };
    const observe = (event: Event) => {
      if (event.target instanceof Node && panel.current?.contains(event.target)) return;
      // Read defaultPrevented and activeElement after dispatch/default actions,
      // without installing a handler on the composer or changing its identity.
      const timer = setTimeout(() => { pending.delete(timer); record(event); }, 0);
      pending.add(timer);
    };
    const events = ["pointerdown", "pointerup", "pointercancel", "touchstart", "touchend", "click", "focusin", "focusout"];
    for (const type of events) document.addEventListener(type, observe, { capture: true, passive: true });
    window.visualViewport?.addEventListener("resize", observe);
    record();
    return () => {
      disposed = true;
      for (const type of events) document.removeEventListener(type, observe, true);
      window.visualViewport?.removeEventListener("resize", observe);
      for (const timer of pending) clearTimeout(timer);
    };
  }, [open, standalone, textarea]);

  if (!standalone) return null;
  return (
    <div ref={panel} className="mx-auto mt-2 w-full max-w-3xl">
      <Button type="button" variant="ghost" size="sm" className="h-11" aria-expanded={open} onClick={() => { setOpen(!open); setCopyStatus(""); }}>
        {open ? "Close keyboard diagnostics" : "Keyboard diagnostics"}
      </Button>
      {open && (
        <Alert role="region" aria-label="Keyboard diagnostics">
          <AlertTitle>Keyboard diagnostics</AlertTitle>
          <AlertDescription>
            <p>Tap the composer, then copy this report or take a screenshot. No message text is recorded or uploaded.</p>
            {/* No shadcn primitive for plain diagnostic output; bounded height avoids moving the composer as events arrive. */}
            <pre className="h-48 w-full overflow-auto whitespace-pre-wrap break-words">{report}</pre>
            <Button type="button" variant="outline" className="h-11" onClick={async () => {
              try { await navigator.clipboard.writeText(report); setCopyStatus("Copied"); }
              catch { setCopyStatus("Copy unavailable — take a screenshot instead."); }
            }}>Copy diagnostics</Button>
            {copyStatus && <p role="status">{copyStatus}</p>}
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
