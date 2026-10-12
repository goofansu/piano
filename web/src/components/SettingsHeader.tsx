import { ChevronLeftIcon } from "lucide-react";
import { ShowSidebarButton } from "@/components/ShowSidebarButton";

/** The settings pane's top bar, matching the session header so both panes share one edge. */
export function SettingsHeader({
  title,
  titleId,
  children,
}: {
  title: string;
  titleId: string;
  children?: React.ReactNode;
}) {
  return (
    <header className="flex min-h-16 shrink-0 items-center gap-3 border-b border-line px-4 py-3 md:px-6">
      {/* Below the breakpoint the sidebar holds the Settings sections, so this leads back to them. */}
      <ShowSidebarButton className="-ml-2" label="Settings">
        <ChevronLeftIcon />
      </ShowSidebarButton>
      <h1 id={titleId} className="min-w-0 flex-1 truncate text-lg font-semibold tracking-tight">
        {title}
      </h1>
      {children}
    </header>
  );
}
