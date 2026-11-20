import { useCallback, useEffect, useSyncExternalStore } from "react";
import { AppLayout, LayoutView } from "@/components/AppLayout";
import { CommandHost } from "@/components/CommandHost";
import { CommandPalette } from "@/components/CommandPalette";
import { DialogHost } from "@/components/DialogHost";
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
import { observeDictationPage } from "@/lib/browserDictation";
import { checkoutRefresh } from "@/lib/checkoutRefresh";
import { storedLastDirectory } from "@/lib/client";
import { initialView } from "@/lib/navigation";
import { createPageStores } from "@/lib/pageStores";
import { pendingDialogs } from "@/lib/piDialogs";
import { parseRoute } from "@/lib/routes";
import {
  anySessionWorking,
  type UnavailableSessionPage,
  unavailableSessionPage,
} from "@/lib/sessionCatalog";
import { toastNotify as notify } from "@/lib/toastNotify";
import { useClient } from "@/lib/useClient";
import { NavigationContext, useNavigationController } from "@/lib/useNavigation";
import { PageStoresContext } from "@/lib/usePageStores";
import { providerAccounts } from "@/lib/useProviderAccounts";
import { SessionFilesContext, useSessionFilesController } from "@/lib/useSessionFiles";
import {
  SidebarLayoutContext,
  useSidebarLayout,
  useSidebarLayoutController,
  useSidebarShortcut,
} from "@/lib/useSidebarLayout";
import { useSidebarList } from "@/lib/useSidebarList";
import { useSidebarSessionNavigation } from "@/lib/useSidebarSessionNavigation";
import { useSidebarView } from "@/lib/useSidebarView";
import { type AppState, initialState } from "@/store";

const stores = createPageStores(notify);

export default function App() {
  const layout = useSidebarLayoutController();
  return (
    <SidebarLayoutContext.Provider value={layout}>
      <PageStoresContext value={stores}>
        <PianoApp />
      </PageStoresContext>
    </SidebarLayoutContext.Provider>
  );
}

function PianoApp() {
  const { catalogs: modelCatalogs, drafts, questions: questionReplies, previews } = stores;
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
  useEffect(() => providerAccounts.follow(client), [client]);
  useEffect(() => modelCatalogs.follow(client), [client, modelCatalogs]);
  useEffect(() => checkoutRefresh.follow(client), [client]);
  useEffect(() => drafts.follow(client, notify), [client, drafts]);
  useEffect(() => questionReplies.follow(client), [client, questionReplies]);
  useEffect(() => previews.follow(client, notify), [client, previews]);
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
                  <Sidebar state={state} {...sidebar} />
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
                      <ProjectsIndex state={state} />
                    ) : state.view.kind === "project" ? (
                      <ProjectHome
                        state={state}
                        client={client}
                        chooseDirectory={chooseDirectory}
                        projectId={state.view.projectId}
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
