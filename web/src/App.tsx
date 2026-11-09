import { useCallback, useEffect, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { AppLayout, LayoutView } from "@/components/AppLayout";
import { CommandHost } from "@/components/CommandHost";
import { CommandPalette } from "@/components/CommandPalette";
import { DialogHost } from "@/components/DialogHost";
import { MachineHost } from "@/components/MachineHost";
import { NewSession } from "@/components/NewSession";
import { PaneNotFound } from "@/components/Pane";
import { ProjectHome } from "@/components/ProjectHome";
import { ProjectsIndex } from "@/components/ProjectsIndex";
import { RemoteSidebar } from "@/components/RemoteSidebar";
import { SessionView } from "@/components/SessionView";
import { SettingsNavigation, SettingsPage } from "@/components/SettingsPage";
import { SidebarActivityContext } from "@/components/ShowSidebarButton";
import { Sidebar } from "@/components/Sidebar";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { checkoutRefresh } from "@/lib/checkoutRefresh";
import type { NotifyLevel } from "@/lib/client";
import { machineLocation, machineSocketPath } from "@/lib/machine";
import { initialView } from "@/lib/navigation";
import { pendingDialogs } from "@/lib/piDialogs";
import { previewObservation } from "@/lib/previewObservation";
import { parseRoute } from "@/lib/routes";
import { useClient } from "@/lib/useClient";
import { useMachine } from "@/lib/useMachine";
import { NavigationContext, useNavigationController } from "@/lib/useNavigation";
import { providerAccounts } from "@/lib/useProviderAccounts";
import { SessionFilesContext, useSessionFilesController } from "@/lib/useSessionFiles";
import { SidebarLayoutContext, useSidebarLayoutController } from "@/lib/useSidebarLayout";
import { browserSocketEnvironment, openConnection } from "@/lib/ws";
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
  return (
    <MachineHost>
      <MachineApp />
    </MachineHost>
  );
}

function MachineApp() {
  const scope = useMachine()!;
  const { machine, catalogs: modelCatalogs, drafts, questions: questionReplies } = scope;
  const remote = machine.id !== "local";
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
    remote
      ? {
          connect: (handlers) =>
            openConnection(handlers, {
              ...browserSocketEnvironment,
              url: () =>
                `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}${machineSocketPath(machine.id)}`,
            }),
          lastDirectory: { read: () => null, write: () => {} },
        }
      : {},
  );
  const { dispatch, send } = client;
  useEffect(() => (remote ? undefined : providerAccounts.follow(client)), [client, remote]);
  useEffect(() => modelCatalogs.follow(client), [client, modelCatalogs]);
  useEffect(() => (remote ? undefined : checkoutRefresh.follow(client)), [client, remote]);
  useEffect(() => drafts.follow(client), [client, drafts]);
  useEffect(() => questionReplies.follow(client), [client, questionReplies]);
  useEffect(
    () => (remote ? undefined : previewObservation.follow(client, notify)),
    [client, remote],
  );
  const layout = useSidebarLayoutController();
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
    <SidebarLayoutContext.Provider value={layout}>
      <SidebarActivityContext.Provider value={anyWorking}>
        <NavigationContext.Provider value={navigation}>
          <SessionFilesContext value={sessionFiles}>
            <CommandHost state={state} send={send} listen={client.listen}>
              <AppLayout
                navigationTitle={settings ? "Settings navigation" : "Folders and sessions"}
                navigation={
                  remote ? (
                    <RemoteSidebar state={state} />
                  ) : settings ? (
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
                    <LayoutView key={state.view.kind} active={remote || !settings}>
                      {remote && state.view.kind !== "session" && state.view.kind !== "new" ? (
                        <PaneNotFound
                          title={
                            state.view.kind === "missing-session"
                              ? "Session not found"
                              : "Select a session"
                          }
                          description=""
                        />
                      ) : state.view.kind === "new" ? (
                        <NewSession
                          state={state}
                          client={client}
                          chooseDirectory={chooseDirectory}
                          onProjectChange={remote ? undefined : (id) => openNew(undefined, id)}
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
                          title="Session not found"
                          description="This session is not in Piano's database."
                          action={
                            <Button variant="outline" onClick={() => openNew()}>
                              New session
                            </Button>
                          }
                        />
                      ) : (
                        <SessionView state={state} send={send} />
                      )}
                    </LayoutView>
                    {!remote && settings && (
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
    </SidebarLayoutContext.Provider>
  );
}
