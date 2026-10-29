import type { ClientCommand, Dialog } from "@shared/wire";
import { useEffect, useState, useSyncExternalStore } from "react";
import { createDialogAnswer, type DialogReply } from "@/lib/piDialogs";

/** Both presentations keep the same single-send guard. Mount keyed by generation and dialog ID. */
export function useDialogAnswer(
  dialog: Dialog,
  connected: boolean,
  send: (command: ClientCommand) => void,
  open = true,
) {
  const [controller] = useState(() => createDialogAnswer({ dialog, send }));
  useSyncExternalStore(controller.subscribe, controller.getState);
  const [now, setNow] = useState(Date.now);
  const view = controller.view(now, connected);
  // Only a deadline counts down; a dialog its tool call owns has none to tick.
  const ticking = open && view.deadline !== null;
  useEffect(() => {
    if (!ticking) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [ticking]);
  return {
    ...view,
    answer: (reply: DialogReply) => controller.answer(reply, Date.now(), connected),
    cancel: () => controller.cancel(Date.now(), connected),
    abort: () => controller.abort(Date.now(), connected),
  };
}
