import { InboxIcon } from "lucide-react";
import { useSyncExternalStore } from "react";
import { PaneBody, PaneHeader, PaneHeading } from "@/components/Pane";
import { ListRow } from "@/components/RowActions";
import { SettingsGroup, SettingsList } from "@/components/SettingsSectionFrame";
import { StatusDot, type StatusTone } from "@/components/StatusDot";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { ItemDescription } from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { timeAgo } from "@/lib/format";
import { type InboxItem, type InboxKind, inboxList } from "@/lib/inbox";
import { useMachineScope } from "@/lib/useMachine";
import { useNavigation } from "@/lib/useNavigation";
import { sessionKey } from "@/store";
import { sessionPath } from "../../../shared/sessionLink.ts";

/** Each reason a session is listed: its dot and the word beside it. */
const KINDS: Record<InboxKind, { tone: StatusTone; word: string }> = {
  needs_input: { tone: "warn", word: "Needs input" },
  failed: { tone: "err", word: "Pi stopped" },
  done: { tone: "done", word: "Done" },
  working: { tone: "busy", word: "Working" },
};

/** The sessions the Inbox counts: the ones that need the person, on any machine. */
export function useInboxCount(): number {
  const { inbox } = useMachineScope();
  const state = useSyncExternalStore(inbox.subscribe, inbox.getState);
  return inboxList(state).attention.length;
}

/**
 * One session's row: its name opens it, on its own machine; under it why it is listed, then
 * where it runs. A stop's reason waits in the row's tooltip.
 */
function InboxRow({ item, now }: { item: InboxItem; now: number }) {
  const { machine, switchMachine, inbox } = useMachineScope();
  const { select } = useNavigation();
  const { tone, word } = KINDS[item.kind];
  return (
    <ListRow
      title={item.label}
      open={{
        hint: item.detail,
        onOpen: () => {
          inbox.seen(item.machine.id, sessionKey(item));
          if (item.machine.id === machine.id) select(item.cwd, item.sessionId);
          else switchMachine(item.machine.id, sessionPath(item.sessionId));
        },
      }}
      time={{ at: item.at, text: timeAgo(item.at, now) }}
    >
      <ItemDescription className="flex min-w-0 items-center gap-1.5 text-xs">
        <StatusDot tone={tone} />
        <span className="shrink-0 text-ink-2">{word}</span>
        <span className="truncate">
          {[item.machine.name, item.folder, item.branch].filter(Boolean).join(" · ")}
        </span>
      </ItemDescription>
    </ListRow>
  );
}

/**
 * The Inbox: a listing page shaped as the Projects index is. Sessions that need the person lead
 * (needs input, Pi stopped, done since last opened), newest first; the ones at work follow under
 * Working. A machine whose connection is down is named last, since its rows may be missing.
 * Every machine is listed whichever one is selected; opening a row switches to its machine.
 */
export function Inbox() {
  const { inbox } = useMachineScope();
  const state = useSyncExternalStore(inbox.subscribe, inbox.getState);
  const list = inboxList(state);
  const now = Date.now();
  const rows = (items: InboxItem[]) =>
    items.map((item) => (
      <InboxRow key={`${item.machine.id}\0${item.cwd}\0${item.sessionId}`} item={item} now={now} />
    ));
  return (
    <>
      <PaneHeader>
        <PaneHeading>
          <h1 className="truncate text-sm font-medium">Inbox</h1>
        </PaneHeading>
      </PaneHeader>
      <PaneBody>
        <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6">
          {list.loading ? (
            <div aria-hidden className="late-enter flex flex-col gap-2">
              <Skeleton className="h-14 w-full rounded-lg" />
              <Skeleton className="h-14 w-full rounded-lg" />
            </div>
          ) : (
            <>
              {list.attention.length > 0 ? (
                <SettingsList aria-label="Sessions that need you">
                  {rows(list.attention)}
                </SettingsList>
              ) : (
                <Empty className="py-8">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <InboxIcon aria-hidden />
                    </EmptyMedia>
                    <EmptyTitle>No sessions need you</EmptyTitle>
                  </EmptyHeader>
                </Empty>
              )}
              {list.working.length > 0 && (
                <SettingsGroup id="inbox-working" title="Working">
                  <SettingsList aria-labelledby="inbox-working-title">
                    {rows(list.working)}
                  </SettingsList>
                </SettingsGroup>
              )}
              {list.unavailable.length > 0 && (
                <SettingsGroup id="inbox-unavailable" title="Unavailable">
                  <SettingsList aria-labelledby="inbox-unavailable-title">
                    {list.unavailable.map((machine) => (
                      <ListRow key={machine.id} title={machine.name} />
                    ))}
                  </SettingsList>
                </SettingsGroup>
              )}
            </>
          )}
        </div>
      </PaneBody>
    </>
  );
}
