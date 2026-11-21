import type { SendDisposition } from "../../../../shared/transport/ws.ts";
import type { ClientCommand, ServerMessage } from "../../../../shared/wire.ts";
import type { Action, AppState } from "./state.ts";

export type NotifyLevel = "success" | "info" | "warning" | "error";
export type Notify = (message: string, level?: NotifyLevel) => void;

export type LocalAction = Exclude<
  Action,
  { type: "connected" | "server" | "selecting" | "trust_decision" | "trust_settled" }
>;

export type ClientUpdate = "live" | "immediate";

export interface Client {
  getState: () => AppState;
  subscribe: (listener: (update: ClientUpdate) => void) => () => void;
  start: () => () => void;
  send: (command: ClientCommand) => SendDisposition;
  decideTrust: (path: string, trusted: boolean) => void;
  select: (cwd: string, sessionId: string | null) => void;
  dispatch: (action: LocalAction) => void;
  listen: (listener: (message: ServerMessage) => void) => () => void;
}
