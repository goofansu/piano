import type { Dialog } from "@shared/wire";
import {
  type DialogSurface,
  dialogSurface,
} from "../../../../web/src/shared/state/dialogAnswer.ts";
import { sessionReady } from "../../../../web/src/shared/state/sessionContext.ts";
import { type AppState, sessionKey } from "../../../../web/src/shared/state/state.ts";

export interface PendingDialogs {
  head: Dialog | undefined;
  surface: DialogSurface | null;
  more: number;
  attachment: string | null;
  session: string | null;
}

export function pendingDialogs(state: AppState): PendingDialogs {
  const dialogs = state.resync ? [] : (state.session?.dialogs ?? []);
  return {
    head: dialogs[0],
    surface: dialogs[0] ? dialogSurface(dialogs[0]) : null,
    more: Math.max(0, dialogs.length - 1),
    attachment: sessionReady(state) ? state.selectionId : null,
    session: state.session ? sessionKey(state.session) : null,
  };
}

export interface QueueSource {
  getState: () => AppState;
  subscribe: (listener: () => void) => () => void;
}

export interface QuestionReplies {
  get: (session: string | null, dialog: Dialog) => string;
  subscribe: (listener: () => void) => () => void;
  set: (session: string | null, dialog: Dialog, reply: string) => void;
  follow: (source: QueueSource) => () => void;
}

const questionKey = (dialog: Dialog) => `${dialog.generation}/${dialog.id}`;

export function createQuestionReplies(): QuestionReplies {
  const replies = new Map<string, Map<string, string>>();
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  return {
    get: (session, dialog) =>
      (session === null ? undefined : replies.get(session)?.get(questionKey(dialog))) ??
      (dialog.method === "select" ? "" : (dialog.prefill ?? "")),
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set(session, dialog, reply) {
      if (session === null) return;
      const open = replies.get(session) ?? new Map<string, string>();
      replies.set(session, open.set(questionKey(dialog), reply));
      notify();
    },
    follow: (source) =>
      source.subscribe(() => {
        const state = source.getState();
        if (state.resync || !state.session) return;
        const session = sessionKey(state.session);
        const open = replies.get(session);
        if (!open) return;
        const queued = new Set(state.session.dialogs.map(questionKey));
        let dropped = false;
        for (const key of open.keys()) if (!queued.has(key)) dropped = open.delete(key);
        if (!open.size) replies.delete(session);
        if (dropped) notify();
      }),
  };
}
