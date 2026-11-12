import { isLocalId } from "../../../shared/machine.ts";
import type { ImageTarget, PreparedImages } from "../../../shared/remoteImages.ts";
import type { Attachment, ClientCommand, StartOptions } from "../../../shared/wire.ts";
import type { Client } from "./client.ts";
import type { DraftMessage } from "./messageDraft.ts";
import { preparedImageCommand } from "./remoteImages.ts";
import type { SendDisposition } from "./ws.ts";

/** The draft a send takes its message from; `useDraftEditor`'s result is one. */
export interface ImageSendEditor {
  attachments: { readonly items: readonly Attachment[] };
  /** The message whose images are being prepared, if any. */
  preparing?: DraftMessage;
  submit: (deliver: (message: DraftMessage, inputId: string) => SendDisposition) => boolean;
  prepareSubmit: (
    deliver: (message: DraftMessage, inputId: string) => Promise<SendDisposition>,
  ) => Promise<boolean>;
}

/** Everything one send reads when it starts; nothing it reads later changes where it goes. */
export interface ImageSend {
  machineId: string;
  target: { cwd: string; sessionId?: string | null };
  editor: ImageSendEditor;
  captureSend: Client["captureSend"];
  /**
   * The model choice as the draft is sent: its start options travel with the input, not ones picked
   * during the upload, and a send that consumed its input clears the pick it carried.
   */
  choice: { start: StartOptions; consume: () => void };
}

export interface ImageSender {
  /**
   * Sends the draft's message as `command` builds it. On Local, or without images, at once.
   * Otherwise prepares the images on the remote first, then sends a reference to them; a send while
   * one is preparing is ignored. Resolves once the send is settled or ignored.
   */
  send: (
    context: ImageSend,
    command: (message: DraftMessage, inputId: string, start: StartOptions) => ClientCommand,
  ) => Promise<void>;
  /** Stop: abandons the upload in flight; the draft comes back and the choice stays. */
  cancel: () => void;
  /**
   * The machine, directory, session or selection changed: abandons the upload in flight and forgets
   * it, so its outcome is never reported. A send never moves to the new target.
   */
  abandon: () => void;
}

export interface ImageSenderOptions {
  prepare: (
    machineId: string,
    target: ImageTarget,
    images: readonly Attachment[],
    signal: AbortSignal,
  ) => Promise<PreparedImages>;
  /** Best-effort disposal of prepared images no input will use. */
  discard: (machineId: string, reference: PreparedImages) => void;
}

/** One upload at a time, owned by the machine, draft and navigation it started on. */
export function createImageSender({ prepare, discard }: ImageSenderOptions): ImageSender {
  let active: AbortController | null = null;
  return {
    cancel: () => active?.abort(),
    abandon: () => {
      active?.abort();
      active = null;
    },
    send: async ({ machineId, target, editor, captureSend, choice }, command) => {
      const send = captureSend();
      const { start } = choice;
      if (isLocalId(machineId) || !editor.attachments.items.length) {
        if (editor.submit((message, id) => send(command(message, id, start)))) choice.consume();
        return;
      }
      if (active || editor.preparing) return;
      const controller = new AbortController();
      active = controller;
      const consumed = await editor.prepareSubmit(async (message, id) => {
        let reference;
        try {
          reference = await prepare(
            machineId,
            target.sessionId
              ? { cwd: target.cwd, sessionId: target.sessionId }
              : { cwd: target.cwd },
            message.attachments,
            controller.signal,
          );
          if (controller.signal.aborted) return "not-sent";
          const prepared = preparedImageCommand(command(message, id, start), reference);
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
          if (reference) discard(machineId, reference);
        }
      });
      if (active !== controller) return;
      active = null;
      if (consumed) choice.consume();
    },
  };
}
