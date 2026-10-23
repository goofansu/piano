// Supervisor main process, not an independent lifetime owner. Never launch without the live
// generation's connection; EOF is a kernel death signal even when Piano cannot run finalizers.
import { execFileSync, spawn } from "node:child_process";
import { createConnection } from "node:net";

const [endpoint, generation, instanceId, executable, ...args] = process.argv.slice(2);
if (process.platform === "darwin") {
  const group = execFileSync("/bin/ps", ["-o", "pgid=", "-p", String(process.pid)], {
    encoding: "utf8",
  }).trim();
  if (Number(group) !== process.pid)
    throw new Error("launchd runner must lead its own process group");
}
let ending = false;
const end = () => {
  if (ending) return;
  ending = true;
  // Linux: main exit makes systemd clean the entire cgroup (TERM, KILL after 5s).
  // macOS: this still-live leader can signal its own group without PID reuse or stale lookup.
  // Kill the group including ourselves; no detached background cleanup helper is needed.
  if (process.platform === "darwin") process.kill(-process.pid, "SIGKILL");
  process.exit(0);
};
const owner = createConnection(endpoint);
owner.setTimeout(5000, end); // admission only, never an app lifetime timeout
owner.on("error", end);
owner.on("close", end);
owner.on("end", end);
process.on("SIGTERM", end);
process.on("SIGINT", end);
owner.on("connect", () => owner.write(`${JSON.stringify({ lease: instanceId, generation })}\n`));
let reply = "";
const admit = (data: Buffer) => {
  reply += data.toString();
  if (!reply.includes("\n") && reply.length < 100) return;
  owner.off("data", admit);
  if (reply !== "owned\n" || ending) {
    end();
    return;
  }
  owner.setTimeout(0);
  const app = spawn(executable, args, { stdio: "inherit" });
  app.on("error", end);
  app.on("exit", end);
};
owner.on("data", admit);
