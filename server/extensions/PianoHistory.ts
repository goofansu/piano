/** Explicitly loaded, session-local command capability; no model input fallback. */
import { randomUUID } from "node:crypto";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { historyBridgePrefix, historyRevision } from "../HistoryBridge.ts";

export default function pianoHistory(pi: ExtensionAPI) {
  const command = `piano-history-${randomUUID()}`;
  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode === "rpc") ctx.ui.notify(historyBridgePrefix + JSON.stringify({ version: 1, kind: "capability", command, sessionId: ctx.sessionManager.getSessionId() }));
  });
  pi.registerCommand(command, {
    description: "Piano private history bridge v1",
    handler: async (args, ctx) => {
      let request: { requestId: string; entryId: string; label: string; revision: string };
      try { request = JSON.parse(Buffer.from(args, "base64url").toString("utf8")); } catch { return; }
      if (ctx.mode !== "rpc" || !request || typeof request.requestId !== "string") return;
      const result = (outcome: string, detail?: string) => ctx.ui.notify(historyBridgePrefix + JSON.stringify({
        version: 1, kind: "result", requestId: request.requestId, sessionId: ctx.sessionManager.getSessionId(), outcome, detail,
      }));
      if (!ctx.isIdle() || typeof request.entryId !== "string" || typeof request.label !== "string" || request.label.length > 200 ||
        request.revision !== historyRevision(ctx.sessionManager.getEntries(), ctx.sessionManager.getLeafId()) || !ctx.sessionManager.getEntry(request.entryId)) {
        result("rejected", "The session changed. Refresh the conversation tree before bookmarking."); return;
      }
      try {
        pi.setLabel(request.entryId, request.label.trim() || undefined);
        result("success");
      } catch (error) {
        // A write error is not proof the in-memory append did not happen.
        result("uncertain", `Bookmark delivery is uncertain: ${String(error)}`);
      }
    },
  });
}
