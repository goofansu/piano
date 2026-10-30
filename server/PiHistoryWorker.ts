/** Read-only saved-history projection. Full files/SDK entries never cross back to the server. */
import { readFileSync } from "node:fs";
import { parentPort } from "node:worker_threads";
import type { SessionManager } from "@earendil-works/pi-coding-agent";
import type { Snapshot } from "../shared/wire.ts";
import { compileRedaction, projectSnapshot } from "./DisplayProjection.ts";
import { getImagePreview, type ImagePreview } from "./ImagePreviews.ts";
import { savedSession } from "./PiHistoryFile.ts";
import { type PiSessionFacts, type RawMessage, snapshotOf } from "./PiRecords.ts";

export type HistoryRequest = {
  readonly operation: "peek" | "export";
  readonly path: string;
  readonly sessionId: string;
};
export type HistoryReply =
  | { readonly value: Snapshot | string; readonly images?: ReadonlyArray<ImagePreview> }
  | { readonly error: true };

const savedFacts = (sm: SessionManager, path: string, sessionId: string): PiSessionFacts => {
  // Pi owns compaction/context edits/active branch, just as for RPC get_messages.
  const context = sm.buildSessionContext();
  // Selection can be virtual, unlike the physical model of the last assistant message.
  const selection = sm.getBranch().findLast((entry) => entry.type === "model_change");
  const model =
    selection?.type === "model_change"
      ? { provider: selection.provider, id: selection.modelId }
      : context.model
        ? { provider: context.model.provider, id: context.model.modelId }
        : undefined;
  return {
    source: "saved",
    state: {
      sessionId,
      sessionFile: path,
      sessionName: sm.getSessionName(),
      model,
      thinkingLevel: context.thinkingLevel,
      isStreaming: false,
    },
    messages: context.messages as RawMessage[],
    entries: sm.getEntries(),
  };
};

parentPort!.on("message", ({ operation, path, sessionId }: HistoryRequest) => {
  let reply: HistoryReply;
  try {
    const manager = savedSession(readFileSync(path, "utf8"), sessionId);
    if (operation === "peek") {
      const value = projectSnapshot(snapshotOf(savedFacts(manager, path, sessionId)));
      // Image URLs refer to the server's bounded cache, not this worker's private heap.
      const ids = new Set(
        value.messages.flatMap((m) => m.attachments?.map((a) => a.url.split("/").at(-1)!) ?? []),
      );
      const images = [...ids].flatMap((id) => {
        const image = getImagePreview(id);
        return image ? [{ id, ...image }] : [];
      });
      reply = { value, images };
    } else {
      const header = manager.getHeader();
      const branch = manager.getBranch();
      if (header?.id !== sessionId || !branch.some((entry) => entry.type === "message"))
        throw new Error("No saved conversation");
      const redaction = compileRedaction();
      reply = {
        value: `${[header, ...branch].map((entry) => JSON.stringify(redaction.value(entry))).join("\n")}\n`,
      };
    }
  } catch {
    reply = { error: true };
  }
  parentPort!.postMessage(reply);
});
