import { cn } from "cn";
import { MoreHorizontalIcon } from "lucide-react";
import { Fragment, memo } from "react";
import { SessionCommandMenuItem, useCommands, useSessionCommands } from "@/components/CommandHost";
import { PianoButton as Button } from "@/components/PianoButton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/PianoDropdownMenu";
import { Keys } from "@/components/PianoMark";
import { ProjectMenu } from "@/components/Projects";
import { RowActions } from "@/components/RowActions";
import { SessionDetails } from "@/components/SessionDetails";
import type { Navigation } from "@/lib/navigation";
import { sessionProjectMenu } from "@/lib/projectCommands";
import type { SessionEntry } from "@/lib/sessionCatalog";
import { sessionRowMenu } from "@/lib/sessionCommands";
import type { SessionRowDetails } from "@/lib/sidebarList";
import { useSidebarWindow } from "@/lib/useSidebarWindow";
import { sessionKey } from "@/store";

export const sidebarRowClassName = "h-8 pointer-coarse:h-11 max-md:h-12";
const detailedRowClassName = "h-11 pointer-coarse:h-14 max-md:h-15";
export const sidebarRowGapClassName = "gap-1 md:gap-0.5";

export function SidebarSessionList({
  sessions,
  selectionId,
  grouped = false,
  details,
  select,
}: Pick<Navigation, "select"> & {
  sessions: readonly SessionEntry[];
  selectionId: string | null;
  grouped?: boolean;
  details?: SessionRowDetails;
}) {
  const window = useSidebarWindow(sessions, selectionId);
  const rowClassName = details ? detailedRowClassName : sidebarRowClassName;
  return (
    <ul
      ref={window.list}
      className={cn("relative flex flex-col", sidebarRowGapClassName, grouped && "py-1")}
      style={{ height: window.height }}
      onFocusCapture={window.onFocusCapture}
      onBlurCapture={window.onBlurCapture}
    >
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
    const target = { cwd: t.cwd, sessionId: t.sessionId, title: t.title, hint: t.hint };
    const { selected, disabled, hint, activity } = t;
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
          "group relative flex items-center rounded-lg pr-1 hover:bg-fill-hover",
          disabled ? "[--row-actions:1.75rem]" : "md:[--row-actions:1.75rem]",
          selected && "bg-(--selected) hover:bg-(--selected)",
        )}
      >
        <button
          type="button"
          title={hint}
          aria-current={selected ? "page" : undefined}
          disabled={disabled}
          onClick={() => select(t.cwd, t.sessionId)}
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
              <SessionDetails
                folder={details === "folder-and-branch" ? t.folder : undefined}
                branch={t.branch}
              />
            </span>
          )}
          {activity === "working" ? (
            <span className="sr-only">working</span>
          ) : activity === "done" ? (
            <span className="sr-only">done</span>
          ) : null}
          {hint && <span className="sr-only">{hint}</span>}
        </button>
        <RowActions className={cn("inset-y-0 right-1", !disabled && "max-md:hidden")}>
          <DropdownMenu
            onOpenChange={(open) => {
              if (open) onMenuChange(sessionKey(t), true);
            }}
            onOpenChangeComplete={(open) => {
              if (!open) onMenuChange(sessionKey(t), false);
            }}
          >
            <DropdownMenuTrigger
              render={
                <Button variant="ghost" size="row" aria-label={`Session menu for ${t.label}`} />
              }
            >
              <MoreHorizontalIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
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
    Object.keys(previous.t).every(
      (key) => previous.t[key as keyof SessionEntry] === next.t[key as keyof SessionEntry],
    ),
);

export function SessionMenu({
  target,
}: {
  target: { cwd: string; sessionId: string; title: string | undefined; hint?: string | undefined };
}) {
  const { state } = useCommands();
  const { commands, run } = useSessionCommands(target);
  const { sections } = sessionRowMenu(commands);
  return (
    <>
      {target.hint && (
        <>
          <DropdownMenuGroup>
            <DropdownMenuLabel className="max-w-72 font-normal text-ink-3">
              {target.hint}
            </DropdownMenuLabel>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
        </>
      )}
      {sections.map((section, i) => (
        <Fragment key={section === "project" ? section : section[0]?.id}>
          {i > 0 && <DropdownMenuSeparator />}
          <DropdownMenuGroup>
            {section === "project" ? (
              <ProjectMenu menu={sessionProjectMenu(state, target)} run={run} />
            ) : (
              section.map((c) => <SessionCommandMenuItem key={c.id} command={c} run={run} />)
            )}
          </DropdownMenuGroup>
        </Fragment>
      ))}
    </>
  );
}
