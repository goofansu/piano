import { FileDiffIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ChangesPanel } from "@/components/Changes";
import { IconButton } from "@/components/IconButton";
import {
  PianoStripBar,
  PianoStripTab,
  PianoStripTabsList,
  PianoStripTabTrigger,
  Tabs,
} from "@/components/PianoTabs";
import { SurfaceColumn, SurfaceSingleContext } from "@/components/SurfaceArea";
import { FileTabIcon, WorkspaceFile } from "@/components/WorkspaceFile";
import { type SurfaceTab, shownAreas, tabKey } from "@/lib/navigation";
import { sessionContext } from "@/lib/sessionContext";
import { useNavigation } from "@/lib/useNavigation";
import { type AppState, sessionKey } from "@/store";

/** The id of a Surface tab's trigger, which its view is labelled by. */
export const surfaceTabId = (key: string) => `surface-tab-${encodeURIComponent(key)}`;
const viewId = (key: string) => `surface-view-${encodeURIComponent(key)}`;
const fileName = (path: string) => path.slice(path.lastIndexOf("/") + 1);

/** A tab's name and the name of its Close. */
export function surfaceTabNames(tab: SurfaceTab) {
  return tab === "changes"
    ? { name: "Changes", close: "Hide changes" }
    : { name: fileName(tab.path), close: `Close ${fileName(tab.path)}` };
}

/**
 * The selected session's Surface area: its tabs, Changes and the files links opened. Beside the
 * Agent area a strip holds the tabs, each with its Close, above the shown view's own toolbar; one
 * area at a time the session's tabs name the views instead. Every open tab stays
 * mounted, hidden while another shows, so scroll and expanded files survive switching; Changes
 * stays mounted for the session once opened, even after its tab closes, and reads Git only while
 * shown. Views are keyed by session (and a file by workspace and path), so a new destination
 * never flashes old content (INV-07).
 */
