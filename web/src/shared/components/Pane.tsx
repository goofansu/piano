import { cn } from "cn";
import { createContext, useContext } from "react";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";

export const paneHeaderRow =
  "flex h-12 shrink-0 items-center gap-3 border-b border-line px-(--gutter) py-0";

export function HeaderLead({ toggle, className }: { toggle: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "-ml-(--glyph-pad) flex shrink-0 items-center gap-1 [&>:only-child]:-mr-2",
        className,
      )}
    >
      {toggle}
    </div>
  );
}

export const PaneLeadContext = createContext<React.ReactNode>(null);

export function PaneHeader({
  children,
  actions,
}: {
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header className={paneHeaderRow}>
      {useContext(PaneLeadContext)}
      {children}
      {actions}
    </header>
  );
}

export function PaneHeading({ children }: { children: React.ReactNode }) {
  return <div className="flex min-w-0 flex-1 flex-col gap-1">{children}</div>;
}

export function PaneBody({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-(--gutter) py-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] md:py-8">
      {children}
    </div>
  );
}

export function PaneShowSidebar() {
  return (
    <div
      className={cn(
        paneHeaderRow,
        "pointer-events-none absolute inset-x-0 top-0 border-transparent [&>*]:pointer-events-auto",
      )}
    >
      {useContext(PaneLeadContext)}
    </div>
  );
}

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
