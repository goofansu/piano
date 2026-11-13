/**
 * The Inbox: the sessions that need the person, from every machine at once (ADR 0004, Inbox).
 * Main's browser keeps one listing-only connection to each machine, Local's included, and reads
 * only the two frames every connection already gets: the registry (which sessions exist) and
 * hosts (which run, wait for an answer or stopped). Nothing is selected, sent or stored: each
 * machine owns its sessions, and this is a projection of them for one page load (INV-01/07).
 */
import type {
  FolderView,
  HostInfo,
  Project,
  ServerMessage,
  SessionReference,
  StoppedSession,
} from "@shared/wire";
// Relative, not @shared: module tests load this file directly in Node.
import { sessionKey } from "../../../shared/wire.ts";
import { initialState } from "../store.ts";
import type { Machine } from "./machine.ts";
import { sessionCatalog } from "./sessionCatalog.ts";
import type { Connection, ConnectionHandlers } from "./ws.ts";

/** Why a session is listed. The first three need the person; `working` is shown beneath them. */
export type InboxKind = "needs_input" | "failed" | "done" | "working";

export interface InboxItem {
  machine: Machine;
  cwd: string;
  sessionId: string;
  /** What the session is called on screen (`sessionLabel`). */
  label: string;
  folder: string;
  branch: string;
  kind: InboxKind;
  /** Why Pi stopped, in the closure's own words; `failed` only. */
  detail?: string;
  /** ISO time the row is dated from: when Pi stopped, when the turn finished, else the session's
   * last recorded activity. */
  at: string;
}

/** What one machine's connection has said so far. */
export interface MachineObservation {
  connected: boolean;
  /** The last socket failed to open or closed, and none has opened since. */
  unreachable: boolean;
  /** The machine has sent its registry at least once. */
  loaded: boolean;
  folders: readonly FolderView[];
  projects: readonly Project[];
  sessionReferences: readonly SessionReference[];
  hosts: readonly HostInfo[];
  stopped: readonly StoppedSession[];
  /** Sessions whose turn finished while they were not on screen, with when; gone once opened. */
  done: Readonly<Record<string, string>>;
  /** The `at` of each stop the person has since opened the session for. */
  seenStopped: Readonly<Record<string, string>>;
  /** The session on screen on this machine, if it is the selected one. */
  viewing: string | null;
}

export const unobserved: MachineObservation = {
  connected: false,
  unreachable: false,
  loaded: false,
  folders: [],
  projects: [],
  sessionReferences: [],
  hosts: [],
  stopped: [],
  done: {},
  seenStopped: {},
  viewing: null,
};

export type Observed =
  | { type: "status"; connected: boolean }
  | { type: "server"; message: ServerMessage; now: string }
  /** The session on screen on this machine changed; null when none is, or the machine is not selected. */
  | { type: "viewing"; key: string | null }
  /** The person opened the session from its row, whether or not it can be shown. */
  | { type: "seen"; key: string };

const without = <V>(record: Readonly<Record<string, V>>, key: string) => {
  if (!(key in record)) return record;
  const { [key]: _, ...rest } = record;
  return rest;
};

/** Opening a session answers what the Inbox said of it: its finished turn and its stop are seen. */
function seen(o: MachineObservation, key: string): MachineObservation {
  const stop = o.stopped.find((s) => sessionKey(s.cwd, s.sessionId) === key);
  const done = without(o.done, key);
  const seenStopped =
    stop && o.seenStopped[key] !== stop.at ? { ...o.seenStopped, [key]: stop.at } : o.seenStopped;
  return done === o.done && seenStopped === o.seenStopped ? o : { ...o, done, seenStopped };
}

export function observe(o: MachineObservation, event: Observed): MachineObservation {
  switch (event.type) {
    case "status":
      // What was last heard stays listed while a connection is retried; `unreachable` says so.
      return { ...o, connected: event.connected, unreachable: !event.connected };
    case "seen":
      return seen(o, event.key);
    case "viewing": {
      const next = event.key === o.viewing ? o : { ...o, viewing: event.key };
      return event.key === null ? next : seen(next, event.key);
    }
    case "server": {
      const m = event.message;
      if (m._tag === "registry")
        return {
          ...o,
          loaded: true,
          folders: m.folders,
          projects: m.projects ?? [],
          sessionReferences: m.sessionReferences ?? [],
        };
      if (m._tag !== "hosts") return o;
      // A host that was working and no longer is has finished a turn (the sidebar's rule).
      const done = { ...o.done };
      for (const prev of o.hosts) {
        if (!prev.working) continue;
        const key = sessionKey(prev.cwd, prev.sessionId);
        const now = m.hosts.find((h) => sessionKey(h.cwd, h.sessionId) === key);
        if (now && !now.working && key !== o.viewing) done[key] = event.now;
      }
      const next = { ...o, hosts: m.hosts, stopped: m.stopped ?? [], done };
      return o.viewing === null ? next : seen(next, o.viewing);
    }
  }
}

export interface InboxState {
  /** The machines observed, in the switcher's order. */
  machines: readonly Machine[];
  observations: Readonly<Record<string, MachineObservation>>;
}

