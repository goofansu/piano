import { cn } from "cn";
import { MoreHorizontalIcon } from "lucide-react";
import { Fragment, memo } from "react";
import { BranchLabel } from "@/components/BranchLabel";
import { SessionCommandMenuItem, useCommands, useSessionCommands } from "@/components/CommandHost";
import { PianoButton as Button } from "@/components/PianoButton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/PianoDropdownMenu";
import { Keys } from "@/components/PianoMark";
import { ProjectMenu } from "@/components/Projects";
import { RowActions } from "@/components/RowActions";
import type { Navigation } from "@/lib/navigation";
import { sessionProjectMenu } from "@/lib/projectCommands";
import type { SessionEntry } from "@/lib/sessionCatalog";
import { sessionRowMenu } from "@/lib/sessionCommands";
import { useSidebarWindow } from "@/lib/useSidebarWindow";
import { sessionKey } from "@/store";

/** Shared rhythm for session rows, group headers and skeletons: pointer, touch desktop, phone. */
export const sidebarRowClassName = "h-8 pointer-coarse:h-11 max-md:h-12";
/** A session row with its folder and branch line beneath the title: the same steps, one line taller. */
const detailedRowClassName = "h-11 pointer-coarse:h-14 max-md:h-15";
/** Space between session rows: tight on desktop, roomier for fingers on phones. */
export const sidebarRowGapClassName = "gap-1 md:gap-0.5";

/**
 * The line beneath each title when View options shows folder and branch: the branch, and the
 * folder too unless the row's group already names it.
 */
export type SessionRowDetails = "branch" | "folder-and-branch";

/**
 * One session list in the sidebar's shared ScrollArea/nav. Owns row identity, responsive
 * measurement, window placement and keyboard/menu retention together. Grouping, ordering and
 * whether a closed group mounts its list remain the caller's decisions.
 * shadcn has no windowed list; keep its ScrollArea and disclosures, window only the rows.
 */
export function SidebarSessionList({
  sessions,
  grouped = false,
  details,
  select,
}: Pick<Navigation, "select"> & {
  sessions: readonly SessionEntry[];
  grouped?: boolean;
  details?: SessionRowDetails;
}) {
  const window = useSidebarWindow(sessions);
  const rowClassName = details ? detailedRowClassName : sidebarRowClassName;
  return (
    <ul
      ref={window.list}
      className={cn("relative flex flex-col", sidebarRowGapClassName, grouped && "py-1")}
      style={{ height: window.height }}
      onFocusCapture={window.onFocusCapture}
      onBlurCapture={window.onBlurCapture}
    >
      {/* A non-interactive CSS ruler, not a session: measure responsive row height without mounting content. */}
      <li ref={window.measure} aria-hidden className={cn(rowClassName, "invisible absolute")} />
      {window.indices.map((index) => (
        <SessionRow
          key={sessionKey(sessions[index])}
          t={sessions[index]}
          details={details}
          rowClassName={rowClassName}
          select={select}
          top={window.top(index)}
          index={index}
          count={sessions.length}
          onMenuChange={window.onMenuChange}
        />
      ))}
    </ul>
  );
}

/**
 * One session: its title, and its folder and branch beneath when View options shows them. The
 * project lives in the groupings.
 */
