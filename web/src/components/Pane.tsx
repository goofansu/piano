/**
 * The main pane's chrome, shared by every page in it (a session, the New page, the Projects index,
 * a project's home, Settings): the header row, the scrolling page body, and the page shown when
 * the address names nothing. Each carries the Show sidebar control, so no page can be left without
 * a way back to the sidebar once it is collapsed or below the breakpoint.
 */
import { ShowSidebarButton } from "@/components/ShowSidebarButton";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";

/**
 * The pane's header: Show sidebar, the title block, then the controls at the end. Every pane's
 * header shares this height and edge. The title block takes the free width itself (`flex-1`);
 * a header whose controls are laid out with its title passes them among `children` instead.
 */
export function PaneHeader({
  children,
  actions,
}: {
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    // No shadcn component is a page header; this row is Piano's own.
    <header className="flex h-16 shrink-0 items-center gap-3 border-b border-line px-4 py-2 md:px-(--gutter)">
      <ShowSidebarButton className="-ml-2" />
      {children}
      {actions}
    </header>
  );
}

/** A title with a line of context beneath it, as a header's title block. */
export function PaneHeading({ children }: { children: React.ReactNode }) {
  return <div className="flex min-w-0 flex-1 flex-col gap-1">{children}</div>;
}

/** The page beneath a header: a scrolling column that clears the home indicator. */
export function PaneBody({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] md:px-6 md:py-8">
      {children}
    </div>
  );
}

/** Show sidebar for a page without a header, where the header's control would be. */
export function PaneShowSidebar() {
  return (
    <ShowSidebarButton className="absolute top-[calc(var(--gutter)-0.5rem)] left-[calc(var(--gutter)-0.5rem)]" />
  );
}

/** The page for an address that names nothing Piano knows: what is missing, one line, and a way on. */
export function PaneNotFound({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <>
      <PaneShowSidebar />
      <Empty className="flex-1 px-4" role="alert">
        <EmptyHeader>
          <EmptyTitle>{title}</EmptyTitle>
          <EmptyDescription>{description}</EmptyDescription>
        </EmptyHeader>
        {action && <EmptyContent>{action}</EmptyContent>}
      </Empty>
    </>
  );
}
