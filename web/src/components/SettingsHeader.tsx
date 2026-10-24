import { ShowSidebarButton } from "@/components/ShowSidebarButton";

/** The settings pane's top bar: the session header's height and type, so every pane shares one edge and one title. */
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
    <header className="flex h-16 shrink-0 items-center gap-3 border-b border-line px-4 py-2 md:px-(--gutter)">
      {/* The sidebar holds the Settings sections; this is the one show control every pane has. */}
      <ShowSidebarButton className="-ml-2" />
      <h1 id={titleId} className="min-w-0 flex-1 truncate text-sm font-medium">
        {title}
      </h1>
      {children}
    </header>
  );
}
