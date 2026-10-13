import type { ClientCommand } from "@shared/wire";
import { useRef, useState, useSyncExternalStore } from "react";
import type { AppState } from "@/store";
import { shareSession } from "./api.ts";
import { type CommandForms, type CommandFormsState, createCommandForms } from "./commandForms.ts";

/**
 * The command host's forms, answered against the latest render's state. `state`, `radiusSignedIn`,
 * `send` and `openProject` may change between renders.
 */
export function useCommandForms(deps: {
  state: AppState;
  radiusSignedIn: boolean;
  send: (command: ClientCommand) => void;
  openProject: (id: string) => void;
}): CommandForms & CommandFormsState {
  const latest = useRef(deps);
  latest.current = deps;
  const [forms] = useState(() =>
    createCommandForms({
      getState: () => latest.current.state,
      radiusSignedIn: () => latest.current.radiusSignedIn,
      send: (command) => latest.current.send(command),
      share: shareSession,
      openProject: (id) => latest.current.openProject(id),
    }),
  );
  const state = useSyncExternalStore(forms.subscribe, forms.getState);
  return { ...forms, ...state };
}