const SessionRow = memo(
  function SessionRow({
    t,
    details,
    rowClassName,
    select,
    top,
    index,
    count,
    onMenuChange,
  }: {
    t: SessionEntry;
    details: SessionRowDetails | undefined;
    rowClassName: string;
    top: number;
    index: number;
    count: number;
    onMenuChange: (key: string, open: boolean) => void;
  } & Pick<Navigation, "select">) {
    const target = { cwd: t.cwd, sessionId: t.sessionId, title: t.title };
    const { selected, disabled, hint, activity } = t;
    // The keys play while the session works; afterwards Herdr's dots: tidal-blue done, hollow sage idle, nothing when no process.
    const dot = activity === "done" ? "bg-done" : activity === "idle" ? "border border-ok" : null;
    return (
      <li
        data-row
        data-session-key={sessionKey(t)}
        aria-posinset={index + 1}
        aria-setsize={count}
        style={{ position: "absolute", top, left: 0, right: 0 }}
        className={cn(
          rowClassName,
          // The menu shows from md up; the phone opens a session's sheet instead.
          "group relative flex items-center rounded-lg pr-1 hover:bg-fill-hover md:[--row-actions:1.75rem]",
          selected && "bg-(--selected) hover:bg-(--selected)",
        )}
      >
        <button
          type="button"
          title={hint}
          aria-current={selected ? "page" : undefined}
          disabled={disabled}
          onClick={() => select(t.cwd, t.sessionId)}
          // A grid, so the glyph centres on the title's line whether or not a details line follows.
          className="grid h-full min-w-0 flex-1 grid-cols-[1rem_minmax(0,1fr)] content-center items-center gap-x-2 rounded-md pl-(--glyph-pad) text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset disabled:text-ink-3"
        >
          <span className="flex size-4 items-center justify-center" aria-hidden>
            {activity === "working" ? (
              <Keys playing className="text-brand" />
            ) : (
              dot && <span className={cn("size-2 rounded-full", dot)} />
            )}
          </span>
          <span
            data-motion="yield"
            className={cn(
              "min-w-0 flex-1 truncate",
              selected && "font-medium",
              !t.title && "text-ink-3",
            )}
          >
            {t.label}
          </span>
          {details && (
            <span
              data-motion="yield"
              className="col-start-2 flex min-w-0 items-center gap-2 text-xs text-ink-3"
            >
              {details === "folder-and-branch" && (
                <span className="max-w-1/2 shrink-0 truncate">
                  <span className="sr-only">Folder: </span>
                  {t.folder}
                </span>
              )}
              {t.branch && (
                <>
                  <span className="sr-only">Git branch: </span>
                  <BranchLabel branch={t.branch} className="min-w-0" />
                </>
              )}
            </span>
          )}
          {activity === "working" ? (
            <span className="sr-only">working</span>
          ) : activity === "done" ? (
            <span className="sr-only">done</span>
          ) : null}
          {hint && <span className="sr-only">{hint}</span>}
        </button>
        <RowActions className="inset-y-0 right-1 max-md:hidden">
          <DropdownMenu
            onOpenChange={(open) => {
              if (open) onMenuChange(sessionKey(t), true);
            }}
          >
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="row" aria-label={`Session menu for ${t.label}`}>
                <MoreHorizontalIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              // Keep the anchor through Radix's close/focus-restore lifecycle, not just open=false.
              onCloseAutoFocus={() => onMenuChange(sessionKey(t), false)}
            >
              <SessionMenu target={target} />
            </DropdownMenuContent>
          </DropdownMenu>
        </RowActions>
      </li>
    );
  },
  (previous, next) =>
    previous.select === next.select &&
    previous.details === next.details &&
    previous.rowClassName === next.rowClassName &&
    previous.top === next.top &&
    previous.index === next.index &&
    previous.count === next.count &&
    previous.onMenuChange === next.onMenuChange &&
    // Compare every catalog field, not the changing AppState.
    Object.keys(previous.t).every(
      (key) => previous.t[key as keyof SessionEntry] === next.t[key as keyof SessionEntry],
    ),
);

/** Closed row menus must not subscribe to every streamed token or compute commands. */
function SessionMenu({
  target,
}: {
  target: { cwd: string; sessionId: string; title: string | undefined };
}) {
  const { state } = useCommands();
  const { commands, run } = useSessionCommands(target);
  const { sections, destructive } = sessionRowMenu(commands);
  return (
    <>
      {sections.map((section) => (
        <Fragment key={section[0]?.id}>
          <DropdownMenuGroup>
            {section.map((c) => (
              <SessionCommandMenuItem key={c.id} command={c} run={run} />
            ))}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
        </Fragment>
      ))}
      <DropdownMenuGroup>
        <ProjectMenu menu={sessionProjectMenu(state, target)} run={run} />
      </DropdownMenuGroup>
      {destructive.length > 0 && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            {destructive.map((c) => (
              <SessionCommandMenuItem key={c.id} command={c} run={run} />
            ))}
          </DropdownMenuGroup>
        </>
      )}
    </>
  );
}
