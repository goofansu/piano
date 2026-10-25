/**
 * Keeps Git's branch projection current even with Changes closed (INV-01/06): while a session is
 * on screen and the socket connected, ask the server for the registry now, every 5 seconds and on
 * focus or a visibility change while the page is visible, and 250 ms after the session's checkout
 * may have moved (see `refreshKey`). The same refresh notices a saved session's checkout go or
 * come back. The server coalesces discovery; never infer a branch from tool arguments or the
 * registry. Nothing here depends on React.
 */
import type { ClientCommand, RenderMsg } from "@shared/wire";
import { refreshKey } from "./changesView.ts";
import { browserEnvironment, type ObservationEnvironment } from "./observation.ts";

/** The observation seam plus the page's visibility changes. */
export interface CheckoutRefreshEnvironment extends ObservationEnvironment {
  /** Subscribes to visibility changes; returns the unsubscribe function. */
  onVisibilityChange: (listener: () => void) => () => void;
}

export const browserCheckoutEnvironment: CheckoutRefreshEnvironment = {
  ...browserEnvironment,
  onVisibilityChange: (listener) => {
    document.addEventListener("visibilitychange", listener);
    return () => document.removeEventListener("visibilitychange", listener);
  },
};

/** The part of the page's state this follows; `AppState` is one. */
export interface CheckoutRefreshState {
  connected: boolean;
  view: { kind: string };
  session: {
    cwd: string;
    messages: readonly Pick<RenderMsg, "id" | "role" | "toolName">[];
    state: { isStreaming: boolean };
  } | null;
}

/** The client to follow; the page's `Client` is one. */
export interface CheckoutRefreshSource {
  getState: () => CheckoutRefreshState;
  subscribe: (listener: () => void) => () => void;
  send: (command: ClientCommand) => void;
}

export interface CheckoutRefresh {
  /** Refreshes while `source` shows a session; returns the stop function. */
  follow: (source: CheckoutRefreshSource) => () => void;
}

const POLL_MS = 5000;
/** Coalesces bursts of tool completions; streaming text never changes the trigger. */
const DEBOUNCE_MS = 250;

export function createCheckoutRefresh({
  environment = browserCheckoutEnvironment,
}: {
  environment?: CheckoutRefreshEnvironment;
} = {}): CheckoutRefresh {
  const env = environment;
  return {
    follow: (source) => {
      const registry = () => source.send({ _tag: "registry" });
      const refresh = () => {
        if (!env.hidden()) registry();
      };

      /** The checkout being followed; polling, focus and visibility belong to it. */
      let cwd: string | undefined;
      let poll: unknown, unfocus: (() => void) | undefined, unvisible: (() => void) | undefined;
      const tick = () => {
        poll = env.setTimeout(tick, POLL_MS);
        refresh();
      };
      const stopPolling = () => {
        if (poll !== undefined) env.clearTimeout(poll);
        unfocus?.();
        unvisible?.();
        poll = unfocus = unvisible = undefined;
      };

      /** The `cwd|trigger` the pending debounce belongs to. */
      let debounced: string | undefined;
      let soon: unknown;
      const stopDebounce = () => {
        if (soon !== undefined) env.clearTimeout(soon);
        soon = undefined;
      };

      const update = () => {
        const state = source.getState();
        const session = state.view.kind === "session" ? state.session : null;
        const next = state.connected && session ? session.cwd : undefined;
        if (next !== cwd) {
          stopPolling();
          cwd = next;
          if (cwd) {
            refresh();
            poll = env.setTimeout(tick, POLL_MS);
            unfocus = env.onFocus(refresh);
            unvisible = env.onVisibilityChange(refresh);
          }
        }
        const trigger = cwd ? refreshKey(session) : "";
        const key = cwd && trigger ? `${cwd}\n${trigger}` : undefined;
        if (key !== debounced) {
          stopDebounce();
          debounced = key;
          if (key)
            soon = env.setTimeout(() => {
              soon = undefined;
              registry();
            }, DEBOUNCE_MS);
        }
      };

      update();
      const unsubscribe = source.subscribe(update);
      return () => {
        unsubscribe();
        stopPolling();
        stopDebounce();
        cwd = debounced = undefined;
      };
    },
  };
}

/** The page's one checkout refresh; App follows the client with it. */
export const checkoutRefresh = createCheckoutRefresh();
