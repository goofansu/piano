/** Browser failure fixture: only the scratch checkout containing this resource blocks startup. */
import { appendFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    const log = process.env.PIANO_PHASE0_LOG;
    if (!log) throw new Error("Startup fixture requires isolated storage");
    appendFileSync(
      log,
      `${JSON.stringify({ event: "startup-dialog", pid: process.pid, cwd: ctx.cwd, keepAlive: true })}\n`,
    );
    const timer = setInterval(() => {}, 1000);
    try {
      await ctx.ui.input("Phase 0 project startup dialog");
    } finally {
      clearInterval(timer);
    }
  });
}
