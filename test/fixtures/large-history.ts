import { appendFileSync, writeFileSync } from "node:fs";

/** ~35 MB of discarded branch, one tiny visible message; no real histories or credentials. */
export const largeHistory = (file: string, sessionId: string, cwd: string) => {
  writeFileSync(
    file,
    `${JSON.stringify({ type: "session", version: 3, id: sessionId, cwd, timestamp: "2026-10-05T00:00:00Z" })}\n`,
  );
  const text = "x".repeat(64 * 1024);
  for (let i = 0; i < 528; i++) {
    appendFileSync(
      file,
      `${JSON.stringify({ type: "message", id: `old-${i}`, parentId: i ? `old-${i - 1}` : null, timestamp: "2026-10-05T00:00:01Z", message: { role: "user", content: text, timestamp: i } })}\n`,
    );
  }
  appendFileSync(
    file,
    `${JSON.stringify({ type: "message", id: "visible", parentId: null, timestamp: "2026-10-05T00:00:02Z", message: { role: "user", content: "tiny active branch", timestamp: 1000 } })}\n`,
  );
};
