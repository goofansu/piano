/**
 * The folder picker's flow: one path input (`./folderPath.ts`) names the directory being listed
 * and a filter over its subfolders; the listing is a live observation of that directory while the
 * picker is open. Opening starts at the given path, else the last folder picked, else home. A pick
 * happens only once the listing has settled, and is remembered for the next opening. Creating a
 * folder is one change at a time; a creation that a later navigation or closing superseded never
 * navigates, while one that lands browses into the new folder. Nothing here depends on React.
 */
import type { DirListing } from "@shared/wire";
import { browseInput, childPath, listing, parsePathInput, pickTarget } from "./folderPath.ts";
import { createObservation, type ObservationEnvironment } from "./observation.ts";

type DirEntry = DirListing["entries"][number];

export interface FolderBrowserState {
  /** The path input, as typed. */
  input: string;
  /** The filter over the listed directory's subfolders: the input after its last slash. */
  prefix: string;
  /** The listed directory; `undefined` until its read lands. */
  dir: DirListing | undefined;
  error: string | undefined;
  loading: boolean;
  /** A folder is being created. */
  mutating: boolean;
  /** The listing has settled without error, so a pick or a creation can act on it. */
  ready: boolean;
  /** The new-folder row is shown. */
  creating: boolean;
  matches: readonly DirEntry[];
  visible: readonly DirEntry[];
  /** Matches past the visible cap. */
  hidden: number;
}

/**
 * How `createFolder` ended: the browser moved into it; the name was refused before any request;
 * nothing to act on yet or a creation already running; a navigation or closing superseded it; or
 * it failed and was reported.
 */
export type FolderCreation = "created" | "invalid" | "busy" | "superseded" | "failed";

export interface FolderBrowserOptions {
  list: (path: string, options: { signal: AbortSignal }) => Promise<DirListing>;
  /** Creates `path` and resolves with the created folder's path. */
  mkdir: (path: string, options: { signal: AbortSignal }) => Promise<string>;
  /** The last folder picked, where the next opening starts; empty for none. */
  lastPicked: { get: () => string; set: (path: string) => void };
  notify: { error: (message: string) => void };
  environment?: ObservationEnvironment;
}

export interface FolderBrowser {
  getState: () => FolderBrowserState;
  subscribe: (listener: () => void) => () => void;
  /** Resumes reading; returns the stop function, which aborts all work. */
  start: () => () => void;
  /** Opens at `initialPath`, else the last folder picked, else home. */
  open: (initialPath?: string) => void;
  /** Stops listing; a creation in flight can no longer navigate. */
  close: () => void;
  setInput: (input: string) => void;
  /** Browses inside `path`. */
  goTo: (path: string) => void;
  /** The folder to use, remembered for the next opening; `undefined` until the listing settles. */
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

  /** Lists the directory the input names while open; nothing while closed. */
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
      // `mutating` is set as soon as a creation starts, so a same-tick second submit is busy too.
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
          // Closing may stop observing the result, not undo an already submitted mkdir.
          created = await mkdir(child.path, { signal });
          // Keep the observation associated with its parent until navigation reads the child.
          return previous;
        });
        // The observation returns nothing if this directory or picker opening was superseded.
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
