import { cn } from "cn";
import type { ReactNode } from "react";

/**
 * A row's `--row-actions` for its count of actions at their place (`PianoButton`), each with the
 * 4px gap before it: a sidebar row's are 24px, a list row's 32px. Touch screens keep the actions in
 * the row's flow, so only the pointer sizes count here.
 */
export const rowActionsWidth = {
  row: { 0: "", 1: "[--row-actions:1.75rem]", 2: "[--row-actions:3.5rem]" },
  list: { 0: "", 1: "[--row-actions:2.25rem]" },
} as const;

/**
 * A row's actions (its ⋯ menu, a New session button) over the row's end, shown while the row is
 * pointed at, holds keyboard focus or has its menu open; `index.css` (`data-row`, `reveal`) owns
 * when and how. The row is `relative`, carries `data-row` and sets `--row-actions` from
 * `rowActionsWidth`, which a covered title or a value beside them makes room for. On a touch screen
 * they stay in the row's flow. No shadcn primitive overlays a row's end.
 */
export function RowActions({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      data-motion="reveal"
      className={cn(
        "absolute z-10 flex items-center gap-1 pointer-coarse:static pointer-coarse:translate-y-0",
        className,
      )}
    >
      {children}
    </div>
  );
}
