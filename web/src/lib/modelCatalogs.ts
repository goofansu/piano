/**
 * Each directory's model catalog as the picker uses it. Catalogs outlive reloads: the page seeds
 * them from this browser's storage, so the picker opens at once, and keeps storing each one Pi
 * sends unless it reports an error. A refresh re-probes Pi and stays pending until its own
 * terminal reply arrives or the connection drops. Saving Pi's defaults for new
 * sessions is one request at a time, reported once. The client's store stays the source of the
 * server-pushed catalogs; nothing here depends on React.
 */
import type { ClientCommand, ModelCatalog, ServerMessage, ThinkingLevel } from "@shared/wire";
import type { Notify } from "./client.ts";
import { readJson, writeJson } from "./storage.ts";

export type Catalogs = Readonly<Record<string, ModelCatalog>>;

/** Where catalogs outlive a reload. */
export interface CatalogStorage {
  read: () => Catalogs;
  write: (catalogs: Catalogs) => void;
}

const CATALOGS_KEY = "piano.catalogs";
/** This browser's storage; without it the server's cache still answers. */
export const browserCatalogStorage: CatalogStorage = {
  read: () => readJson<Catalogs>(CATALOGS_KEY, {}),
  write: (catalogs) => writeJson(CATALOGS_KEY, catalogs),
};

/** The connection to follow; the page's `Client` is one. */
export interface CatalogSource {
  getState: () => { connected: boolean; catalogs: Catalogs };
  subscribe: (listener: () => void) => () => void;
  send: (command: ClientCommand) => void;
  listen: (listener: (message: ServerMessage) => void) => () => void;
}

export interface ModelCatalogsOptions {
  storage: CatalogStorage;
  notify: Notify;
  /** Pi's saved defaults for new sessions; rejects when Pi did not save them. */
  saveDefaults: (model: string | undefined, effort: ThinkingLevel) => Promise<unknown>;
}

export interface ModelCatalogsState {
  catalogs: Catalogs;
  connected: boolean;
  /** Directories with a refresh in flight, each with its request ID. */
  refreshing: Readonly<Record<string, string>>;
  saving: boolean;
}

/** What one directory's picker shows and can do. */
export interface ModelCatalogView {
  /** `null` until Pi answers (or a stored catalog seeds it). */
  catalog: ModelCatalog | null;
  refreshing: boolean;
  /** Re-probes Pi, e.g. after adding a provider or signing in; absent without a directory. */
  refresh?: () => void;
  saving: boolean;
  saveDefaults: (model: string | undefined, effort: ThinkingLevel) => Promise<void>;
}

export interface ModelCatalogs {
  getState: () => ModelCatalogsState;
  subscribe: (listener: () => void) => () => void;
  /** The stored catalogs, for the client's initial state. */
  seed: () => Catalogs;
  /** Tracks `source`'s catalogs and connection; returns the stop function. */
  follow: (source: CatalogSource) => () => void;
  refresh: (cwd: string) => void;
  saveDefaults: (model: string | undefined, effort: ThinkingLevel) => Promise<void>;
  /** One directory's picker, from a state this module produced. */
  view: (state: ModelCatalogsState, cwd: string | undefined) => ModelCatalogView;
}

const withoutErrors = (catalogs: Catalogs): Catalogs =>
  Object.fromEntries(Object.entries(catalogs).filter(([, catalog]) => !catalog.error));

export function createModelCatalogs({
  storage,
  notify,
  saveDefaults: save,
}: ModelCatalogsOptions): ModelCatalogs {
  const seeded = storage.read();
  let state: ModelCatalogsState = {
    catalogs: seeded,
    connected: false,
    refreshing: {},
    saving: false,
  };
  let source: CatalogSource | null = null;
  const listeners = new Set<() => void>();

  const set = (next: ModelCatalogsState) => {
    if (next === state) return;
    state = next;
    for (const listener of listeners) listener();
  };

  /** A background catalog or a late reply cannot finish a different explicit refresh. */
  const settle = (message: ServerMessage) => {
    if (message._tag !== "models" && message._tag !== "models_failed") return;
    const cwd = message._tag === "models" ? message.catalog.cwd : message.cwd;
    if (message.requestId === undefined) {
      if (message._tag === "models_failed") notify(message.message, "error");
      return;
    }
    if (state.refreshing[cwd] !== message.requestId) return;
    const refreshing = { ...state.refreshing };
    delete refreshing[cwd];
    set({ ...state, refreshing });
    if (message._tag === "models_failed") notify(message.message, "error");
  };

  const sync = () => {
    if (!source) return;
    const { connected, catalogs } = source.getState();
    if (catalogs === state.catalogs && connected === state.connected) return;
    if (catalogs !== state.catalogs) storage.write(withoutErrors(catalogs));
    set({
      ...state,
      catalogs,
      connected,
      refreshing: connected ? state.refreshing : {},
    });
  };

  const refresh = (cwd: string) => {
    // Offline, nothing will answer; the next connection asks again on its own.
    if (!source || !state.connected || state.refreshing[cwd] !== undefined) return;
    const requestId = crypto.randomUUID();
    set({ ...state, refreshing: { ...state.refreshing, [cwd]: requestId } });
    source.send({ _tag: "models", cwd, refresh: true, requestId });
  };

  // Pi owns the saved defaults; its catalog invalidation updates every picker's default.
  const saveDefaults = async (model: string | undefined, effort: ThinkingLevel) => {
    if (state.saving) return;
    set({ ...state, saving: true });
    try {
      await save(model, effort);
      notify("Defaults saved for new sessions.", "success");
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Could not save defaults. Try again.",
        "error",
      );
    } finally {
      set({ ...state, saving: false });
    }
  };

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    seed: () => seeded,
    follow: (next) => {
      source = next;
      sync();
      const unsubscribe = next.subscribe(sync);
      const unlisten = next.listen(settle);
      return () => {
        unsubscribe();
        unlisten();
        if (source === next) source = null;
      };
    },
    refresh,
    saveDefaults,
    view: (s, cwd) => ({
      catalog: (cwd && s.catalogs[cwd]) || null,
      refreshing: !!cwd && s.refreshing[cwd] !== undefined,
      refresh: cwd ? () => refresh(cwd) : undefined,
      saving: s.saving,
      saveDefaults,
    }),
  };
}
