import { useEffect, useRef } from "react";
import { isLocalId, LOCAL } from "../../../shared/machine.ts";
import type { ClientCommand } from "../../../shared/wire.ts";
import type { DraftEditorState } from "../components/DraftEditor.tsx";
import type { Client } from "./client.ts";
import type { DraftMessage } from "./messageDraft.ts";
import { discardImages, preparedImageCommand, prepareImages } from "./remoteImages.ts";
import { useMachine } from "./useMachine.ts";

/** One async send owns its original machine, draft and navigation. Switching cancels, never retargets. */
export function useImageSend(
  editor: DraftEditorState,
  captureSend: Client["captureSend"],
  target: { cwd: string; sessionId?: string | null },
  selection: string | null,
) {
  const machineId = useMachine()?.machine.id ?? LOCAL.id;
  const active = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      active.current?.abort();
      active.current = null;
    },
    [machineId, target.cwd, target.sessionId, selection],
  );
  return {
    cancel: () => active.current?.abort(),
    send: (
      command: (message: DraftMessage, inputId: string) => ClientCommand,
      settled: (consumed: boolean) => void,
    ) => {
      const send = captureSend();
      if (isLocalId(machineId) || !editor.attachments.items.length) {
        settled(editor.submit((message, id) => send(command(message, id))));
        return;
      }
      if (active.current || editor.preparing) return;
      const controller = new AbortController();
      active.current = controller;
      void editor
        .prepareSubmit(async (message, id) => {
          let reference;
          try {
            reference = await prepareImages(
              machineId,
              target.sessionId
                ? { cwd: target.cwd, sessionId: target.sessionId }
                : { cwd: target.cwd, draftId: id },
              message.attachments,
              controller.signal,
            );
            if (controller.signal.aborted) return "not-sent";
            const prepared = preparedImageCommand(command(message, id), reference);
            const disposition = send(prepared, {
              text: message.text,
              attachments: message.attachments.map((i) => ({
                kind: "image",
                url: `data:${i.mimeType};base64,${i.data}`,
              })),
            });
            if (disposition !== "not-sent") reference = undefined; // Consumed or uncertain: never reuse or resubmit.
            return disposition;
          } catch (error) {
            if (controller.signal.aborted) return "not-sent";
            throw error;
          } finally {
            if (reference) discardImages(machineId, reference);
          }
        })
        .then((consumed) => {
          if (active.current === controller) {
            active.current = null;
            settled(consumed);
          }
        });
    },
  };
}
