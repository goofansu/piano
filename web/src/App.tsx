import { useCallback, useEffect, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { AppLayout, LayoutView } from "@/components/AppLayout";
import { CommandHost } from "@/components/CommandHost";
import { CommandPalette } from "@/components/CommandPalette";
import { DialogHost } from "@/components/DialogHost";
import { NewSession } from "@/components/NewSession";
import { ProjectHome } from "@/components/ProjectHome";
import { ProjectsIndex } from "@/components/ProjectsIndex";
import { SessionPanel } from "@/components/SessionPanel";
import { SessionView } from "@/components/SessionView";
import { SettingsNavigation, SettingsPage } from "@/components/SettingsPage";
import { SidebarActivityContext } from "@/components/ShowSidebarButton";
import { Sidebar } from "@/components/Sidebar";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Toaster } from "@/components/ui/sonner";
import { checkoutRefresh } from "@/lib/checkoutRefresh";
import type { NotifyLevel } from "@/lib/client";
import { drafts } from "@/lib/messageDraft";
import { initialView } from "@/lib/navigation";
import { pendingDialogs } from "@/lib/piDialogs";
import { previewObservation } from "@/lib/previewObservation";
import { parseRoute } from "@/lib/routes";
import { useClient } from "@/lib/useClient";
import { modelCatalogs } from "@/lib/useModelCatalog";
import { NavigationContext, useNavigationController } from "@/lib/useNavigation";
import { providerAccounts } from "@/lib/useProviderAccounts";
import { SessionFilesContext, useSessionFilesController } from "@/lib/useSessionFiles";
import { SidebarLayoutContext, useSidebarLayoutController } from "@/lib/useSidebarLayout";
import { type AppState, initialState } from "@/store";

const notify = (message: string, level?: NotifyLevel) =>
  level === "success"
    ? toast.success(message)
    : level === "info"
      ? toast.info(message)
      : level === "warning"
        ? toast.warning(message)
        : level === "error"
          ? toast.error(message)
          : toast(message);

export default function App() {
  const { state, client } = useClient((): AppState => {
    // Stored catalogs let the model picker open before Pi answers.
    const catalogs = { ...modelCatalogs.seed() };
    return { ...initialState, catalogs, view: initialView(parseRoute(location)) };
  }, notify);
  const { dispatch, send } = client;
  useEffect(() => providerAccounts.follow(client), [client]);
  useEffect(() => modelCatalogs.follow(client), [client]);
  useEffect(() => checkoutRefresh.follow(client), [client]);
  useEffect(() => drafts.follow(client), [client]);
  useEffect(() => previewObservation.follow(client, notify), [client]);
  const layout = useSidebarLayoutController();
  // The composer's Files popover and the palette's Files group read this one answer.
  const sessionFiles = useSessionFilesController(state);

  const navigation = useNavigationController(client, layout.closeMobile);
  const { settings, settingsRequest } = useSyncExternalStore(
    navigation.subscribe,
    navigation.getState,
  );
  const { openNew, openSettings, closeSettings } = navigation;

  const chooseDirectory = useCallback(
    (cwd: string) => dispatch({ type: "new_directory", cwd }),
    [dispatch],
  );
  const anyWorking = state.hosts.some((h) => h.streaming);

  return (
    <SidebarLayoutContext.Provider value={layout}>
      <SidebarActivityContext.Provider value={anyWorking}>
        <NavigationContext.Provider value={navigation}>
          <SessionFilesContext value={sessionFiles}>
            <CommandHost state={state} send={send}>
              <AppLayout
                navigationTitle={settings ? "Settings navigation" : "Folders and sessions"}
                navigation={
                  settings ? (
                    <SettingsNavigation
                      section={settings}
                      onSelect={openSettings}
                      onHome={closeSettings}
                    />
                  ) : (
                    <Sidebar state={state} />
                  )
                }
                content={
                  <>
                    {/* Opening settings keeps the current view mounted for session continuity (INV-02). */}
                    <LayoutView key={state.view.kind} active={!settings}>
                      {state.view.kind === "new" ? (
                        <NewSession
                          state={state}
                          client={client}
                          chooseDirectory={chooseDirectory}
                          onProjectChange={(id) => openNew(undefined, id)}
                        />
                      ) : state.view.kind === "projects" ? (
                        <ProjectsIndex state={state} />
                      ) : state.view.kind === "project" ? (
                        <ProjectHome
                          state={state}
                          client={client}
                          chooseDirectory={chooseDirectory}
                          projectId={state.view.projectId}
                        />
                      ) : state.view.kind === "missing-session" ? (
                        <Empty className="flex-1 px-4" role="alert">
                          <EmptyHeader>
                            <EmptyTitle>Session not found</EmptyTitle>
                            <EmptyDescription>
                              This session is not in the registry. Its reference may have been
                              removed or deleted.
                            </EmptyDescription>
                          </EmptyHeader>
                          <EmptyContent>
                            <Button variant="outline" onClick={() => openNew()}>
                              New session
                            </Button>
                          </EmptyContent>
                        </Empty>
                      ) : (
                        <SessionView state={state} send={send} />
                      )}
                    </LayoutView>
                    {settings && (
                      <LayoutView>
                        <SettingsPage section={settings} request={settingsRequest} />
                      </LayoutView>
                    )}
                  </>
                }
                aside={<SessionPanel state={state} />}
              >
                {/* Top-right, just below the pane's header row, so a toast never covers a title or its controls.
          Above dialogs and sheets (z-50) but below menus, popovers and tooltips (z-[60]), so an open menu is never covered. */}
                <Toaster
                  position="top-right"
                  className="toaster group !absolute !z-[55]"
                  offset={{ top: 88, right: 24 }}
                  mobileOffset={{ top: 68, left: 16, right: 16 }}
                  visibleToasts={4}
                  duration={4000}
                  closeButton
                />
                <CommandPalette state={state} />
                <DialogHost pending={pendingDialogs(state)} send={send} />
              </AppLayout>
            </CommandHost>
          </SessionFilesContext>
        </NavigationContext.Provider>
      </SidebarActivityContext.Provider>
    </SidebarLayoutContext.Provider>
  );
}
