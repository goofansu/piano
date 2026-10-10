import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { AppLayout, LayoutView, useAppLayout } from "@/components/AppLayout";
import { CommandPalette } from "@/components/CommandPalette";
import { DialogHost } from "@/components/DialogHost";
import { NewSession } from "@/components/NewSession";
import { type ProjectDialog, ProjectDialogView } from "@/components/Projects";
import { SessionCommandHost } from "@/components/SessionCommandHost";
import { SessionView } from "@/components/SessionView";
import { SettingsNavigation, SettingsPage, type SettingsSection } from "@/components/SettingsPage";
import { Sidebar, SidebarRail } from "@/components/Sidebar";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Toaster } from "@/components/ui/sonner";
import type { NotifyLevel } from "@/lib/client";
import { hasMod } from "@/lib/keys";
import { parseRoute, type Route, routePath } from "@/lib/routes";
import { catalogEntry } from "@/lib/sessionCatalog";
import { sessionReady, workspaceFor } from "@/lib/sessionContext";
import { readJson, writeJson } from "@/lib/storage";
import { useClient } from "@/lib/useClient";
import { useSessionPullRequest } from "@/lib/useSessionPullRequest";
import { type AppState, initialState } from "@/store";

/** Model catalogs outlive reloads so the picker opens at once; its refresh button re-probes Pi. */
const CATALOGS_KEY = "piano.catalogs";

const notify = (message: string, level?: NotifyLevel) =>
  level === "success" ? toast.success(message) : level === "info" ? toast.info(message) : level === "warning" ? toast.warning(message) : level === "error" ? toast.error(message) : toast(message);

