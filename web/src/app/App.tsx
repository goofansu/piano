import { CommandPalette } from "@features/commands/web/browser";
import {
  AppLayout,
  ConnectionStatus,
  LayoutView,
  initialView,
  SidebarActivityContext,
  SidebarPaneLead,
  SidebarLayoutContext,
  useSidebarLayout,
  useSidebarLayoutController,
  useSidebarShortcut,
  useSidebarList,
  useSidebarSessionNavigation,
  useSidebarView,
  useNavigationController,
} from "@features/navigation/web/browser";
import { providerAccounts } from "@features/providers/web/browser";
import { pendingDialogs } from "@features/sessions/web";
import { DialogHost } from "@features/sessions/web/browser";
import { observeDictationPage, voiceInputSettings } from "@features/voice-input/web/browser";
import {
  checkoutRefresh,
  workspaceFile,
  SessionFilesContext,
  useSessionFilesController,
} from "@features/workspace/web/browser";
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { storedLastDirectory } from "@/app/client";
import { CommandHost } from "@/app/commands/CommandHost";
import { createPageStores } from "@/app/pageStores";
import { PageStoresProvider } from "@/app/PageStoresProvider";
import { NewSession } from "@/app/sessions/NewSession";
import { SessionView } from "@/app/sessions/SessionView";
import { SettingsNavigation, SettingsPage } from "@/app/SettingsPage";
import { useClient } from "@/app/useClient";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { PaneLeadContext, PaneNotFound } from "@/shared/components/Pane";
import { toastNotify as notify } from "@/shared/lib/toastNotify";
import { parseRoute } from "@/shared/navigation/routes";
import { NavigationContext } from "@/shared/navigation/useNavigation";
import { anySessionWorking } from "@/shared/state/sessionActivity";
import { type UnavailableSessionPage, unavailableSessionPage } from "@/shared/state/sessionCatalog";
import { type AppState, initialState } from "@/shared/state/state";
import { ProjectHomePage, ProjectsPage } from "./ProjectPages";
import { SessionSidebar } from "./SessionSidebar";

const stores = createPageStores(notify);

export default function App() {
  const layout = useSidebarLayoutController();
  return (
    <SidebarLayoutContext.Provider value={layout}>
      <PaneLeadContext value={<SidebarPaneLead />}>
        <PageStoresProvider value={stores}>
          <PianoApp />
        </PageStoresProvider>
      </PaneLeadContext>
    </SidebarLayoutContext.Provider>
  );
}

function PianoApp() {
  const { catalogs: modelCatalogs, drafts, questions: questionReplies } = stores;
  useEffect(observeDictationPage, []);
  const { state, client } = useClient(
    (): AppState => ({
      ...initialState,
      catalogs: { ...modelCatalogs.seed() },
      view: initialView(parseRoute(location)),
    }),
    notify,
    { lastDirectory: storedLastDirectory() },
  );
  const { dispatch, send } = client;
  const wasReconnecting = useRef(false);
  useEffect(() => {
    if (state.connected && wasReconnecting.current) void voiceInputSettings.refresh();
    wasReconnecting.current = state.reconnecting;
  }, [state.connected, state.reconnecting]);
  useEffect(() => providerAccounts.follow(client), [client]);
  useEffect(() => modelCatalogs.follow(client), [client, modelCatalogs]);
  useEffect(() => checkoutRefresh.follow(client), [client]);
  useEffect(() => drafts.follow(client, notify), [client, drafts]);
  useEffect(() => questionReplies.follow(client), [client, questionReplies]);
  const layout = useSidebarLayout();
  useSidebarShortcut();
  const sessionFiles = useSessionFilesController(state);

  const navigation = useNavigationController(client, layout.closeMobile, workspaceFile);
  const { settings } = useSyncExternalStore(navigation.subscribe, navigation.getState);
  const { openNew, openSettings, closeSettings } = navigation;
  const { view: sidebarView } = useSidebarView();
  const sidebar = useSidebarList(state, sidebarView);
  useSidebarSessionNavigation(sidebar.list, client, navigation);

  const chooseDirectory = useCallback(
    (cwd: string) => dispatch({ type: "new_directory", cwd }),
    [dispatch],
  );
  const anyWorking = anySessionWorking(state);

  return (
    <SidebarActivityContext.Provider value={anyWorking}>
      <NavigationContext.Provider value={navigation}>
        <SessionFilesContext value={sessionFiles}>
          <CommandHost
            state={state}
            send={send}
            decideTrust={client.decideTrust}
            listen={client.listen}
          >
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
                  <SessionSidebar state={state} {...sidebar} />
                )
              }
              content={
                <>
                  {state.reconnecting && <ConnectionStatus />}
                  <LayoutView key={state.view.kind} active={!settings}>
                    {state.view.kind === "new" ? (
                      <NewSession
                        state={state}
                        client={client}
                        chooseDirectory={chooseDirectory}
                        onProjectChange={(id) => openNew(undefined, id)}
                      />
                    ) : state.view.kind === "projects" ? (
                      <ProjectsPage state={state} openProject={navigation.openProject} />
                    ) : state.view.kind === "project" ? (
                      <ProjectHomePage
                        state={state}
                        client={client}
                        chooseDirectory={chooseDirectory}
                        projectId={state.view.projectId}
                        select={navigation.select}
                        openProjects={navigation.openProjects}
                      />
                    ) : state.view.kind === "missing-session" ? (
                      <UnavailableSession
                        page={unavailableSessionPage(state.view.reason)}
                        openDataControls={() => openSettings("data-controls")}
                        openNew={() => openNew()}
                      />
                    ) : (
                      <SessionView state={state} send={send} />
                    )}
                  </LayoutView>
                  {settings && (
                    <LayoutView>
                      <SettingsPage section={settings} state={state} client={client} />
                    </LayoutView>
                  )}
                </>
              }
            >
              <Toaster position="top-right" visibleToasts={4} duration={4000} closeButton />
              <CommandPalette state={state} />
              <DialogHost pending={pendingDialogs(state)} send={send} />
            </AppLayout>
          </CommandHost>
        </SessionFilesContext>
      </NavigationContext.Provider>
    </SidebarActivityContext.Provider>
  );
}

function UnavailableSession({
  page,
  openDataControls,
  openNew,
}: {
  page: UnavailableSessionPage;
  openDataControls: () => void;
  openNew: () => void;
}) {
  return (
    <PaneNotFound
      title={page.title}
      description={page.description}
      action={
        page.action === "data-controls" ? (
          <Button variant="outline" onClick={openDataControls}>
            Data controls
          </Button>
        ) : (
          <Button variant="outline" onClick={openNew}>
            New session
          </Button>
        )
      }
    />
  );
}
