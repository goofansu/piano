import { useEffect, useRef, useState } from "react";
import { ChangesPanel } from "@/components/Changes";
import { SurfaceColumn, SurfaceSingleContext } from "@/components/SurfaceArea";
import { WorkspaceFile } from "@/components/WorkspaceFile";
import { sessionContext } from "@/lib/sessionContext";
import { useNavigation } from "@/lib/useNavigation";
import { type AppState, sessionKey } from "@/store";

/**
 * The selected session's Surface area: its Changes, or a file a link opened. Changes stays mounted
 * once opened in this session, hidden while another view or the Agent area shows, so its scroll
 * and expanded files survive switching, hiding and Settings; it reads Git only while shown. A
 * file is transient. Both are keyed by session (and the file by workspace and path), so a new
 * destination never flashes old content (INV-07).
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
  const { settings, surface, area, surfaceRequest, openFile, closeFile, hideSurface } =
    useNavigation();
  const t = state.session;
  const key = t ? sessionKey(t) : null;
  // The session whose Changes has been opened; another session's never stays mounted.
  const [changesFor, setChangesFor] = useState<string | null>(null);
  if (surface === "changes" && key && changesFor !== key) setChangesFor(key);
  const keepChanges = !!key && (changesFor === key || surface === "changes");
  const shown = !!surface && (!single || area === "surface");
  const file = typeof surface === "object" ? surface : null;
  const column = useRef<HTMLDivElement>(null);

  // Each request to show a surface focuses it, the view already shown included, without
  // reopening or rereading it.
  const seen = useRef(surfaceRequest);
  useEffect(() => {
    if (seen.current === surfaceRequest) return;
    seen.current = surfaceRequest;
    if (!shown) return;
    const frame = requestAnimationFrame(() => {
      // A tab chosen with the keyboard keeps focus, so arrows still move between tabs.
      if (document.activeElement?.getAttribute("role") === "tab") return;
      const view = column.current?.querySelector<HTMLElement>("[data-surface-view]:not([inert])");
      const target = view?.querySelector<HTMLElement>("[data-surface-focus]") ?? view;
      target?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [surfaceRequest, shown]);

  // Closing a view leaves focus where the user can go on: the view beneath it, else (beside the
  // Agent area) Views, where it can be opened again. One area at a time, back on Agent, focus is
  // left alone so a phone keeps its keyboard down. Only focus that was lost is moved: an overlay
  // that closed with the view (the palette) restores its own first, so this checks after it.
  const previous = useRef({ surface, key });
  useEffect(() => {
    const before = previous.current;
    previous.current = { surface, key };
    if (before.key !== key || !before.surface || before.surface === surface) return;
    const settle = () => {
      const active = document.activeElement;
      const lost = !active || active === document.body || !!active.closest("[inert]");
      if (!lost) return;
      const view = shown
        ? column.current?.querySelector<HTMLElement>("[data-surface-view]:not([inert])")
        : null;
      const target = view
        ? (view.querySelector<HTMLElement>("[data-surface-focus]") ?? view)
        : single
          ? null
          : document.querySelector<HTMLElement>("[data-views-trigger]");
      target?.focus({ preventScroll: true });
    };
    const frame = requestAnimationFrame(settle);
    const late = setTimeout(settle, 300);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(late);
    };
  }, [surface, key, shown, single]);

  if (!t) return null;
  const { workspace, changesWorkspace } = sessionContext(state);
  const changesShown = shown && surface === "changes" && !settings;
  return (
    <SurfaceSingleContext value={single}>
      <SurfaceColumn
        id={id}
        labelledBy={labelledBy}
        label={file ? "File viewer" : "Changes"}
        single={single}
        shown={shown}
      >
        <div ref={column} className="relative flex min-h-0 flex-1 flex-col">
          {keepChanges && (
            <SurfaceView shown={surface === "changes"}>
              <ChangesPanel
                key={key}
                workspace={changesWorkspace}
                session={t}
                active={changesShown}
                close={hideSurface}
                onAsk={onAsk}
              />
            </SurfaceView>
          )}
          {file && (
            <SurfaceView shown>
              <WorkspaceFile
                key={`${workspace?.id}:${key}:${file.path}`}
                workspaceId={workspace?.id}
                file={file}
                open={openFile}
                close={closeFile}
              />
            </SurfaceView>
          )}
        </div>
      </SurfaceColumn>
    </SurfaceSingleContext>
  );
}

/** One view's place in the area: shown, or hidden in place so it keeps its scroll. */
function SurfaceView({ shown, children }: { shown: boolean; children: React.ReactNode }) {
  return (
    <div
      data-surface-view
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
