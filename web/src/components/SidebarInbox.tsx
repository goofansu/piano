import { cn } from "cn";
import { useSyncExternalStore } from "react";
import { Keys } from "@/components/PianoMark";
import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { timeAgoShort } from "@/lib/format";
import { type InboxItem, type InboxKind, inboxList } from "@/lib/inbox";
import { useMachineScope } from "@/lib/useMachine";
import { useNavigation } from "@/lib/useNavigation";
import { type AppState, isSession, sessionKey } from "@/store";
import { sessionPath } from "../../../shared/sessionLink.ts";

/** The Inbox's groups in order, each named by its sessions' state, with that state's dot. */
const GROUPS: ReadonlyArray<{ kind: InboxKind; label: string; dot: string | null }> = [
  { kind: "needs_input", label: "Needs input", dot: "bg-warn" },
  { kind: "failed", label: "Pi stopped", dot: "bg-err" },
  { kind: "done", label: "Done", dot: "bg-done" },
  // The keys play while a session works, as on its row in the machine's own list.
  { kind: "working", label: "Working", dot: null },
];

/** How many sessions need the person, on any machine: what the Inbox button counts. */
export function useInboxCount(): number {
  const { inbox } = useMachineScope();
  const state = useSyncExternalStore(inbox.subscribe, inbox.getState);
  return inboxList(state).attention.length;
}

/**
 * One session: its title, where it runs beneath (its machine when there is more than one, then
 * its folder), and how long ago at the end. Its group names its state, so the row repeats only
 * the dot. Opening it switches to its machine; a stop's reason waits in the row's tooltip.
 */
function InboxRow({
  item,
  dot,
  selected,
  showMachine,
  now,
}: {
  item: InboxItem;
  dot: string | null;
  selected: boolean;
  showMachine: boolean;
  now: number;
}) {
  const { machine, switchMachine, inbox } = useMachineScope();
  const { select } = useNavigation();
  return (
    <li
      className={cn(
        "flex rounded-lg hover:bg-fill-hover",
        selected && "bg-(--selected) hover:bg-(--selected)",
      )}
    >
      <button
        type="button"
        title={item.detail}
        aria-current={selected ? "page" : undefined}
        onClick={() => {
          inbox.seen(item.machine.id, sessionKey(item));
          if (item.machine.id === machine.id) select(item.cwd, item.sessionId);
          else switchMachine(item.machine.id, sessionPath(item.sessionId));
        }}
        // A grid, so the glyph centres on the title's line and the context line sits under the title.
        className="grid min-w-0 flex-1 grid-cols-[1rem_minmax(0,1fr)_auto] items-center gap-x-2 rounded-md py-1.5 pr-2 pl-(--glyph-pad) text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        <span className="flex size-4 items-center justify-center" aria-hidden>
          {dot ? (
            <span className={cn("size-2 rounded-full", dot)} />
          ) : (
            <Keys playing className="text-brand" />
          )}
        </span>
        <span className={cn("min-w-0 truncate", selected && "font-medium")}>{item.label}</span>
        <time dateTime={item.at} className="row-span-2 self-center text-xs text-ink-3 tabular-nums">
          {timeAgoShort(item.at, now)}
        </time>
        <span className="col-start-2 min-w-0 truncate text-xs text-ink-3">
          {[showMachine && item.machine.name, item.folder].filter(Boolean).join(" · ")}
        </span>
      </button>
    </li>
  );
}

/**
 * The sidebar as the Inbox: sessions from Local and every peer, grouped by what they are doing
 * (Needs input, Pi stopped, Done, then Working), newest first in each. A machine whose connection
 * is down is named last, since its sessions may be missing.
 */
export function SidebarInbox({ state }: { state: AppState }) {
  const { inbox, machine } = useMachineScope();
  const observed = useSyncExternalStore(inbox.subscribe, inbox.getState);
  const list = inboxList(observed);
  const now = Date.now();
  const current = state.view.kind === "session" ? (state.session ?? state.selecting) : null;
  const items = [...list.attention, ...list.working];
  const heading = "px-(--glyph-pad) pt-3 pb-1 text-xs font-medium text-ink-3";
  if (list.loading)
    return (
      <div aria-hidden className="late-enter flex flex-col gap-2 px-(--glyph-pad) pt-3">
        <Skeleton className="h-3.5 w-16" />
        <Skeleton className="h-8 w-full rounded-lg" />
        <Skeleton className="h-8 w-full rounded-lg" />
      </div>
    );
  return (
    <div className="flex flex-col gap-1">
      {items.length === 0 && (
        <Empty className="py-8">
          <EmptyHeader>
            <EmptyDescription>No sessions need you</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
      {GROUPS.map(({ kind, label, dot }) => {
        const rows = items.filter((item) => item.kind === kind);
        if (rows.length === 0) return null;
        return (
          <div key={kind} role="group" aria-labelledby={`inbox-${kind}`}>
            <div id={`inbox-${kind}`} className={heading}>
              {label}
            </div>
            <ul className="flex flex-col gap-0.5">
              {rows.map((item) => (
                <InboxRow
                  key={`${item.machine.id}\0${item.cwd}\0${item.sessionId}`}
                  item={item}
                  dot={dot}
                  selected={item.machine.id === machine.id && isSession(current, item)}
                  showMachine={observed.machines.length > 1}
                  now={now}
                />
              ))}
            </ul>
          </div>
        );
      })}
      {list.unavailable.length > 0 && (
        <div role="group" aria-labelledby="inbox-unavailable">
          <div id="inbox-unavailable" className={heading}>
            Unavailable
          </div>
          <ul className="flex flex-col">
            {list.unavailable.map((m) => (
              <li key={m.id} className="truncate py-1.5 pl-(--glyph-pad) text-sm text-ink-3">
                {m.name}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