export function SessionPanel({
  state,
  single,
  onAsk,
  id,
  labelledBy,
}: {
  state: AppState;
  single: boolean;
  id: string;
  /** The tab naming the area, one area at a time. */
  labelledBy: string | undefined;
  /** Adds review text to the draft; omitted while the draft takes no additions. */
  onAsk: ((text: string) => void) | undefined;
}) {
  const navigation = useNavigation();
  const { settings, surface, surfaceRequest, openFile, selectTab, closeTab } = navigation;
  const t = state.session;
  const key = t ? sessionKey(t) : null;
  const tabs = surface?.tabs ?? [];
  const active = surface?.active ?? null;
  const changesOpen = tabs.includes("changes");
  // The session whose Changes has been opened; another session's never stays mounted.
  const [changesFor, setChangesFor] = useState<string | null>(null);
  if (changesOpen && key && changesFor !== key) setChangesFor(key);
  const keepChanges = !!key && (changesFor === key || changesOpen);
  const shown = shownAreas(navigation).surface;

  /**
   * Focus on the shown view itself, where reading and scrolling start; its tab is one Shift+Tab
   * away. Focusing the tab from script would draw the keyboard ring after a pointer choice.
   */
  const focusShown = () => {
    if (!active) return false;
    const target = document.getElementById(viewId(active));
    target?.focus({ preventScroll: true });
    return !!target;
  };

  // Each request to show a tab focuses it, the one already shown included, without reopening
  // or rereading it.
  const seen = useRef(surfaceRequest);
  useEffect(() => {
    if (seen.current === surfaceRequest) return;
    seen.current = surfaceRequest;
    if (!shown) return;
    const frame = requestAnimationFrame(() => {
      // A tab chosen with the pointer or keyboard keeps focus, so arrows still move between tabs.
      if (document.activeElement?.getAttribute("role") === "tab") return;
      focusShown();
    });
    return () => cancelAnimationFrame(frame);
  });

  // Closing a tab leaves focus where the user can go on: the tab now shown, else (beside the
  // Agent area) Views, where it can be opened again. One area at a time, back on Agent, focus is
  // left alone so a phone keeps its keyboard down. Only focus that was lost is moved: an overlay
  // that closed with the tab (the palette) restores its own first, so this checks after it.
  const previous = useRef({ count: tabs.length, key });
  useEffect(() => {
    const before = previous.current;
    previous.current = { count: tabs.length, key };
    if (before.key !== key || tabs.length >= before.count) return;
    const settle = () => {
      const focused = document.activeElement;
      const lost = !focused || focused === document.body || !!focused.closest("[inert]");
      if (!lost) return;
      if (shown && focusShown()) return;
      if (!single) document.querySelector<HTMLElement>("[data-views-trigger]")?.focus();
    };
    const frame = requestAnimationFrame(settle);
    const late = setTimeout(settle, 300);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(late);
    };
  });

  if (!t) return null;
  const { workspace, changesWorkspace } = sessionContext(state);
  const files = tabs.filter((tab): tab is Exclude<SurfaceTab, "changes"> => tab !== "changes");
  const view = (k: string, children: React.ReactNode) => (
    <SurfaceView key={k} tab={k} shown={active === k} single={single}>
      {children}
    </SurfaceView>
  );
  return (
    <SurfaceSingleContext value={single}>
      <SurfaceColumn
        id={id}
        labelledBy={labelledBy}
        label={active === "changes" ? "Changes" : "File viewer"}
        single={single}
        shown={shown}
      >
        {!single && (
          // Only the tabs: the shown view's controls are its own toolbar beneath.
          <PianoStripBar>
            <Tabs
              value={active ?? ""}
              onValueChange={selectTab}
              className="min-w-0 flex-1 gap-0 self-stretch"
            >
              <PianoStripTabsList aria-label="Surface views">
                {tabs.map((tab) => {
                  const k = tabKey(tab);
                  const names = surfaceTabNames(tab);
                  return (
                    <PianoStripTab key={k} selected={k === active} className="-mb-px">
                      <PianoStripTabTrigger
                        value={k}
                        id={surfaceTabId(k)}
                        aria-controls={viewId(k)}
                        title={tab === "changes" ? undefined : tab.path}
                      >
                        <span className="flex shrink-0 text-ink-3" aria-hidden>
                          {tab === "changes" ? (
                            <FileDiffIcon className="size-3.5" />
                          ) : (
                            <FileTabIcon path={tab.path} className="size-3.5" />
                          )}
                        </span>
                        <span className="min-w-0 truncate font-medium">{names.name}</span>
                      </PianoStripTabTrigger>
                      <IconButton size="row" label={names.close} onClick={() => closeTab(k)}>
                        <XIcon />
                      </IconButton>
                    </PianoStripTab>
                  );
                })}
              </PianoStripTabsList>
            </Tabs>
          </PianoStripBar>
        )}
        <div className="relative flex min-h-0 flex-1 flex-col">
          {keepChanges &&
            view(
              "changes",
              <ChangesPanel
                key={key}
                workspace={changesWorkspace}
                session={t}
                active={shown && active === "changes" && !settings}
                close={() => closeTab("changes")}
                onAsk={onAsk}
              />,
            )}
          {files.map((file) =>
            view(
              tabKey(file),
              <WorkspaceFile
                key={`${workspace?.id}:${key}:${file.path}`}
                workspaceId={workspace?.id}
                file={file}
                open={openFile}
                close={() => closeTab(tabKey(file))}
              />,
            ),
          )}
        </div>
      </SurfaceColumn>
    </SurfaceSingleContext>
  );
}

/** One view's place in the area: shown, or hidden in place so it keeps its scroll. */
function SurfaceView({
  tab,
  shown,
  single,
  children,
}: {
  tab: string;
  shown: boolean;
  single: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      id={viewId(tab)}
      // Beside the Agent area each view is the panel its strip tab names; one area at a time the
      // area itself is the session tabs' panel.
      {...(!single && { role: "tabpanel", "aria-labelledby": surfaceTabId(tab) })}
      tabIndex={-1}
      inert={!shown}
      aria-hidden={!shown}
      className={
        shown
          ? "flex min-h-0 flex-1 flex-col outline-none"
          : "invisible absolute inset-0 flex flex-col"
      }
    >
      {children}
    </div>
  );
}
