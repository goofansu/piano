import type { ClientCommand } from "@shared/wire";
import { useEffect } from "react";
import type { AppState } from "../store.ts";
import { refreshKey } from "./changesView.ts";

/** Keep Git's branch projection current even with Changes closed (INV-01/06).
 * The server coalesces discovery; never infer a branch from tool arguments or the registry.
 */
export function useCheckoutRefresh(state: AppState, send: (command: ClientCommand) => void) {
  const cwd =
    state.connected && !state.session?.state.checkoutMissing ? state.session?.cwd : undefined;
  const trigger = refreshKey(state.session);
  useEffect(() => {
    if (!cwd) return;
    const refresh = () => {
      if (document.visibilityState !== "hidden") send({ _tag: "registry" });
    };
    refresh();
    const timer = window.setInterval(refresh, 5000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [cwd, send]);
  useEffect(() => {
    if (!cwd || !trigger) return;
    // Coalesce bursts of tool completions; streaming text never changes this trigger.
    const timer = window.setTimeout(() => send({ _tag: "registry" }), 250);
    return () => window.clearTimeout(timer);
  }, [cwd, trigger, send]);
}
