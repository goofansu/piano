import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { AppLayout, LayoutView } from "@/components/AppLayout";
import { CommandHost } from "@/components/CommandHost";
import { CommandPalette } from "@/components/CommandPalette";
import { DialogHost } from "@/components/DialogHost";
import { NewSession } from "@/components/NewSession";
import { SessionView } from "@/components/SessionView";
import { SettingsNavigation, SettingsPage } from "@/components/SettingsPage";
import { Sidebar, SidebarRail } from "@/components/Sidebar";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Toaster } from "@/components/ui/sonner";
import type { NotifyLevel } from "@/lib/client";
import { type DraftStore, DraftStoreContext } from "@/lib/draftStore";
import type { DraftKey } from "@/lib/messageDraft";
import { initialView } from "@/lib/navigation";
import { parseRoute } from "@/lib/routes";
import { sessionReady } from "@/lib/sessionContext";
import { readJson, writeJson } from "@/lib/storage";
import { useClient } from "@/lib/useClient";
import { NavigationContext, useNavigationController } from "@/lib/useNavigation";
import { SidebarLayoutContext, useSidebarLayoutController } from "@/lib/useSidebarLayout";
import { type AppState, initialState } from "@/store";

/** Model catalogs outlive reloads so the picker opens at once; its refresh button re-probes Pi. */
const CATALOGS_KEY = "piano.catalogs";

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
    const seeded = { ...initialState, catalogs: readJson<AppState["catalogs"]>(CATALOGS_KEY, {}) };
    return { ...seeded, view: initialView(parseRoute(location)) };
  }, notify);
  const { dispatch, send } = client;
  useEffect(() => {
    // Without storage the server cache still answers.
    writeJson(
      CATALOGS_KEY,
      Object.fromEntries(Object.entries(state.catalogs).filter(([, c]) => !c.error)),
    );
  }, [state.catalogs]);
  const layout = useSidebarLayoutController();

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
  // Draft editors and whatever adds to a draft reach the store through this, not through view props.
  const draftActions = useMemo(
    () => ({
      change: (key: DraftKey, text: string) => dispatch({ type: "draft_changed", key, text }),
      append: (key: DraftKey, text: string) => dispatch({ type: "draft_appended", key, text }),
      paragraph: (key: DraftKey, text: string) =>
        dispatch({ type: "draft_paragraph_appended", key, text }),
    }),
    [dispatch],
  );
  const draftStore = useMemo(
    (): DraftStore => ({ drafts: state.drafts, ...draftActions }),
    [state.drafts, draftActions],
  );
  const anyWorking = state.hosts.some((h) => h.streaming);

  return (
    <SidebarLayoutContext.Provider value={layout}>
      <NavigationContext.Provider value={navigation}>
        <DraftStoreContext.Provider value={draftStore}>
          <CommandHost state={state} send={send}>
            <AppLayout
              navigationTitle={settings ? "Settings navigation" : "Folders and sessions"}
              navigation={(compact) =>
                settings ? (
                  <SettingsNavigation
                    compact={compact}
                    section={settings}
                    onSelect={openSettings}
                    onHome={closeSettings}
                  />
                ) : compact ? (
                  <SidebarRail working={anyWorking} />
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
                        projectId={state.view.projectId}
                        onProjectChange={(id) => openNew(undefined, id)}
                      />
                    ) : state.view.kind === "missing-session" ? (
                      <Empty className="flex-1 px-4" role="alert">
                        <EmptyHeader>
                          <EmptyTitle>Session not found</EmptyTitle>
                          <EmptyDescription>
                            This session is not in the registry. Its reference may have been removed
                            or deleted.
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
                toastOptions={{ style: { "--toast-life": "4s" } as React.CSSProperties }}
              />
              <CommandPalette state={state} />
              <DialogHost
                dialogs={state.resync ? [] : (state.session?.dialogs ?? [])}
                send={send}
                connected={sessionReady(state)}
              />
            </AppLayout>
          </CommandHost>
        </DraftStoreContext.Provider>
      </NavigationContext.Provider>
    </SidebarLayoutContext.Provider>
  );
}
