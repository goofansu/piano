import { isLocalId } from "../../../shared/machine.ts";
import type { ImageTarget, PreparedImages } from "../../../shared/remoteImages.ts";
import type { Attachment, ClientCommand, StartOptions } from "../../../shared/wire.ts";
import type { Client } from "./client.ts";
import type { DraftMessage } from "./messageDraft.ts";
import { preparedImageCommand } from "./remoteImages.ts";
import type { SendDisposition } from "./ws.ts";

export interface ImageSendEditor {
  attachments: { readonly items: readonly Attachment[] };
  preparing?: DraftMessage;
  submit: (deliver: (message: DraftMessage, inputId: string) => SendDisposition) => boolean;
  prepareSubmit: (
    deliver: (message: DraftMessage, inputId: string) => Promise<SendDisposition>,
  ) => Promise<boolean>;
}

export interface ImageSend {
  machineId: string;
  target: { cwd: string; sessionId?: string | null };
  editor: ImageSendEditor;
  captureSend: Client["captureSend"];
  choice: { start: StartOptions; consume: () => void };
}

export interface ImageSender {
  send: (
    context: ImageSend,
    command: (message: DraftMessage, inputId: string, start: StartOptions) => ClientCommand,
  ) => Promise<void>;
  cancel: () => void;
  abandon: () => void;
}

export interface ImageSenderOptions {
  prepare: (
    machineId: string,
    target: ImageTarget,
    images: readonly Attachment[],
    signal: AbortSignal,
  ) => Promise<PreparedImages>;
  discard: (machineId: string, reference: PreparedImages) => void;
}

export function createImageSender({ prepare, discard }: ImageSenderOptions): ImageSender {
  let active: AbortController | null = null;
  return {
    cancel: () => active?.abort(),
    abandon: () => {
      active?.abort();
      active = null;
    },
    send: async ({ machineId, target, editor, captureSend, choice }, command) => {
      const { send, signal: stale } = captureSend();
      const { start } = choice;
      if (isLocalId(machineId) || !editor.attachments.items.length) {
        if (editor.submit((message, id) => send(command(message, id, start)))) choice.consume();
        return;
      }
      if (active || editor.preparing) return;
      const controller = new AbortController();
      active = controller;
      const signal = AbortSignal.any([controller.signal, stale]);
      const consumed = await editor.prepareSubmit(async (message, id) => {
        let reference;
        try {
          reference = await prepare(
            machineId,
            target.sessionId
              ? { cwd: target.cwd, sessionId: target.sessionId }
              : { cwd: target.cwd },
            message.attachments,
            signal,
          );
          if (signal.aborted) return "not-sent";
          const prepared = preparedImageCommand(command(message, id, start), reference);
          const disposition = send(prepared, {
            text: message.text,
            attachments: message.attachments.map((i) => ({
              kind: "image",
              url: `data:${i.mimeType};base64,${i.data}`,
            })),
          });
          if (disposition !== "not-sent") reference = undefined;
          return disposition;
        } catch (error) {
          if (signal.aborted) return "not-sent";
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
