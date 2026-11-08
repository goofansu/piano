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
}

/** One page's editor; `Entry` is what its Edit opens on (`never` when the page has no Edit). */
export function pageEditor<Entry = never>(): PageEditor<Entry> {
  let editing: Editing<Entry> = null;
  const listeners = new Set<() => void>();
  const set = (next: Editing<Entry>) => {
    editing = next;
    for (const listener of listeners) listener();
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
