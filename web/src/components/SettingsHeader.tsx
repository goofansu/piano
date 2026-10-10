import { ChevronLeftIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

/** The settings pane's top bar, matching the session header so both panes share one edge. */
export function SettingsHeader({ title, titleId, onMenu, children }: { title: string; titleId: string; onMenu: () => void; children?: React.ReactNode }) {
  return <header className="flex min-h-16 shrink-0 items-center gap-3 border-b border-line px-4 py-3 md:px-6">
    <Button variant="ghost" size="icon-sm" className="-ml-2 md:hidden" aria-label="Settings" onClick={onMenu}><ChevronLeftIcon /></Button>
    <h1 id={titleId} className="voice min-w-0 flex-1 truncate text-xl font-medium">{title}</h1>
    {children}
  </header>;
}
