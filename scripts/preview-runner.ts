// Supervisor main process, not an independent lifetime owner. Never launch without the live
// generation's connection; EOF is a kernel death signal even when Piano cannot run finalizers.
import { execFileSync, spawn } from "node:child_process";
import { renameSync, writeFileSync } from "node:fs";
import { createConnection } from "node:net";
import { outcomeStatus, type PreviewOutcome } from "./PreviewOutcome.ts";

const [endpoint, generation, instanceId, outcomeFile, executable, ...args] = process.argv.slice(2);
if (process.platform === "darwin") {
  const group = execFileSync("/bin/ps", ["-o", "pgid=", "-p", String(process.pid)], {
    encoding: "utf8",
  }).trim();
  if (Number(group) !== process.pid)
    throw new Error("launchd runner must lead its own process group");
}
let ending = false;
const end = (
  reason: PreviewOutcome["reason"],
  exitCode: number | null = null,
  signal: NodeJS.Signals | null = null,
) => {
  if (ending) return;
  ending = true;
  // Persist before macOS kills this leader with its group. A unique instance path and the
  // generation in the payload fence late outcomes; atomic rename prevents partial observations.
  let status = outcomeStatus({ reason, exitCode, signal });
  try {
    const outcome: PreviewOutcome = { instanceId, generation, reason, exitCode, signal };
    writeFileSync(`${outcomeFile}.tmp`, JSON.stringify(outcome), { mode: 0o600 });
    renameSync(`${outcomeFile}.tmp`, outcomeFile);
  } catch (error) {
    console.error("Could not record preview terminal outcome:", error);
    status = 1; // Missing evidence must not prevent cleanup or manufacture success.
  }
  // Linux: main exit makes systemd clean the entire cgroup (TERM, KILL after 5s).
  // macOS: this still-live leader can signal its own group without PID reuse or stale lookup.
  // Kill the group including ourselves; no detached background cleanup helper is needed.
  if (process.platform === "darwin") process.kill(-process.pid, "SIGKILL");
  process.exit(status);
};
const disconnected = () => end("owner-disconnect");
const owner = createConnection(endpoint);
owner.setTimeout(5000, disconnected); // admission only, never an app lifetime timeout
owner.on("error", disconnected);
owner.on("close", disconnected);
owner.on("end", disconnected);
process.on("SIGTERM", () => end("stop"));
process.on("SIGINT", () => end("stop"));
owner.on("connect", () => owner.write(`${JSON.stringify({ lease: instanceId, generation })}\n`));
let reply = "";
const admit = (data: Buffer) => {
  reply += data.toString();
  if (!reply.includes("\n") && reply.length < 100) return;
  owner.off("data", admit);
  if (reply !== "owned\n" || ending) {
    disconnected();
    return;
  }
  owner.setTimeout(0);
  const app = spawn(executable, args, { stdio: "inherit" });
  app.on("error", (error) => {
    console.error("Preview application failed to spawn:", error);
    end("spawn-error");
  });
  app.on("exit", (code, signal) => end("app-exit", code, signal));
};
owner.on("data", admit);
