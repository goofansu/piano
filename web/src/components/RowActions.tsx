import { cn } from "cn";
import { MoreHorizontalIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { PianoButton } from "@/components/PianoButton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/PianoDropdownMenu";
import { settingsRow } from "@/components/SettingsSectionFrame";
import { StatusDot } from "@/components/StatusDot";
import { Item, ItemActions, ItemContent, ItemTitle } from "@/components/ui/item";

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
 * they stay in the row's flow. No shadcn primitive overlays a row's end. A list row is `ListRow`,
 * which decides all of this itself; a sidebar row places its own.
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

/** What opens the row's thing when its name is clicked: the name becomes a button over the row. */
export type RowOpen = {
  onOpen: () => void;
  disabled?: boolean;
  /** The button's `title`, for why it is disabled. */
  hint?: string;
  className?: string;
};

/**
 * One row of a `SettingsList` (a Settings list, the Projects index, a project's sessions): media,
 * a title, the lines under it, an optional time at its end and its actions. It decides every
 * reveal fact `index.css` reads, so no caller repeats them:
 *
 * - `menu` alone is revealed over the row's end (`RowActions`, `reveal`): the row carries
 *   `data-row` and `--row-actions` for one list-size button, the ⋯ ends on the row's padding where
 *   an in-flow action ends (an outline Sign in, a menu beside Reconnect), the `time` steps aside
 *   (`aside`) and the content fades beneath them (`yield`), so no text runs under the ⋯ unmasked.
 *   Only text steps aside: a control there would sit beneath the revealed ⋯'s hit target.
 * - With `actions` (a call to action such as Install or Reconnect, or a control such as a switch),
 *   `menu` stays beside them in the row's flow and nothing is revealed.
 * - `open` makes the title a button whose hit area (`::after`) stretches over the row (no row
 *   primitive opens on click beside a menu). A mask clips what its element paints and hit-tests to
 *   the element's box, so the content's `yield` mask would shrink that area to the content and cut
 *   a ring drawn on it: the content's mask is `no-clip`, and the focus ring is the row's, drawn on
 *   the `Item`.
 */
export function ListRow({
  media,
  title,
  titleId,
  titleClassName,
  open,
  badge,
  children,
  time,
  menu,
  actions,
  className,
  ...item
}: Omit<ComponentProps<typeof Item>, "title"> & {
  media?: ReactNode;
  title: ReactNode;
  titleId?: string;
  titleClassName?: string;
  open?: RowOpen;
  /** After the title, on its line. */
  badge?: ReactNode;
  /** The lines under the title. */
  children?: ReactNode;
  /** When the row last changed, at its end: `at` is the ISO time, `text` what the row reads. */
  time?: { at: string; text: string };
  /** The ⋯ trigger, usually `RowMenu`. */
  menu?: ReactNode;
  actions?: ReactNode;
}) {
  const revealed = !!menu && !actions;
  return (
    <Item
      data-row
      role="listitem"
      className={cn(
        settingsRow,
        "relative",
        rowActionsWidth.list[revealed ? 1 : 0],
        open &&
          "hover:bg-fill-hover has-[[data-row-open]:focus-visible]:ring-2 has-[[data-row-open]:focus-visible]:ring-ring has-[[data-row-open]:focus-visible]:ring-inset",
        className,
      )}
      {...item}
    >
      {media}
      <ItemContent
        data-motion={revealed ? "yield" : undefined}
        className={cn("min-w-0 gap-0.5", open && "[mask-clip:no-clip]")}
      >
        <ItemTitle id={titleId} className={cn(open && "w-full min-w-0", titleClassName)}>
          {open ? (
            <button
              type="button"
              data-row-open
              className={cn(
                "min-w-0 truncate text-left outline-none after:absolute after:inset-0",
                !badge && "flex-1",
                open.className,
              )}
              disabled={open.disabled}
              title={open.hint}
              onClick={open.onOpen}
            >
              {title}
            </button>
          ) : (
            title
          )}
          {badge}
        </ItemTitle>
        {children}
      </ItemContent>
      {time && (
        <ItemActions data-motion={revealed ? "aside" : undefined} className="shrink-0">
          <time dateTime={time.at} className="text-xs text-ink-3">
            {time.text}
          </time>
        </ItemActions>
      )}
      {actions ? (
        <ItemActions className="shrink-0 gap-1">
          {actions}
          {menu}
        </ItemActions>
      ) : (
        menu && <RowActions className="top-1/2 right-4 -translate-y-1/2">{menu}</RowActions>
      )}
    </Item>
  );
}

/** A list row's ⋯: a ghost list-size button opening its menu, aligned to the button's end. */
export function RowMenu({
  label,
  disabled,
  children,
}: {
  label: string;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <PianoButton variant="ghost" size="list" aria-label={label} disabled={disabled}>
          <MoreHorizontalIcon />
        </PianoButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">{children}</DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A state on a row's line: `StatusDot` beside its word ("Signed in", "Ready"). */
export function RowStatus({
  tone = "ok",
  children,
  ...props
}: ComponentProps<"p"> & { tone?: ComponentProps<typeof StatusDot>["tone"] }) {
  return (
    <p className="flex items-center gap-1.5 text-xs text-ink-3" {...props}>
      <StatusDot tone={tone} />
      {children}
    </p>
  );
}
