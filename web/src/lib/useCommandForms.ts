import type { ClientCommand, ServerMessage } from "@shared/wire";
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { AppState } from "@/store";
import { shareSession } from "./api.ts";
import { type CommandForms, type CommandFormsState, createCommandForms } from "./commandForms.ts";

/**
 * The command host's forms, answered against the latest render's state. `state`, `radiusSignedIn`,
 * `send`, `openProject`, `openNew` and `openProjects` may change between renders. Each rendered state settles the
 * page a submit waits on before it is painted, and `listen` hands every server frame to the forms.
 */
export function useCommandForms(deps: {
  state: AppState;
  radiusSignedIn: boolean;
  send: (command: ClientCommand) => void;
  openProject: (id: string) => void;
  openNew: (projectId: string) => void;
  openProjects: () => void;
  listen: (listener: (message: ServerMessage) => void) => () => void;
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
      openNew: (projectId) => latest.current.openNew(projectId),
      openProjects: () => latest.current.openProjects(),
    }),
  );
  const { listen } = deps;
  useEffect(() => listen(forms.hear), [listen, forms]);
  // Before paint, so a deleted project's home never shows "Project not found" on its way out.
  // biome-ignore lint/correctness/useExhaustiveDependencies: settle reads the rendered state through getState; each new state is its signal.
  useLayoutEffect(() => forms.settle(), [deps.state, forms]);
  const state = useSyncExternalStore(forms.subscribe, forms.getState);
  return { ...forms, ...state };
}
