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
  useEffect(() => {
    if (!open || dialog.deadlineAt === null) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [open, dialog.deadlineAt]);
  return {
    ...controller.view(now, connected),
    answer: (reply: DialogReply) => controller.answer(reply, Date.now(), connected),
    cancel: () => controller.cancel(Date.now(), connected),
    abort: () => controller.abort(Date.now(), connected),
  };
}
