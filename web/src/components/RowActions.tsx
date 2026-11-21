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

export const rowActionsWidth = {
  row: { 0: "", 1: "[--row-actions:1.75rem]", 2: "[--row-actions:3.5rem]" },
  list: { 0: "", 1: "[--row-actions:2.25rem]" },
} as const;

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

export type RowOpen = {
  onOpen: () => void;
  disabled?: boolean;
  hint?: string;
  className?: string;
};

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
  badge?: ReactNode;
  children?: ReactNode;
  time?: { at: string; text: string };
  menu?: ReactNode;
  actions?: ReactNode;
}) {
  const revealed = !!menu && !actions;
  return (
    <Item
      data-row
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
      <DropdownMenuTrigger
        render={<PianoButton variant="ghost" size="list" aria-label={label} disabled={disabled} />}
      >
        <MoreHorizontalIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">{children}</DropdownMenuContent>
    </DropdownMenu>
  );
}

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
