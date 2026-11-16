import type { ClientCommand, ModelCatalog, ServerMessage, ThinkingLevel } from "@shared/wire";
import type { Notify } from "./client.ts";
import { machineMemory } from "./machineMemory.ts";
import { parseJson } from "./preference.ts";

export type Catalogs = Readonly<Record<string, ModelCatalog>>;

export interface CatalogStorage {
  read: () => Catalogs;
  write: (catalogs: Catalogs) => void;
}

export function browserCatalogStorage(machineId: string): CatalogStorage {
  const memory = machineMemory(machineId, "catalogs");
  return {
    read: () => (parseJson(memory.read()) ?? {}) as Catalogs,
    write: (catalogs) => memory.write(JSON.stringify(catalogs)),
  };
}

export interface CatalogSource {
  getState: () => { connected: boolean; catalogs: Catalogs };
  subscribe: (listener: () => void) => () => void;
  send: (command: ClientCommand) => void;
  listen: (listener: (message: ServerMessage) => void) => () => void;
}

export interface ModelCatalogsOptions {
  storage: CatalogStorage;
  notify: Notify;
  saveDefaults: (model: string | undefined, effort: ThinkingLevel) => Promise<void>;
  confirmMs?: number;
}

export interface ModelCatalogsState {
  catalogs: Catalogs;
  connected: boolean;
  refreshing: Readonly<Record<string, string>>;
  saving: boolean;
}

export interface ModelCatalogView {
  catalog: ModelCatalog | null;
  refreshing: boolean;
  refresh?: () => void;
  saving: boolean;
  saveDefaults: (model: string | undefined, effort: ThinkingLevel) => Promise<void>;
}

export interface ModelCatalogs {
  getState: () => ModelCatalogsState;
  subscribe: (listener: () => void) => () => void;
  seed: () => Catalogs;
  follow: (source: CatalogSource) => () => void;
  refresh: (cwd: string) => void;
  saveDefaults: (model: string | undefined, effort: ThinkingLevel) => Promise<void>;
  view: (state: ModelCatalogsState, cwd: string | undefined) => ModelCatalogView;
}

const withoutErrors = (catalogs: Catalogs): Catalogs =>
  Object.fromEntries(Object.entries(catalogs).filter(([, catalog]) => !catalog.error));

export function createModelCatalogs({
  storage,
  notify,
  saveDefaults: save,
  confirmMs = 5000,
}: ModelCatalogsOptions): ModelCatalogs {
  const seeded = storage.read();
  let state: ModelCatalogsState = {
    catalogs: seeded,
    connected: false,
    refreshing: {},
    saving: false,
  };
  let source: CatalogSource | null = null;
  let confirming: {
    model?: string;
    effort: ThinkingLevel;
    since: Catalogs;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;
  const listeners = new Set<() => void>();

  const set = (next: ModelCatalogsState) => {
    if (next === state) return;
    state = next;
    for (const listener of listeners) listener();
  };

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

  const shown = (
    catalogs: Catalogs,
    since: Catalogs,
    model: string | undefined,
    effort: ThinkingLevel,
  ) =>
    Object.entries(catalogs).some(
      ([cwd, c]) =>
        c !== since[cwd] &&
        !c.error &&
        (model === undefined || c.defaultModel === model) &&
        c.defaultThinkingLevel === effort,
    );

  const confirmed = () => {
    if (confirming) clearTimeout(confirming.timer);
    confirming = null;
    set({ ...state, saving: false });
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
    if (
      confirming &&
      (!connected || shown(catalogs, confirming.since, confirming.model, confirming.effort))
    )
      confirmed();
  };

  const refresh = (cwd: string) => {
    if (!source || !state.connected || state.refreshing[cwd] !== undefined) return;
    const requestId = crypto.randomUUID();
    set({ ...state, refreshing: { ...state.refreshing, [cwd]: requestId } });
    source.send({ _tag: "models", cwd, refresh: true, requestId });
  };

  const saveDefaults = async (model: string | undefined, effort: ThinkingLevel) => {
    if (state.saving) return;
    const since = state.catalogs;
    set({ ...state, saving: true });
    try {
      await save(model, effort);
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Could not save defaults. Try again.",
        "error",
      );
      set({ ...state, saving: false });
      return;
    }
    if (!state.connected || shown(state.catalogs, since, model, effort)) confirmed();
    else confirming = { model, effort, since, timer: setTimeout(confirmed, confirmMs) };
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
