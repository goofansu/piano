import type { McpServerSetup } from "@shared/mcp";
import { useEffect, useSyncExternalStore } from "react";

/** The entry the editor is open on: `"new"` for Add MCP server, an entry for Edit, `null` when closed. */
export type McpServerEditing = McpServerSetup | "new" | null;

/**
 * The page's one MCP server editor, so Add MCP server opens the same dialog whether the MCP
 * header or the command palette ran it.
 */
export const mcpServerEditor = (() => {
  let editing: McpServerEditing = null;
  const listeners = new Set<() => void>();
  const set = (next: McpServerEditing) => {
    editing = next;
    for (const listener of listeners) listener();
  };
  return {
    getState: () => editing,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    open: (target: McpServerSetup | "new") => set(target),
    close: () => set(null),
  };
})();

/** The editor while the MCP page is mounted; leaving the page closes it. */
export function useMcpServerEditor() {
  useEffect(() => mcpServerEditor.close, []);
  return useSyncExternalStore(mcpServerEditor.subscribe, mcpServerEditor.getState);
}
