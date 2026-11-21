import type { DirListing } from "@shared/wire";
import {
  createObservation,
  type ObservationEnvironment,
} from "../../../../web/src/shared/lib/observation.ts";
import { browseInput, childPath, listing, parsePathInput, pickTarget } from "./folderPath.ts";

type DirEntry = DirListing["entries"][number];

export interface FolderBrowserState {
  input: string;
  prefix: string;
  dir: DirListing | undefined;
  error: string | undefined;
  loading: boolean;
  mutating: boolean;
  ready: boolean;
  creating: boolean;
  matches: readonly DirEntry[];
  visible: readonly DirEntry[];
  hidden: number;
}

export type FolderCreation = "created" | "invalid" | "busy" | "superseded" | "failed";

export interface FolderBrowserOptions {
  list: (path: string, options: { signal: AbortSignal }) => Promise<DirListing>;
  mkdir: (path: string, options: { signal: AbortSignal }) => Promise<string>;
  lastPicked: { get: () => string; set: (path: string) => void };
  notify: { error: (message: string) => void };
  environment?: ObservationEnvironment;
}

export interface FolderBrowser {
  getState: () => FolderBrowserState;
  subscribe: (listener: () => void) => () => void;
  start: () => () => void;
  open: (initialPath?: string) => void;
  close: () => void;
  setInput: (input: string) => void;
  goTo: (path: string) => void;
  pick: () => string | undefined;
  startCreating: () => void;
  cancelCreating: () => void;
  createFolder: (name: string) => Promise<FolderCreation>;
}

export function createFolderBrowser({
  list,
  mkdir,
  lastPicked,
  notify,
  environment,
}: FolderBrowserOptions): FolderBrowser {
  const observation = createObservation<DirListing>({
    load: (signal, path) => list(path, { signal }),
    environment,
  });
  let open = false,
    input = "",
    creating = false;
  const listeners = new Set<() => void>();

  const derive = (): FolderBrowserState => {
    const { prefix } = parsePathInput(input);
    const { value: dir, error, loading, mutating } = observation.getState();
    return {
      input,
      prefix,
      dir,
      error,
      loading,
      mutating,
      ready: open && !!dir && !error && !loading && !mutating,
      creating,
      ...listing(dir?.entries ?? [], prefix),
    };
  };
  let state = derive();
  const publish = () => {
    state = derive();
    for (const listener of listeners) listener();
  };
  observation.subscribe(publish);

  const follow = () => observation.observe(open ? parsePathInput(input).dirPath : null);
  const setInput = (next: string) => {
    input = next;
    follow();
    publish();
  };
  const goTo = (path: string) => setInput(browseInput(path));

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    start: observation.start,
    open: (initialPath) => {
      open = true;
      creating = false;
      goTo(initialPath || lastPicked.get() || "~");
    },
    close: () => {
      if (!open) return;
      open = false;
      follow();
      publish();
    },
    setInput,
    goTo,
    pick: () => {
      const { ready, dir, matches, prefix } = state;
      if (!ready || !dir) return undefined;
      const path = pickTarget(dir.path, matches, prefix);
      lastPicked.set(path);
      return path;
    },
    startCreating: () => {
      if (!state.ready || creating) return;
      creating = true;
      publish();
    },
    cancelCreating: () => {
      if (!creating) return;
      creating = false;
      publish();
    },
    createFolder: async (name) => {
      if (!name.trim()) return "invalid";
      const { ready, dir } = state;
      if (!ready || !dir) return "busy";
      const child = childPath(dir.path, name);
      if ("error" in child) {
        notify.error(child.error);
        return "invalid";
      }
      let created: string | undefined;
      try {
        const parent = await observation.mutate(async (signal, previous) => {
          created = await mkdir(child.path, { signal });
          return previous;
        });
        if (!parent || !created) return "superseded";
        creating = false;
        goTo(created);
        return "created";
      } catch (e) {
        notify.error(e instanceof Error ? e.message : "Could not create folder");
        return "failed";
      }
    },
  };
}
