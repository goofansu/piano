import type { Webhook } from "@shared/webhooks";
import { useEffect, useSyncExternalStore } from "react";

/** The webhook the editor is open on: `"new"` for Add webhook, a webhook for Edit, `null` when closed. */
export type WebhookEditing = Webhook | "new" | null;

/**
 * The page's one webhook editor, so Add webhook opens the same dialog whether the Webhooks header
 * or the command palette ran it.
 */
export const webhookEditor = (() => {
  let editing: WebhookEditing = null;
  const listeners = new Set<() => void>();
  const set = (next: WebhookEditing) => {
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
    open: (target: Webhook | "new") => set(target),
    close: () => set(null),
  };
})();

/** The editor while the Webhooks page is mounted; leaving the page closes it. */
export function useWebhookEditor() {
  useEffect(() => webhookEditor.close, []);
  return useSyncExternalStore(webhookEditor.subscribe, webhookEditor.getState);
}
