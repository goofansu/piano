import { Dialog } from "radix-ui";
import { type CSSProperties, type ReactNode, type RefObject, useEffect, useState } from "react";
import { Sheet, SheetTitle } from "@/components/PianoSheet";
import { useSidebarLayout } from "@/lib/useSidebarLayout";

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
  const [restored, setRestored] = useState(open);
  if (restored && !open) setRestored(false);
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
          data-restored={restored || undefined}
          style={style}
          aria-describedby={undefined}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            if (!dragging) content.current?.focus({ preventScroll: true });
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            restoreFocus();
          }}
        >
          <SheetTitle className="sr-only">{title}</SheetTitle>
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
