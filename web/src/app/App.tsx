import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { storedLastDirectory } from "@/app/client";
import { createPageStores } from "@/app/pageStores";
import { type AppState, initialState } from "@/app/store";
import { toastNotify as notify } from "@/app/toastNotify";
import { useClient } from "@/app/useClient";
import { PageStoresContext } from "@/app/usePageStores";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { CommandHost } from "@/features/commands/CommandHost";
import { CommandPalette } from "@/features/commands/CommandPalette";
import { AppLayout, LayoutView } from "@/features/navigation/AppLayout";
import { initialView } from "@/features/navigation/navigation";
import { parseRoute } from "@/features/navigation/routes";
import {
  SidebarActivityContext,
  SidebarPaneLead,
} from "@/features/navigation/sidebar/ShowSidebarButton";
import { Sidebar } from "@/features/navigation/sidebar/Sidebar";
import {
  SidebarLayoutContext,
  useSidebarLayout,
  useSidebarLayoutController,
  useSidebarShortcut,
} from "@/features/navigation/sidebar/useSidebarLayout";
import { useSidebarList } from "@/features/navigation/sidebar/useSidebarList";
import { useSidebarSessionNavigation } from "@/features/navigation/sidebar/useSidebarSessionNavigation";
import { useSidebarView } from "@/features/navigation/sidebar/useSidebarView";
import { NavigationContext, useNavigationController } from "@/features/navigation/useNavigation";
import { ProjectHome } from "@/features/projects/ProjectHome";
import { projectRowActions } from "@/features/projects/Projects";
import { ProjectsIndex } from "@/features/projects/ProjectsIndex";
import { providerAccounts } from "@/features/providers/useProviderAccounts";
import { DialogHost } from "@/features/sessions/dialogs/DialogHost";
import { pendingDialogs } from "@/features/sessions/dialogs/piDialogs";
import {
  anySessionWorking,
  type UnavailableSessionPage,
  unavailableSessionPage,
} from "@/features/sessions/sessionCatalog";
import { SessionView } from "@/features/sessions/SessionView";
import { NewSession } from "@/features/sessions/start/NewSession";
import { SettingsNavigation, SettingsPage } from "@/features/settings/SettingsPage";
import { observeDictationPage } from "@/features/voice-input/browserDictation";
import { voiceInputSettings } from "@/features/voice-input/useVoiceInput";
import { checkoutRefresh } from "@/features/workspace/changes/checkoutRefresh";
import {
  SessionFilesContext,
  useSessionFilesController,
} from "@/features/workspace/files/useSessionFiles";
import { PaneLeadContext, PaneNotFound } from "@/shared/components/Pane";

const stores = createPageStores(notify);

export default function App() {
  const layout = useSidebarLayoutController();
  return (
    <SidebarLayoutContext.Provider value={layout}>
      <PaneLeadContext value={<SidebarPaneLead />}>
        <PageStoresContext value={stores}>
          <PianoApp />
        </PageStoresContext>
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

  const navigation = useNavigationController(client, layout.closeMobile);
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
                  <Sidebar state={state} {...sidebar} projectActions={projectRowActions} />
                )
              }
              content={
                <>
                  <LayoutView key={state.view.kind} active={!settings}>
                    {state.view.kind === "new" ? (
                      <NewSession
                        state={state}
                        client={client}
                        chooseDirectory={chooseDirectory}
                        onProjectChange={(id) => openNew(undefined, id)}
                      />
                    ) : state.view.kind === "projects" ? (
                      <ProjectsIndex state={state} openProject={navigation.openProject} />
                    ) : state.view.kind === "project" ? (
                      <ProjectHome
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
