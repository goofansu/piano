/** Private extension transport. Never expose commands/envelopes in browser vocabulary. */
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

export const historyExtensionPath = fileURLToPath(new URL("./extensions/PianoHistory.ts", import.meta.url));
export const historyBridgePrefix = "piano.history.v1:";
export const historyRevision = (entries: readonly { id: string; parentId: string | null }[], leafId: string | null) =>
  createHash("sha256").update(JSON.stringify([leafId, entries.map(e => [e.id, e.parentId])])).digest("hex");
