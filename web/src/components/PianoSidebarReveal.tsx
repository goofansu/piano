import { Dialog } from "@base-ui/react/dialog";
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
    <Sheet
      open={open || dragging}
      onOpenChange={(next) => onOpenChange(next)}
      onOpenChangeComplete={(next) => {
        if (!next) restoreFocus();
      }}
    >
      <Dialog.Portal>
        <Dialog.Popup
          ref={content}
          data-slot="mobile-sidebar"
          data-motion="drawer"
          data-dragging={dragging}
          data-restored={restored || undefined}
          style={style}
          initialFocus={() => !dragging && content.current}
          finalFocus={false}
        >
          <SheetTitle className="sr-only">{title}</SheetTitle>
          <div data-slot="sidebar-reveal-navigation" data-motion="drawer">
            {children}
          </div>
          <Dialog.Close
            render={
              <button
                type="button"
                data-slot="sidebar-scrim"
                data-motion="drawer"
                aria-label="Dismiss sidebar"
              />
            }
          />
        </Dialog.Popup>
      </Dialog.Portal>
    </Sheet>
  );
}
