import { Dialog } from "radix-ui";
import { type CSSProperties, type ReactNode, type RefObject, useEffect } from "react";
import { Sheet, SheetTitle } from "@/components/PianoSheet";

export function sidebarRevealStyle(progress: number, duration: number): CSSProperties {
  return {
    "--sidebar-progress": progress,
    "--sidebar-duration": `${duration}ms`,
  } as CSSProperties;
}

/** Sheet/Drawer move the navigation over the page. This reveal instead moves the live page.
 * Compose the same Radix modal primitive to retain focus trapping, Escape and nested overlays;
 * own its surface because shadcn SheetContent cannot expose a finger-driven partial scrim. */
export function PianoSidebarReveal({
  open,
  dragging,
  progress,
  settleDuration,
  onOpenChange,
  returnFocus,
  contentRef: content,
  title,
  children,
}: {
  open: boolean;
  dragging: boolean;
  progress: number;
  settleDuration: number;
  onOpenChange: (open: boolean) => void;
  returnFocus: RefObject<HTMLElement | null>;
  contentRef: RefObject<HTMLDivElement | null>;
  title: string;
  children: ReactNode;
}) {
  useEffect(() => {
    if (open && !dragging && !content.current?.contains(document.activeElement)) {
      content.current?.focus({ preventScroll: true });
    }
  }, [open, dragging, content]);
  return (
    <Sheet open={open || dragging} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Content
          ref={content}
          data-slot="mobile-sidebar"
          data-dragging={dragging}
          style={sidebarRevealStyle(progress, settleDuration)}
          aria-describedby={undefined}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            if (!dragging) content.current?.focus({ preventScroll: true });
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const target = returnFocus.current;
            returnFocus.current = null;
            const fallback = [
              ...document.querySelectorAll<HTMLElement>('button[aria-label="Show sidebar"]'),
            ].find((element) => element.checkVisibility({ visibilityProperty: true }));
            if (target?.isConnected && target.checkVisibility({ visibilityProperty: true }))
              target.focus({ preventScroll: true });
            else fallback?.focus({ preventScroll: true });
          }}
        >
          <SheetTitle className="sr-only">{title}</SheetTitle>
          {/* No standard surface reveals a stationary sidebar beneath a translated live page. */}
          <div data-slot="sidebar-reveal-navigation">{children}</div>
          <Dialog.Close asChild>
            <button type="button" data-slot="sidebar-scrim" aria-label="Dismiss sidebar" />
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Sheet>
  );
}