export interface InboxList {
  /** Sessions that need the person, newest first. */
  attention: InboxItem[];
  /** Sessions at work, newest first. */
  working: InboxItem[];
  /** Machines whose connection is down: their rows may be out of date or missing. */
  unavailable: Machine[];
  /** No machine has answered yet. */
  loading: boolean;
}

const newestFirst = (a: InboxItem, b: InboxItem) =>
  (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0);

function machineItems(machine: Machine, o: MachineObservation): InboxItem[] {
  const hosts = new Map(o.hosts.map((h) => [sessionKey(h.cwd, h.sessionId), h]));
  const stopped = new Map(o.stopped.map((s) => [sessionKey(s.cwd, s.sessionId), s]));
  // The catalog's own rules name a session and its folder, and leave archived ones out.
  const catalog = sessionCatalog({
    ...initialState,
    folders: [...o.folders],
    projects: [...o.projects],
    sessionReferences: [...o.sessionReferences],
    hosts: [...o.hosts],
  });
  const items: InboxItem[] = [];
  for (const entry of catalog) {
    const key = sessionKey(entry.cwd, entry.sessionId);
    const host = hosts.get(key);
    const stop = host ? undefined : stopped.get(key);
    const kind: InboxKind | undefined = host?.needsInput
      ? "needs_input"
      : host?.working || host?.starting
        ? "working"
        : stop && o.seenStopped[key] !== stop.at
          ? "failed"
          : key in o.done
            ? "done"
            : undefined;
    if (!kind) continue;
    items.push({
      machine,
      cwd: entry.cwd,
      sessionId: entry.sessionId,
      label: entry.label,
      folder: entry.folder,
      branch: entry.branch,
      kind,
      ...(kind === "failed" && stop ? { detail: stop.detail } : {}),
      at: kind === "failed" && stop ? stop.at : kind === "done" ? o.done[key] : entry.updatedAt,
    });
  }
  return items;
}

export function inboxList({ machines, observations }: InboxState): InboxList {
  const all = machines.flatMap((machine) =>
    machineItems(machine, observations[machine.id] ?? unobserved),
  );
  return {
    attention: all.filter((item) => item.kind !== "working").sort(newestFirst),
    working: all.filter((item) => item.kind === "working").sort(newestFirst),
    unavailable: machines.filter((machine) => observations[machine.id]?.unreachable),
    loading: machines.length > 0 && machines.every((machine) => !observations[machine.id]?.loaded),
  };
}

export interface Inbox {
  getState: () => InboxState;
  subscribe: (listener: () => void) => () => void;
  /**
   * The machines to observe: one connection each, opened for a machine new to the list and closed
   * for one that left it.
   */
  setMachines: (machines: readonly Machine[]) => void;
  /** The session on screen on `machineId`, by its `sessionKey`; null when it shows none. */
  viewing: (machineId: string, key: string | null) => void;
  /**
   * The person opened this session from its row: its finished turn and its stop are answered,
   * also for a session that cannot be shown (history gone), which would otherwise stay listed.
   */
  seen: (machineId: string, key: string) => void;
  /** Closes every connection. */
  stop: () => void;
}

export function createInbox({
  connect,
  now = () => new Date().toISOString(),
}: {
  /** Opens the machine's auto-reconnecting connection (`openConnection` on its socket). */
  connect: (machineId: string, handlers: ConnectionHandlers) => Connection;
  now?: () => string;
}): Inbox {
  let state: InboxState = { machines: [], observations: {} };
  const connections = new Map<string, Connection>();
  /** Told before the machine is observed, such as the selected machine's session on first load. */
  const viewed = new Map<string, string | null>();
  const listeners = new Set<() => void>();
  const apply = (machineId: string, event: Observed) => {
    const current = state.observations[machineId];
    // A frame that arrives after its machine left the list changes nothing.
    if (!current) return;
    const next = observe(current, event);
    if (next === current) return;
    state = { ...state, observations: { ...state.observations, [machineId]: next } };
    for (const listener of listeners) listener();
  };
  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setMachines: (list) => {
      const machines = list;
      const observations: Record<string, MachineObservation> = {};
      for (const machine of machines)
        observations[machine.id] = state.observations[machine.id] ?? {
          ...unobserved,
          viewing: viewed.get(machine.id) ?? null,
        };
      for (const [id, connection] of connections) {
        if (id in observations) continue;
        connection.close();
        connections.delete(id);
      }
      state = { machines, observations };
      for (const { id } of machines) {
        if (connections.has(id)) continue;
        connections.set(
          id,
          connect(id, {
            onStatus: (connected) => apply(id, { type: "status", connected }),
            onMessage: (message) => apply(id, { type: "server", message, now: now() }),
          }),
        );
      }
      for (const listener of listeners) listener();
    },
    viewing: (machineId, key) => {
      viewed.set(machineId, key);
      apply(machineId, { type: "viewing", key });
    },
    seen: (machineId, key) => apply(machineId, { type: "seen", key }),
    stop: () => {
      for (const connection of connections.values()) connection.close();
      connections.clear();
    },
  };
}
