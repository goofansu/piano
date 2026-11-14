import { useCallback, useEffect, useSyncExternalStore } from "react";
import { AppLayout, LayoutView } from "@/components/AppLayout";
import { CommandHost } from "@/components/CommandHost";
import { CommandPalette } from "@/components/CommandPalette";
import { DialogHost } from "@/components/DialogHost";
import { MachineHost } from "@/components/MachineHost";
import { NewSession } from "@/components/NewSession";
import { PaneNotFound } from "@/components/Pane";
import { ProjectHome } from "@/components/ProjectHome";
import { ProjectsIndex } from "@/components/ProjectsIndex";
import { SessionView } from "@/components/SessionView";
import { SettingsNavigation, SettingsPage } from "@/components/SettingsPage";
import { SidebarActivityContext } from "@/components/ShowSidebarButton";
import { Sidebar } from "@/components/Sidebar";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { checkoutRefresh } from "@/lib/checkoutRefresh";
import { storedLastDirectory } from "@/lib/client";
import { machineFrameBytes, machineLocation, machineSocketUrl } from "@/lib/machine";
import { initialView } from "@/lib/navigation";
import { pendingDialogs } from "@/lib/piDialogs";
import { parseRoute } from "@/lib/routes";
import { HISTORY_UNAVAILABLE } from "@/lib/sessionCatalog";
import { toastNotify as notify } from "@/lib/toastNotify";
import { useClient } from "@/lib/useClient";
import { useMachineScope, useOffers, usePreviews } from "@/lib/useMachine";
import { NavigationContext, useNavigationController } from "@/lib/useNavigation";
import { providerAccounts } from "@/lib/useProviderAccounts";
import { SessionFilesContext, useSessionFilesController } from "@/lib/useSessionFiles";
import {
  SidebarLayoutContext,
  useSidebarLayout,
  useSidebarLayoutController,
  useSidebarShortcut,
} from "@/lib/useSidebarLayout";
import { browserSocketEnvironment, type ConnectionHandlers, openConnection } from "@/lib/ws";
import { type AppState, initialState } from "@/store";

export default function App() {
  // Layout belongs to the browser, outside the keyed machine-local state and connections.
  const layout = useSidebarLayoutController();
  return (
    <SidebarLayoutContext.Provider value={layout}>
      <MachineHost>
        <MachineApp />
      </MachineHost>
    </SidebarLayoutContext.Provider>
  );
}

function MachineApp() {
  const scope = useMachineScope();
  const { machine, catalogs: modelCatalogs, drafts, questions: questionReplies } = scope;
  const offers = useOffers();
  const previews = usePreviews();
  const { state, client } = useClient(
    (): AppState => {
      // Stored catalogs let the model picker open before Pi answers.
      const catalogs = { ...modelCatalogs.seed() };
      return {
        ...initialState,
        catalogs,
        view: initialView(parseRoute(machineLocation(location.pathname))),
      };
    },
    notify,
    {
      // Each machine's socket has its own address and its own largest frame.
      connect: (handlers: ConnectionHandlers) =>
        openConnection(handlers, {
          ...browserSocketEnvironment,
          url: () => machineSocketUrl(machine.id),
          frameBytes: machineFrameBytes(machine.id),
        }),
      // Each machine remembers its own last directory and decides where a session may start.
      lastDirectory: storedLastDirectory(machine.id),
      startsSessionIn: offers.startsSessionIn,
    },
  );
  const { dispatch, send } = client;
  useEffect(
    () => (offers.providerAccounts ? providerAccounts.follow(client) : undefined),
    [client, offers],
  );
  useEffect(() => modelCatalogs.follow(client), [client, modelCatalogs]);
  useEffect(
    () => (offers.worktrees ? checkoutRefresh.follow(client) : undefined),
    [client, offers],
  );
  useEffect(() => drafts.follow(client), [client, drafts]);
  useEffect(() => questionReplies.follow(client), [client, questionReplies]);
  useEffect(() => previews?.follow(client, notify), [client, previews]);
  const layout = useSidebarLayout();
  useSidebarShortcut();
  // Details' Outputs reads this one answer, filtered by Git once per change.
  const sessionFiles = useSessionFilesController(state);

  const navigation = useNavigationController(client, layout.closeMobile);
  const { settings } = useSyncExternalStore(navigation.subscribe, navigation.getState);
  const { openNew, openSettings, closeSettings } = navigation;

  const chooseDirectory = useCallback(
    (cwd: string) => dispatch({ type: "new_directory", cwd }),
    [dispatch],
  );
  const anyWorking = state.hosts.some((h) => h.working);

  return (
    <SidebarActivityContext.Provider value={anyWorking}>
      <NavigationContext.Provider value={navigation}>
        <SessionFilesContext value={sessionFiles}>
          <CommandHost state={state} send={send} listen={client.listen}>
            <AppLayout
              navigationTitle={settings ? "Settings navigation" : "Folders and sessions"}
              navigation={
                offers.settings && settings ? (
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
                  <LayoutView key={state.view.kind} active={!offers.settings || !settings}>
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
                      <PaneNotFound
                        {...(state.view.reason === "history"
                          ? HISTORY_UNAVAILABLE
                          : {
                              title: "Session not found",
                              description: "This session is not in Piano's database.",
                            })}
                        action={
                          <Button variant="outline" onClick={() => openNew()}>
                            New session
                          </Button>
                        }
                      />
                    ) : (
                      <SessionView state={state} send={send} captureSend={client.captureSend} />
                    )}
                  </LayoutView>
                  {offers.settings && settings && (
                    <LayoutView>
                      <SettingsPage section={settings} />
                    </LayoutView>
                  )}
                </>
              }
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
  );
}