export default function App() {
  const { state, client } = useClient((): AppState => {
    const seeded = { ...initialState, catalogs: readJson<AppState["catalogs"]>(CATALOGS_KEY, {}) };
    const route = parseRoute(location);
    return route.kind === "session" ? { ...seeded, view: { kind: "session" } } : { ...seeded, view: { kind: "new", projectId: route.kind === "new" ? route.projectId : undefined } };
  }, notify);
  const { dispatch, send } = client;
  useEffect(() => {
    // Without storage the server cache still answers.
    writeJson(CATALOGS_KEY, Object.fromEntries(Object.entries(state.catalogs).filter(([, c]) => !c.error)));
  }, [state.catalogs]);
  const layout = useAppLayout();
  const { closeMobile, show: showSidebar, toggle: toggleSidebar } = layout;

  const [settingsOpen, setSettingsOpen] = useState(() => parseRoute(location).kind === "settings");
  const [settingsSection, setSettingsSection] = useState<SettingsSection>(() => {
    const route = parseRoute(location);
    return route.kind === "settings" ? route.section : "providers";
  });
  const openSettingsSection = useCallback((section: SettingsSection = "providers") => { setSettingsSection(section); setSettingsOpen(true); closeMobile(); }, [closeMobile]);
  const openSettings = useCallback(() => openSettingsSection("providers"), [openSettingsSection]);
  const closeSettings = useCallback(() => { setSettingsOpen(false); closeMobile(); }, [closeMobile]);
  const select = useCallback(
    (cwd: string, sessionId: string | null) => {
      closeMobile();
      setSettingsOpen(false);
      client.select(cwd, sessionId);
    },
    [client, closeMobile],
  );

  const [projectDialog, setProjectDialog] = useState<ProjectDialog | null>(null);
  const openNew = useCallback((cwd?: string, projectId?: string) => {
    setSettingsOpen(false);
    dispatch({ type: "new", cwd, projectId });
    closeMobile();
  }, [closeMobile]);
  // A project's home is its New page: sessions started there join it.
  const openProject = useCallback((projectId: string) => openNew(undefined, projectId), [openNew]);

  // ── keyboard flow ──
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [composerCwd, setComposerCwd] = useState("");
  // One Changes sheet per selected session; the header menu and the palette both open it.
  const [changesOpen, setChangesOpen] = useState(false);
  const [pullRequestOpen, setPullRequestOpen] = useState(false);
  // One PR projection feeds the header, menu, and palette for the selected session.
  const prSession = state.view.kind === "session" ? state.session : null;
  // The registry's workspace for the directory, like Changes: it outlives a closed folder.
  const prWorkspaceId = workspaceFor(state, prSession?.cwd)?.id;
  const pullRequest = useSessionPullRequest(prWorkspaceId, prSession?.sessionId, !!(prSession?.state.isStreaming || prSession?.state.isCompacting || prSession?.state.isRetrying));
  useEffect(() => { setChangesOpen(false); setPullRequestOpen(false); }, [state.session?.cwd, state.session?.sessionId]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      if (hasMod(e) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") { e.preventDefault(); setPaletteOpen((open) => !open); }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);

  // ── routing ──
  // A route read from the address bar (on load, or on back/forward) that has not been applied yet.
  const wanted = useRef<Route | null>(parseRoute(location));
  const applyRoute = useCallback(() => {
    const r = wanted.current;
    if (!r) return;
    const s = client.getState();
    if (r.kind === "settings") {
      wanted.current = null;
      setSettingsSection(r.section);
      setSettingsOpen(true);
      return;
    }
    if (r.kind === "new") {
      wanted.current = null;
      // Back or forward onto the same New page keeps whatever directory it already had.
      if (s.view.kind !== "new" || s.view.projectId !== r.projectId) dispatch({ type: "new", projectId: r.projectId });
      return;
    }
    // A session needs its directory, which only the folder list knows.
    if (!s.registryLoaded) return;
    wanted.current = null;
    const session = catalogEntry(s, r.sessionId);
    if (session) select(session.cwd, session.sessionId);
    else dispatch({ type: "missing-session", sessionId: r.sessionId });
  }, [select]);
  useEffect(applyRoute, [applyRoute, state.registryLoaded, state.folders, state.sessionReferences]);
  useEffect(() => {
    const onPop = () => {
      closeMobile();
      const route = parseRoute(location);
      setSettingsOpen(route.kind === "settings");
      wanted.current = route;
      applyRoute();
    };
    addEventListener("popstate", onPop);
    return () => removeEventListener("popstate", onPop);
  }, [applyRoute, closeMobile]);
  // The address bar follows the state; a route that is still being applied already matches it.
  useEffect(() => {
    if (wanted.current) return;
    const current = state.session ?? state.selecting;
    const route: Route | null = state.view.kind === "new"
      ? { kind: "new", projectId: state.view.projectId }
      : state.view.kind === "missing-session"
        ? { kind: "session", sessionId: state.view.sessionId }
        : current?.sessionId ? { kind: "session", sessionId: current.sessionId } : null;
    if (!route) return;
    const path = routePath(settingsOpen ? { kind: "settings", section: settingsSection } : route);
    if (path !== location.pathname + location.search) {
      // The bare root is an alias for /new and a query string carries nothing: replace those, push real moves.
      if (location.pathname === "/" || location.pathname === "/settings" || location.pathname === path) history.replaceState(null, "", path);
      else history.pushState(null, "", path);
    }
    const title = state.view.kind === "missing-session" ? "Session not found"
      : route.kind === "new" ? (route.projectId && state.projects.find(p => p.id === route.projectId)?.name) || "New session"
      : catalogEntry(state, route.sessionId)?.title || "Session";
    document.title = `${settingsOpen ? "Settings" : title} - Piano`;
  }, [settingsOpen, settingsSection, state.view, state.session, state.selecting, state.folders, state.projects, state.sessionReferences]);

  const onDraftChange = useCallback((key: string, text: string) => dispatch({ type: "draft_changed", key, text }), []);
  const onDraftAppend = useCallback((key: string, text: string) => dispatch({ type: "draft_appended", key, text }), []);
  const sidebarProps = { state, send, select, openNew, openSettings, onProjectDialog: setProjectDialog, onPalette: () => setPaletteOpen(true) };
  const anyWorking = state.hosts.some((h) => h.streaming);

  return (
    <SessionCommandHost state={state} send={send} openNew={openNew} openChanges={() => { closeSettings(); setChangesOpen(true); }} openPullRequest={() => { closeSettings(); setPullRequestOpen(true); }}>
    <AppLayout layout={layout} navigationTitle={settingsOpen ? "Settings navigation" : "Folders and sessions"}
      navigation={compact => settingsOpen
        ? <SettingsNavigation compact={compact} section={settingsSection} onShow={layout.show} onHide={layout.hide} onSelect={openSettingsSection} onHome={closeSettings} />
        : compact ? <SidebarRail openSettings={openSettings} onShow={layout.show} working={anyWorking} />
          : <Sidebar {...sidebarProps} onHide={layout.hide} />}
      content={<>
        {/* Opening settings keeps the current view mounted for session continuity (INV-02). */}
        <LayoutView key={state.view.kind} active={!settingsOpen}>
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
            <SessionView state={state} send={send} onMenu={showSidebar} onDraftChange={onDraftChange} onDraftAppend={onDraftAppend} openProject={openProject} changesOpen={!settingsOpen && changesOpen} onChangesOpenChange={setChangesOpen} pullRequest={pullRequest} pullRequestOpen={!settingsOpen && pullRequestOpen} onPullRequestOpenChange={setPullRequestOpen} />
          )}
        </LayoutView>
        {settingsOpen && <LayoutView><SettingsPage section={settingsSection} onMenu={showSidebar} providersChanged={() => { const cwd = state.view.kind === "new" ? composerCwd : state.session?.cwd; if (cwd) send({ _tag: "models", cwd, refresh: true }); }} /></LayoutView>}
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
      <CommandPalette openSettings={openSettingsSection} closeSettings={settingsOpen ? closeSettings : undefined} send={send} open={paletteOpen} onOpenChange={setPaletteOpen} state={state} select={select} openNew={openNew} toggleSidebar={toggleSidebar} composerCwd={state.view.kind === "new" ? composerCwd : undefined} />
      <DialogHost dialogs={state.resync ? [] : state.session?.dialogs ?? []} send={send} connected={sessionReady(state)} />
    </AppLayout>
    </SessionCommandHost>
  );
}
