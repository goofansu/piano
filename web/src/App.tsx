import { isWorking } from "@shared/sessionProjection";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { AppLayout, LayoutView, useAppLayout } from "@/components/AppLayout";
import { CommandPalette } from "@/components/CommandPalette";
import { DialogHost } from "@/components/DialogHost";
import { NewSession } from "@/components/NewSession";
import { type ProjectDialog, ProjectDialogView } from "@/components/Projects";
import { SessionCommandHost } from "@/components/SessionCommandHost";
import { SessionView } from "@/components/SessionView";
import { SettingsNavigation, SettingsPage } from "@/components/SettingsPage";
import { Sidebar, SidebarRail } from "@/components/Sidebar";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Toaster } from "@/components/ui/sonner";
import type { NotifyLevel } from "@/lib/client";
import { initialView } from "@/lib/navigation";
import { parseRoute } from "@/lib/routes";
import { sessionReady, workspaceFor } from "@/lib/sessionContext";
import { readJson, writeJson } from "@/lib/storage";
import { useClient } from "@/lib/useClient";
import { NavigationContext, useNavigationController } from "@/lib/useNavigation";
import { useSessionPullRequest } from "@/lib/useSessionPullRequest";
import { type AppState, initialState } from "@/store";

/** Model catalogs outlive reloads so the picker opens at once; its refresh button re-probes Pi. */
const CATALOGS_KEY = "piano.catalogs";

const notify = (message: string, level?: NotifyLevel) =>
  level === "success" ? toast.success(message) : level === "info" ? toast.info(message) : level === "warning" ? toast.warning(message) : level === "error" ? toast.error(message) : toast(message);

export default function App() {
  const { state, client } = useClient((): AppState => {
    const seeded = { ...initialState, catalogs: readJson<AppState["catalogs"]>(CATALOGS_KEY, {}) };
    return { ...seeded, view: initialView(parseRoute(location)) };
  }, notify);
  const { dispatch, send } = client;
  useEffect(() => {
    // Without storage the server cache still answers.
    writeJson(CATALOGS_KEY, Object.fromEntries(Object.entries(state.catalogs).filter(([, c]) => !c.error)));
  }, [state.catalogs]);
  const layout = useAppLayout();
  const { closeMobile, show: showSidebar, toggle: toggleSidebar } = layout;

  const navigation = useNavigationController(client, closeMobile);
  const { settings } = useSyncExternalStore(navigation.subscribe, navigation.getState);
  const { openNew, openSettings, closeSettings } = navigation;
  // A project's home is its New page: sessions started there join it.
  const openProject = useCallback((projectId: string) => openNew(undefined, projectId), [openNew]);
  const [projectDialog, setProjectDialog] = useState<ProjectDialog | null>(null);
  const [composerCwd, setComposerCwd] = useState("");
  // One PR projection feeds the header, menu, and palette for the selected session.
  const prSession = state.view.kind === "session" ? state.session : null;
  // The registry's workspace for the directory, like Changes: it outlives a closed folder.
  const prWorkspaceId = workspaceFor(state, prSession?.cwd)?.id;
  const pullRequest = useSessionPullRequest(prWorkspaceId, prSession?.sessionId, !!prSession && isWorking(prSession.state));

  const onDraftChange = useCallback((key: string, text: string) => dispatch({ type: "draft_changed", key, text }), []);
  const onDraftAppend = useCallback((key: string, text: string) => dispatch({ type: "draft_appended", key, text }), []);
  const anyWorking = state.hosts.some((h) => h.streaming);

  return (
    <NavigationContext.Provider value={navigation}>
    <SessionCommandHost state={state} send={send}>
    <AppLayout layout={layout} navigationTitle={settings ? "Settings navigation" : "Folders and sessions"}
      navigation={compact => settings
        ? <SettingsNavigation compact={compact} section={settings} onShow={layout.show} onHide={layout.hide} onSelect={openSettings} onHome={closeSettings} />
        : compact ? <SidebarRail onShow={layout.show} working={anyWorking} />
          : <Sidebar state={state} send={send} onProjectDialog={setProjectDialog} onHide={layout.hide} />}
      content={<>
        {/* Opening settings keeps the current view mounted for session continuity (INV-02). */}
        <LayoutView key={state.view.kind} active={!settings}>
          {state.view.kind === "new" ? (
            <NewSession state={state} send={send} onDraftChange={onDraftChange} initialCwd={state.view.cwd} projectId={state.view.projectId} onProjectChange={id => openNew(undefined, id)} onNewProject={() => setProjectDialog({})} onMenu={showSidebar} onDirectoryChange={setComposerCwd} />
          ) : state.view.kind === "missing-session" ? (
            <Empty className="flex-1 px-4" role="alert">
              <EmptyHeader>
                <EmptyTitle>Session not found</EmptyTitle>
                <EmptyDescription>This session is not in the registry. Its reference may have been removed or deleted.</EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button variant="outline" onClick={() => openNew()}>New session</Button>
              </EmptyContent>
            </Empty>
          ) : (
            <SessionView state={state} send={send} onMenu={showSidebar} onDraftChange={onDraftChange} onDraftAppend={onDraftAppend} openProject={openProject} pullRequest={pullRequest} />
          )}
        </LayoutView>
        {settings && <LayoutView><SettingsPage section={settings} onMenu={showSidebar} providersChanged={() => { const cwd = state.view.kind === "new" ? composerCwd : state.session?.cwd; if (cwd) send({ _tag: "models", cwd, refresh: true }); }} /></LayoutView>}
      </>}>
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
        toastOptions={{ style: { "--toast-life": "4s" } as React.CSSProperties }}
      />
      {projectDialog && <ProjectDialogView key={JSON.stringify(projectDialog)} state={state} send={send} dialog={projectDialog} close={() => setProjectDialog(null)} openProject={openProject} />}
      <CommandPalette send={send} state={state} toggleSidebar={toggleSidebar} composerCwd={state.view.kind === "new" ? composerCwd : undefined} />
      <DialogHost dialogs={state.resync ? [] : state.session?.dialogs ?? []} send={send} connected={sessionReady(state)} />
    </AppLayout>
    </SessionCommandHost>
    </NavigationContext.Provider>
  );
}
