import { useEffect, useSyncExternalStore } from "react";
import type { McpServerSetup } from "../../../shared/mcp.ts";
import type { Webhook } from "../../../shared/webhooks.ts";
import type { SettingsSection } from "./routes.ts";

export interface EditorOpen<Entry> {
  target: Entry | "new";
  key: number;
}

export type Editing<Entry> = EditorOpen<Entry> | null;

export interface PageEditor<Entry> {
  getState: () => Editing<Entry>;
  subscribe: (listener: () => void) => () => void;
  open: (target: Entry | "new") => void;
  close: () => void;
  useEditing: () => Editing<Entry>;
  available: () => boolean;
  useAvailable: (available: boolean) => void;
}

export function pageEditor<Entry = never>(): PageEditor<Entry> {
  let editing: Editing<Entry> = null;
  let opens = 0;
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
    open: (target) => set({ target, key: ++opens }),
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

export const PAGE_EDITORS = {
  webhooks: { id: "add-webhook", label: "New webhook", editor: pageEditor<Webhook>() },
  mcp: { id: "add-mcp-server", label: "Add MCP server", editor: pageEditor<McpServerSetup>() },
  skills: { id: "new-skill", label: "New skill", editor: pageEditor() },
  prompts: { id: "new-prompt", label: "New prompt", editor: pageEditor() },
} as const satisfies Partial<
  Record<SettingsSection, { id: string; label: string; editor: { open: (target: "new") => void } }>
>;

export type EditorPage = keyof typeof PAGE_EDITORS;

export const isEditorPage = (page: SettingsSection): page is EditorPage => page in PAGE_EDITORS;

export const openPageEditor = (page: EditorPage) => PAGE_EDITORS[page].editor.open("new");

const editors = Object.values(PAGE_EDITORS).map((p) => p.editor);

export const pageAvailability = {
  subscribe: (listener: () => void) => {
    const stops = editors.map((editor) => editor.subscribe(listener));
    return () => {
      for (const stop of stops) stop();
    };
  },
  getState: () => editors.map((editor) => (editor.available() ? "1" : "0")).join(""),
};
