import type { ClientCommand, ServerMessage } from "@shared/wire";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { toast } from "sonner";
import { AppLayout, LayoutView, useAppLayout } from "@/components/AppLayout";
import { CommandPalette } from "@/components/CommandPalette";
import { DialogHost } from "@/components/DialogHost";
import { NewSession } from "@/components/NewSession";
import { type ProjectDialog, ProjectDialogView } from "@/components/Projects";
import { SessionView } from "@/components/SessionView";
import { SettingsNavigation, SettingsPage, type SettingsSection } from "@/components/SettingsPage";
import { Sidebar, SidebarRail } from "@/components/Sidebar";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Toaster } from "@/components/ui/sonner";
import { hasMod } from "@/lib/keys";
import { parseRoute, type Route, routePath } from "@/lib/routes";
import { readJson, writeJson } from "@/lib/storage";
import { useSessionPullRequest } from "@/lib/useSessionPullRequest";
import { useConnection } from "@/lib/ws";
import { type Action, type AppState, initialState, reduce, sessionDelivery } from "@/store";

/** Model catalogs outlive reloads so the picker opens at once; its refresh button re-probes Pi. */
const CATALOGS_KEY = "piano.catalogs";

export default function App() {
  const [state, reactDispatch] = useReducer(reduce, initialState, (s): AppState => {
    const seeded = { ...s, catalogs: readJson<AppState["catalogs"]>(CATALOGS_KEY, {}) };
    const route = parseRoute(location);
    return route.kind === "session" ? { ...seeded, view: { kind: "session" } } : { ...seeded, view: { kind: "new", projectId: route.kind === "new" ? route.projectId : undefined } };
  });
  useEffect(() => {
    // Without storage the server cache still answers.
    writeJson(CATALOGS_KEY, Object.fromEntries(Object.entries(state.catalogs).filter(([, c]) => !c.error)));
  }, [state.catalogs]);
  const layout = useAppLayout();
  const { closeMobile, show: showSidebar, toggle: toggleSidebar } = layout;
  const latest = useRef(state);
  latest.current = state;
  // Socket frames can arrive before React renders. Keep acceptance/correlation current.
  const dispatch = useCallback((action: Action) => {
    latest.current = reduce(latest.current, action);
    reactDispatch(action);
  }, []);

  const onMessage = useCallback((m: ServerMessage) => {
    const notifySession = m._tag === "session" && sessionDelivery(latest.current, m) === "apply";
    dispatch({ type: "server", message: m });
    const notify = (message: string, level?: "success" | "info" | "warning" | "error") =>
      level === "success" ? toast.success(message) : level === "info" ? toast.info(message) : level === "warning" ? toast.warning(message) : level === "error" ? toast.error(message) : toast(message);
    if (m._tag === "error") notify(m.message, "error");
    else if (m._tag === "toast") notify(m.message, m.level);
    else if (m._tag === "action_result" && m.result._tag === "queue_restored" && m.result.stopError) notify(m.result.stopError, "error");
    else if (m._tag === "worktree_result" && m.result.status === "ready" && m.result.creation) notify(`Created ${m.result.branch} from ${m.result.creation.baseBranch} · hooks ${m.result.creation.hooks}`, "success");
    else if (notifySession && m._tag === "session" && m.event._tag === "notice") notify(m.event.message, m.event.level);
    else if (notifySession && m._tag === "session" && m.event._tag === "closed" && !/released|code 0\b/.test(m.event.reason)) toast.warning(`Pi stopped: ${m.event.reason}`);
  }, []);
  const onStatus = useCallback((connected: boolean) => dispatch({ type: "connected", connected }), []);
  const conn = useConnection(onMessage, onStatus);

  const [settingsOpen, setSettingsOpen] = useState(() => parseRoute(location).kind === "settings");
  const [settingsSection, setSettingsSection] = useState<SettingsSection>(() => {
    const route = parseRoute(location);
    return route.kind === "settings" ? route.section : "providers";
  });
  const openSettingsSection = useCallback((section: SettingsSection = "providers") => { setSettingsSection(section); setSettingsOpen(true); closeMobile(); }, [closeMobile]);
  const openSettings = useCallback(() => openSettingsSection("providers"), [openSettingsSection]);
  const closeSettings = useCallback(() => { setSettingsOpen(false); closeMobile(); }, [closeMobile]);
  const send = useCallback((m: ClientCommand) => {
    if (m._tag === "select" || m._tag === "create_session") {
      const selectionId = crypto.randomUUID();
      dispatch({ type: "selecting", selectionId, cwd: m.cwd, sessionId: m._tag === "select" ? m.sessionId : null,
        firstMessage: m._tag === "create_session" && (m.text?.trim() || m.attachments?.length)
          ? { text: m.text ?? "", attachments: m.attachments?.map(a => ({ kind: "image" as const, url: `data:${a.mimeType};base64,${a.data}` })) } : undefined });
      conn.send({ ...m, selectionId });
    } else if (m._tag === "act") {
      const s = latest.current;
      if (s.connected && !s.resync && !s.selecting && s.selectionId) conn.send({ ...m, selectionId: s.selectionId });
    } else conn.send(m);
  }, [conn, dispatch]);
  const select = useCallback(
    (cwd: string, sessionId: string | null) => {
      closeMobile();
      setSettingsOpen(false);
      // Clicking the session already on screen (or already being fetched) is a no-op.
      const current = latest.current.session ?? latest.current.selecting;
      if (current && current.cwd === cwd && current.sessionId === sessionId && latest.current.view.kind === "session") return;
      send({ _tag: "select", cwd, sessionId });
    },
    [send, closeMobile],
  );

  // Re-select the current session after a reconnect so the server re-attaches us.
  useEffect(() => {
    const current = latest.current.session ?? latest.current.selecting;
    if (state.connected && current) send({ _tag: "select", cwd: current.cwd, sessionId: current.sessionId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.connected]);
  useEffect(() => {
    const current = latest.current.session;
    // The reconnect effect above may already have started a fresh attachment.
    if (state.connected && latest.current.resync && current) send({ _tag: "select", cwd: current.cwd, sessionId: current.sessionId });
  }, [state.connected, state.resync, send]);

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
  const prWorkspaceId = state.folders.flatMap(p => p.sessions).find(s => s.cwd === prSession?.cwd && s.sessionId === prSession?.sessionId)?.workspaceId;
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
    const s = latest.current;
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
    const owner = s.folders.find((p) => p.sessions.some((t) => t.sessionId === r.sessionId));
    const session = s.sessionReferences.find(t => t.sessionId === r.sessionId) ?? owner?.sessions.find((t) => t.sessionId === r.sessionId);
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
      : state.sessionReferences.find(t => t.sessionId === route.sessionId)?.title || "Session";
    document.title = `${settingsOpen ? "Settings" : title} - Piano`;
  }, [settingsOpen, settingsSection, state.view, state.session, state.selecting, state.folders, state.projects, state.sessionReferences]);

  const onDraftChange = useCallback((key: string, text: string) => dispatch({ type: "draft_changed", key, text }), []);
  const onDraftAppend = useCallback((key: string, text: string) => dispatch({ type: "draft_appended", key, text }), []);
  const sidebarProps = { state, send, select, openNew, openSettings, onProjectDialog: setProjectDialog, onPalette: () => setPaletteOpen(true) };
  const anyWorking = state.hosts.some((h) => h.streaming);
  // An installed app has no tab icon, so its dock or taskbar badge shows that any session works.
  useEffect(() => {
    if (!("setAppBadge" in navigator)) return;
    (anyWorking ? navigator.setAppBadge() : navigator.clearAppBadge()).catch(() => {});
  }, [anyWorking]);

  return (
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
            <SessionView state={state} send={send} onMenu={showSidebar} onDraftChange={onDraftChange} onDraftAppend={onDraftAppend} openNew={openNew} openProject={openProject} changesOpen={!settingsOpen && changesOpen} onChangesOpenChange={setChangesOpen} pullRequest={pullRequest} pullRequestOpen={!settingsOpen && pullRequestOpen} onPullRequestOpenChange={setPullRequestOpen} />
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
      <CommandPalette openSettings={openSettingsSection} closeSettings={settingsOpen ? closeSettings : undefined} send={send} open={paletteOpen} onOpenChange={setPaletteOpen} state={state} select={select} openNew={openNew} toggleSidebar={toggleSidebar} openChanges={() => { closeSettings(); setChangesOpen(true); }} openPullRequest={() => { closeSettings(); setPullRequestOpen(true); }} composerCwd={state.view.kind === "new" ? composerCwd : undefined} />
      <DialogHost dialogs={state.resync ? [] : state.session?.dialogs ?? []} send={send} connected={state.connected && !state.resync && !state.selecting && state.selectionId !== null} />
    </AppLayout>
  );
}
