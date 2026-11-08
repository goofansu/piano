import { useEffect, useSyncExternalStore } from "react";
/**
 * The Settings pages whose header creates something, and each page's one editor, so the header's
 * button and the command palette's row are one command (`pageCommands`) opening one dialog.
 */
// Relative, not @shared: module tests load this file directly in Node.
import type { McpServerSetup } from "../../../shared/mcp.ts";
import type { Webhook } from "../../../shared/webhooks.ts";
import type { SettingsPage } from "./routes.ts";

/** What the editor is open on: `"new"` for the page's creation, an entry for Edit, `null` when closed. */
export type Editing<Entry> = Entry | "new" | null;

export interface PageEditor<Entry> {
  getState: () => Editing<Entry>;
  subscribe: (listener: () => void) => () => void;
  /** Open on `"new"` for the page's creation, or on an entry to edit it. */
  open: (target: Entry | "new") => void;
  close: () => void;
  /** The editor while its page is mounted; leaving the page closes it. */
  useEditing: () => Editing<Entry>;
  /** Whether the page's creation can run now: yes unless its mounted page reports otherwise. */
  available: () => boolean;
  /**
   * The mounted page reports whether its creation can run, such as MCP while Pi's config is
   * unusable; leaving the page clears it. `pageCommands` reads it, so header and palette agree.
   */
  useAvailable: (available: boolean) => void;
}

/** One page's editor; `Entry` is what its Edit opens on (`never` when the page has no Edit). */
export function pageEditor<Entry = never>(): PageEditor<Entry> {
  let editing: Editing<Entry> = null;
  let available = true;
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  const set = (next: Editing<Entry>) => {
    editing = next;
    notify();
  };
  const setAvailable = (next: boolean) => {
    if (available === next) return;
    available = next;
    notify();
  };
  const getState = () => editing;
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };
  const close = () => set(null);
  return {
    getState,
    subscribe,
    open: set,
    close,
    useEditing: () => {
      useEffect(() => close, []);
      return useSyncExternalStore(subscribe, getState);
    },
    available: () => available,
    useAvailable: (next) => {
      useEffect(() => setAvailable(next), [next]);
      useEffect(() => () => setAvailable(true), []);
    },
  };
}

/**
 * Each Settings page with a creation editor: its header command's palette ID and name (as
 * [Button names](../../../docs/quiet-ui.md#button-names) gives it), and the editor that command opens.
 */
export const PAGE_EDITORS = {
  webhooks: { id: "add-webhook", label: "New webhook", editor: pageEditor<Webhook>() },
  mcp: { id: "add-mcp-server", label: "Add MCP server", editor: pageEditor<McpServerSetup>() },
  skills: { id: "new-skill", label: "New skill", editor: pageEditor() },
  prompts: { id: "new-prompt", label: "New prompt", editor: pageEditor() },
} as const satisfies Partial<
  Record<SettingsPage, { id: string; label: string; editor: { open: (target: "new") => void } }>
>;

/** A Settings page whose header creates something. */
export type EditorPage = keyof typeof PAGE_EDITORS;

export const isEditorPage = (page: SettingsPage): page is EditorPage => page in PAGE_EDITORS;

/** Open `page`'s editor on a new entry, as its header's button does. */
export const openPageEditor = (page: EditorPage) => PAGE_EDITORS[page].editor.open("new");

const editors = Object.values(PAGE_EDITORS).map((p) => p.editor);

/**
 * Which pages' creations can run, as one snapshot, so a surface listing `pageCommands` (the
 * palette's host) re-renders when a page reports a change.
 */
export const pageAvailability = {
  subscribe: (listener: () => void) => {
    const stops = editors.map((editor) => editor.subscribe(listener));
    return () => {
      for (const stop of stops) stop();
    };
  },
  getState: () => editors.map((editor) => (editor.available() ? "1" : "0")).join(""),
};
