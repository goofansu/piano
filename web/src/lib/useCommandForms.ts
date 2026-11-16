import type { ClientCommand, ServerMessage } from "@shared/wire";
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { SendDisposition } from "@/lib/ws";
import type { AppState } from "@/store";
import {
  type CommandForms,
  type CommandFormsState,
  createCommandForms,
  type FormPage,
} from "./commandForms.ts";

export function useCommandForms(deps: {
  state: AppState;
  send: (command: ClientCommand) => SendDisposition;
  openPage: (page: FormPage) => void;
  listen: (listener: (message: ServerMessage) => void) => () => void;
}): CommandForms & CommandFormsState {
  const latest = useRef(deps);
  latest.current = deps;
  const [forms] = useState(() =>
    createCommandForms({
      getState: () => latest.current.state,
      send: (command) => latest.current.send(command),
      openPage: (page) => latest.current.openPage(page),
    }),
  );
  const { listen } = deps;
  useEffect(() => listen(forms.hear), [listen, forms]);
  useLayoutEffect(() => forms.settle(), [deps.state, forms]);
  const state = useSyncExternalStore(forms.subscribe, forms.getState);
  return { ...forms, ...state };
}
