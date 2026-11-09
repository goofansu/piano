import { SearchIcon } from "lucide-react";
import { LayoutHeader } from "@/components/AppLayout";
import { IconButton } from "@/components/IconButton";
import { MachineSwitcher } from "@/components/MachineSwitcher";
import { SidebarSessionList } from "@/components/SidebarSessionList";
import { Empty, EmptyHeader, EmptyDescription } from "@/components/ui/empty";
import { ScrollArea } from "@/components/ui/scroll-area";
import { recentSessions } from "@/lib/sessionCatalog";
import { useNavigation } from "@/lib/useNavigation";
import type { AppState } from "@/store";

/** Remote's complete listed catalog, not folders/projects or terminal-history discovery. */
export function RemoteSidebar({ state }: { state: AppState }) {
  const { select, setPalette } = useNavigation();
  const sessions = recentSessions(state);
  return (
    <div data-slot="session-sidebar" className="flex h-full flex-col">
      <LayoutHeader>
        <MachineSwitcher />
        <IconButton
          size="header"
          label="Search sessions and commands"
          onClick={() => setPalette(true)}
        >
          <SearchIcon />
        </IconButton>
      </LayoutHeader>
      <ScrollArea className="min-h-0 flex-1">
        <nav className="relative px-(--row-inset) py-2" aria-label="Sessions">
          <SidebarSessionList sessions={sessions} select={select} details="folder-and-branch" />
          {!sessions.length && (
            <Empty className="py-8">
              <EmptyHeader>
                <EmptyDescription>
                  {state.connected ? "No sessions yet" : "Machine unavailable"}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </nav>
      </ScrollArea>
    </div>
  );
}
