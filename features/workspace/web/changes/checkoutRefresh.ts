import type { ClientCommand, RenderMsg } from "@shared/wire";
import {
  browserEnvironment,
  type ObservationEnvironment,
} from "../../../../web/src/shared/lib/observation.ts";
import { refreshKey } from "./changesView.ts";

export interface CheckoutRefreshEnvironment extends ObservationEnvironment {
  onVisibilityChange: (listener: () => void) => () => void;
}

export const browserCheckoutEnvironment: CheckoutRefreshEnvironment = {
  ...browserEnvironment,
  onVisibilityChange: (listener) => {
    document.addEventListener("visibilitychange", listener);
    return () => document.removeEventListener("visibilitychange", listener);
  },
};

export interface CheckoutRefreshState {
  connected: boolean;
  view: { kind: string };
  session: {
    cwd: string;
    messages: readonly Pick<RenderMsg, "id" | "role" | "toolName">[];
    state: { isStreaming: boolean };
  } | null;
}

export interface CheckoutRefreshSource {
  getState: () => CheckoutRefreshState;
  subscribe: (listener: () => void) => () => void;
  send: (command: ClientCommand) => void;
}

export interface CheckoutRefresh {
  follow: (source: CheckoutRefreshSource) => () => void;
}

const POLL_MS = 5000;
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

export const checkoutRefresh = createCheckoutRefresh();
