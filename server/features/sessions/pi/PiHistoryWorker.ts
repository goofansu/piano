import { readFileSync } from "node:fs";
import { parentPort } from "node:worker_threads";
import type { SessionManager } from "@earendil-works/pi-coding-agent";
import { artifactPublications } from "../../../../shared/features/radius/radiusArtifacts.ts";
import type { Snapshot, SessionState } from "../../../../shared/wire.ts";
import { projectSnapshot } from "../../../shared/DisplayProjection.ts";
import { getImagePreview, type ImagePreview } from "../attachments/ImagePreviews.ts";
import { savedSession } from "./PiHistoryFile.ts";
import { dispatchedFromOf, type PiSessionFacts, type RawMessage, snapshotOf } from "./PiRecords.ts";

export type HistoryMetadata = {
  readonly dispatchedFrom: string | undefined;
  readonly artifacts: NonNullable<SessionState["artifacts"]>;
};

export type HistoryRequest = {
  readonly operation: "peek" | "metadata";
  readonly path: string;
  readonly sessionId: string;
};
export type HistoryReply =
  | {
      readonly value: Snapshot | HistoryMetadata | undefined;
      readonly images?: ReadonlyArray<ImagePreview>;
    }
  | { readonly error: true };

const savedFacts = (sm: SessionManager, path: string, sessionId: string): PiSessionFacts => {
  const context = sm.buildSessionContext();
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
    dispatchedFrom: dispatchedFromOf(sm.getEntries()),
    artifacts: artifactPublications(sm.getBranch()),
  };
};

parentPort!.on("message", ({ operation, path, sessionId }: HistoryRequest) => {
  let reply: HistoryReply;
  try {
    const manager = savedSession(readFileSync(path, "utf8"), sessionId);
    if (operation === "peek") {
      const value = projectSnapshot(snapshotOf(savedFacts(manager, path, sessionId)));
      const ids = new Set(
        value.messages.flatMap((m) => m.attachments?.map((a) => a.url.split("/").at(-1)!) ?? []),
      );
      const images = [...ids].flatMap((id) => {
        const image = getImagePreview(id);
        return image ? [{ id, ...image }] : [];
      });
      reply = { value, images };
    } else {
      reply = {
        value: {
          dispatchedFrom: dispatchedFromOf(manager.getEntries()),
          artifacts: artifactPublications(manager.getBranch()),
        },
      };
    }
  } catch {
    reply = { error: true };
  }
  parentPort!.postMessage(reply);
});
