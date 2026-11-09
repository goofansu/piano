import { SearchIcon } from "lucide-react";
import { LayoutHeader } from "@/components/AppLayout";
import { IconButton } from "@/components/IconButton";
import { MachineSwitcher } from "@/components/MachineSwitcher";
import { SidebarSessions, ViewMenu } from "@/components/Sidebar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useNavigation } from "@/lib/useNavigation";
import type { AppState } from "@/store";

/**
 * A remote's catalog in this browser's View options, listed as this machine's sidebar lists its
 * own. No New session, Projects or Settings: those manage the remote, which stays its own.
 */
export function RemoteSidebar({ state }: { state: AppState }) {
  const { setPalette } = useNavigation();
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
        <ViewMenu />
      </LayoutHeader>
      <ScrollArea className="min-h-0 flex-1">
        <nav className="relative px-(--row-inset) py-2" aria-label="Sessions">
          <SidebarSessions
            state={state}
            emptyText={state.connected ? "No sessions yet" : "Machine unavailable"}
            unavailable={state.connected ? undefined : "Machine unavailable"}
          />
        </nav>
      </ScrollArea>
    </div>
  );
}
