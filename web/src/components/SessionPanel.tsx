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
import type { PullRequestControl } from "@/components/SessionPullRequest";
import { SurfaceColumn, surfaceTabNames } from "@/components/SurfaceArea";
import { FileTabIcon, WorkspaceFile } from "@/components/WorkspaceFile";
import { activeTab, isView, type SurfaceTab, tabKey } from "@/lib/navigation";
import { sessionContext } from "@/lib/sessionContext";
import { useNavigation } from "@/lib/useNavigation";
import { type AppState, sessionKey } from "@/store";

const surfaceTabId = (key: string) => `surface-tab-${encodeURIComponent(key)}`;
const viewId = (key: string) => `surface-view-${encodeURIComponent(key)}`;
export function SurfaceTabTrigger({
  tab,
  id,
  controls,
}: {
  tab: SurfaceTab;
  id: string;
  controls: string;
}) {
  return (
    <PianoStripTabTrigger
      value={tabKey(tab)}
      id={id}
      aria-controls={controls}
      title={isView(tab) ? undefined : tab.path}
      icon={
        tab === "changes" ? (
          <FileDiffIcon className="size-3.5" />
        ) : (
          <FileTabIcon path={tab.path} className="size-3.5" />
        )
      }
    >
      {surfaceTabNames(tab).name}
    </PianoStripTabTrigger>
  );
}

export function SessionPanel({
  state,
  onAsk,
  pullRequest,
  id,
  labelledBy,
}: {
  state: AppState;
  id: string;
  labelledBy: string | undefined;
  onAsk: ((text: string) => void) | undefined;
  pullRequest: PullRequestControl;
}) {
  const navigation = useNavigation();
  const { surface, surfaceRequest, single, selectTab, closeTab } = navigation;
  const t = state.session;
  const key = t ? sessionKey(t) : null;
  const tabs = surface?.tabs ?? [];
  const active = surface?.active ?? null;
  const changesOpen = tabs.includes("changes");
  const [changesFor, setChangesFor] = useState<string | null>(null);
  if (changesOpen && key && changesFor !== key) setChangesFor(key);
  const keepChanges = !!key && (changesFor === key || changesOpen);
  const shown = navigation.layout.surface;

  const focusShown = () => {
    if (!active) return false;
    const target = document.getElementById(viewId(active));
    target?.focus({ preventScroll: true });
    return !!target;
  };

  const seen = useRef(surfaceRequest);
  useEffect(() => {
    if (seen.current === surfaceRequest) return;
    seen.current = surfaceRequest;
    if (!shown) return;
    const frame = requestAnimationFrame(() => {
      if (document.activeElement?.getAttribute("role") === "tab") return;
      focusShown();
    });
    return () => cancelAnimationFrame(frame);
  });

  const previous = useRef({ count: tabs.length, key });
  useEffect(() => {
    const before = previous.current;
    previous.current = { count: tabs.length, key };
    if (before.key !== key || tabs.length >= before.count) return;
    const settle = () => {
      const focused = document.activeElement;
      const lost = !focused || focused === document.body || !!focused.closest("[inert]");
      if (!lost) return;
      if (shown && active) {
        (single
          ? document.querySelector<HTMLElement>('[role="tab"][data-state="active"]')
          : document.getElementById(surfaceTabId(active))
        )?.focus({ preventScroll: true });
        return;
      }
      document
        .querySelector<HTMLElement>(
          single
            ? '[role="tab"][data-state="active"], [data-session-menu]'
            : "[data-rail-trigger], [data-changes-trigger]",
        )
        ?.focus({ preventScroll: true });
    };
    const frame = requestAnimationFrame(settle);
    const late = setTimeout(settle, 300);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(late);
    };
  });

  if (!t) return null;
  const { changesWorkspace, changesUnavailable } = sessionContext(state);
  const files = tabs.filter((tab): tab is Exclude<SurfaceTab, string> => !isView(tab));
  const view = (k: string, children: React.ReactNode, identity: string | number = k) => (
    <SurfaceView key={identity} tab={k} shown={active === k} single={single}>
      {children}
    </SurfaceView>
  );
  return (
    <SurfaceColumn
      id={id}
      labelledBy={labelledBy}
      label={surfaceTabNames(activeTab(surface) ?? "changes").region}
      single={single}
      shown={shown}
    >
      {!single && (
        <PianoStripBar>
          <Tabs
            value={active ?? ""}
            onValueChange={selectTab}
            className="min-w-0 flex-1 gap-0 self-stretch"
          >
            <PianoStripTabsList aria-label="Surface views">
              {tabs.map((tab) => {
                const k = tabKey(tab);
                return (
                  <PianoStripTab key={k} selected={k === active}>
                    <SurfaceTabTrigger tab={tab} id={surfaceTabId(k)} controls={viewId(k)} />
                    <IconButton
                      size="row"
                      label={surfaceTabNames(tab).close}
                      onClick={() => closeTab(k)}
                    >
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
              unavailable={changesUnavailable}
              session={t}
              active={navigation.shownTab === "changes"}
              onAsk={onAsk}
              pullRequest={pullRequest}
            />,
          )}
        {files.map((file) =>
          view(
            tabKey(file),
            <WorkspaceFile file={file} active={navigation.shownTab === tabKey(file)} />,
            file.key,
          ),
        )}
      </div>
    </SurfaceColumn>
  );
}

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
