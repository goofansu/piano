import { Dialog } from "radix-ui";
import { type CSSProperties, type ReactNode, type RefObject, useEffect } from "react";
import { Sheet, SheetTitle } from "@/components/PianoSheet";
import { useSidebarLayout } from "@/lib/useSidebarLayout";

/** Sheet/Drawer move the navigation over the page. This reveal instead moves the live page.
 * Compose the same Radix modal primitive to retain focus trapping, Escape and nested overlays;
 * own its surface because shadcn SheetContent cannot expose a finger-driven partial scrim. */
export function PianoSidebarReveal({
  open,
  dragging,
  style,
  onOpenChange,
  contentRef: content,
  title,
  children,
}: {
  open: boolean;
  dragging: boolean;
  style: CSSProperties;
  onOpenChange: (open: boolean) => void;
  contentRef: RefObject<HTMLDivElement | null>;
  title: string;
  children: ReactNode;
}) {
  const { restoreFocus } = useSidebarLayout();
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
          data-motion="drawer"
          data-dragging={dragging}
          style={style}
          aria-describedby={undefined}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            if (!dragging) content.current?.focus({ preventScroll: true });
          }}
          onCloseAutoFocus={(event) => {
            // The layout knows what had focus before the sheet opened, and which control to fall back to.
            event.preventDefault();
            restoreFocus();
          }}
        >
          <SheetTitle className="sr-only">{title}</SheetTitle>
          {/* No standard surface reveals a stationary sidebar beneath a translated live page. */}
          <div data-slot="sidebar-reveal-navigation" data-motion="drawer">
            {children}
          </div>
          <Dialog.Close asChild>
            <button
              type="button"
              data-slot="sidebar-scrim"
              data-motion="drawer"
              aria-label="Dismiss sidebar"
            />
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Sheet>
  );
}
