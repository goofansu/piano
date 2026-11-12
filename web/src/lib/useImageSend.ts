import { useEffect, useState } from "react";
import type { Client } from "./client.ts";
import { createImageSender, type ImageSend, type ImageSender } from "./imageSender.ts";
import { discardImages, prepareImages } from "./remoteImages.ts";
import { useMachineId } from "./useMachine.ts";

/** One async send owns its original machine, draft and navigation. Switching cancels, never retargets. */
export function useImageSend(
  editor: ImageSend["editor"],
  captureSend: Client["captureSend"],
  target: ImageSend["target"],
  selection: string | null,
  choice: ImageSend["choice"],
) {
  const machineId = useMachineId();
  const [sender] = useState(() =>
    createImageSender({ prepare: prepareImages, discard: discardImages }),
  );
  useEffect(() => sender.abandon, [sender, machineId, target.cwd, target.sessionId, selection]);
  return {
    cancel: sender.cancel,
    send: (command: Parameters<ImageSender["send"]>[1]) =>
      void sender.send({ machineId, target, editor, captureSend, choice }, command),
  };
}
