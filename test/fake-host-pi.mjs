// Deterministic lifecycle fixture: filesystem audit and signal barriers, no model calls.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";

const args = process.argv.slice(2);
const arg = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const file = arg("--session");
const sessionId =
  arg("--session-id") ??
  (file ? JSON.parse(readFileSync(file, "utf8").split("\n")[0]).id : "probe");
const auditFile = arg("--audit");
const audit = (event, extra = {}) => {
  if (auditFile)
    appendFileSync(
      auditFile,
      JSON.stringify({ event, pid: process.pid, sessionId, cwd: process.cwd(), ...extra }) + "\n",
    );
};
const out = (o) => process.stdout.write(JSON.stringify(o) + "\n");
const reply = (cmd, data) =>
  out({ type: "response", command: cmd.type, id: cmd.id, success: true, data });
const notify = (message) => out({ type: "extension_ui_request", method: "notify", message });
const sessionFile =
  file ?? join(process.env.PI_CODING_AGENT_SESSION_DIR ?? process.cwd(), `${sessionId}.jsonl`);
const entries = existsSync(sessionFile)
  ? readFileSync(sessionFile, "utf8")
      .trim()
      .split("\n")
      .map((x) => JSON.parse(x))
  : [];
const messages = entries.filter((x) => x.type === "message").map((x) => x.message);
let lastId = entries.at(-1)?.id ?? null;
let streaming = false,
  silence = false,
  heldState;
let holdStats = args.includes("--hold-stats");
const heldStats = [];
const stats = (cmd) => {
  const data = arg("--stats-file")
    ? JSON.parse(readFileSync(arg("--stats-file"), "utf8"))
    : { cost: 0 };
  if (data.error)
    out({ type: "response", command: cmd.type, id: cmd.id, success: false, error: data.error });
  else reply(cmd, data);
};
const state = () => ({
  sessionId,
  sessionFile,
  isStreaming: streaming,
  model: { provider: "fake", id: "alpha" },
  thinkingLevel: "medium",
});
const persist = (message) => {
  if (!existsSync(sessionFile))
    writeFileSync(
      sessionFile,
      JSON.stringify({
        type: "session",
        version: 3,
        id: sessionId,
        cwd: process.cwd(),
        timestamp: new Date().toISOString(),
      }) + "\n",
    );
  const id = `m${messages.length}`;
  appendFileSync(
    sessionFile,
    JSON.stringify({
      type: "message",
      id,
      parentId: lastId,
      timestamp: new Date().toISOString(),
      message,
    }) + "\n",
  );
  lastId = id;
  messages.push(message);
  out({ type: "message_end", message });
};
audit("spawn");
process.on("exit", (code) => audit("exit", { code }));
process.on("SIGUSR1", () => {
  audit("crash");
  process.exit(7);
});
process.on("SIGUSR2", () => process.exit(0));
process.on("SIGCONT", () => {
  if (heldState) {
    reply(heldState, state());
    heldState = undefined;
  }
  holdStats = false;
  for (const cmd of heldStats.splice(0)) stats(cmd);
});
if (args.includes("--hold-shutdown")) setInterval(() => {}, 1000);
let buffer = "";
const decoder = new StringDecoder("utf8");
process.stdin.on("data", (chunk) => {
  buffer += decoder.write(chunk);
  for (let end = buffer.indexOf("\n"); end >= 0; end = buffer.indexOf("\n")) {
    const line = buffer.slice(0, end);
    buffer = buffer.slice(end + 1);
    if (line) handle(JSON.parse(line));
  }
});
process.stdin.on("end", () => {
  audit("stdin-end");
  if (!args.includes("--hold-shutdown")) process.exit(0);
});
function handle(cmd) {
  audit("command", { command: cmd.type, text: cmd.message });
  if (cmd.type === "get_state") {
    if (args.includes("--persist-before-readiness-failure")) {
      persist({ role: "user", content: "Saved before readiness failed", timestamp: Date.now() });
      out({
        type: "response",
        command: cmd.type,
        id: cmd.id,
        success: false,
        error: "fixture readiness failure",
      });
      return;
    }
    if (silence || args.includes("--silence-readiness")) return;
    if (args.includes("--hold-readiness") || arg("--hold-session") === sessionId) {
      heldState = cmd;
      return;
    }
    return reply(cmd, state());
  }
  if (cmd.type === "get_messages") return reply(cmd, { messages });
  if (cmd.type === "get_session_stats") {
    if (!silence) {
      if (holdStats) heldStats.push(cmd);
      else stats(cmd);
    }
    return;
  }
  if (cmd.type === "get_commands") return reply(cmd, { commands: [] });
  if (cmd.type === "get_available_models")
    return reply(cmd, {
      models: [{ provider: "fake", id: "alpha", reasoning: false, contextWindow: 1000 }],
    });
  if (cmd.type === "extension_ui_response") {
    notify("dialog released");
    return;
  }
  if (cmd.type === "clear_queue") {
    out({ type: "queue_update", steering: [], followUp: [] });
    return reply(cmd, { steering: [], followUp: [] });
  }
  if (cmd.type === "abort") {
    streaming = false;
    out({ type: "agent_settled" });
    return reply(cmd);
  }
  if (cmd.type !== "prompt") return reply(cmd);
  switch (cmd.message) {
    case "/hold":
      streaming = true;
      out({ type: "agent_start" });
      persist({ role: "user", content: "/hold", timestamp: Date.now() });
      out({
        type: "tool_execution_start",
        toolCallId: "held-shell",
        toolName: "bash",
        args: { command: "fixture waiting; not a real shell" },
      });
      break;
    case "/pending-tool":
      streaming = true;
      out({ type: "agent_start" });
      out({ type: "message_start", message: { role: "assistant", content: [] } });
      break;
    case "/render-tool":
      out({
        type: "message_update",
        assistantMessageEvent: {
          type: "toolcall_start",
          contentIndex: 0,
          id: "pending-read",
          toolName: "read",
        },
      });
      break;
    case "/partial":
      streaming = true;
      out({ type: "agent_start" });
      out({ type: "message_start", message: { role: "assistant", content: [] } });
      out({
        type: "message_update",
        assistantMessageEvent: {
          type: "text_delta",
          contentIndex: 0,
          delta: `Partial ${sessionId} ${process.env.PIANO_TEST_SECRET ?? ""}`,
        },
      });
      out({
        type: "tool_execution_start",
        toolCallId: "partial-tool",
        toolName: "read",
        args: { path: "fixture" },
      });
      out({
        type: "extension_ui_request",
        method: "setStatus",
        statusKey: "fixture",
        statusText: `Status ${sessionId}`,
      });
      break;
    case "/burst": {
      let n = 0;
      const timer = setInterval(
        () => {
          out({
            type: "extension_ui_request",
            method: "setStatus",
            statusKey: "burst",
            statusText: `burst ${++n}`,
          });
          if (n === 600) {
            clearInterval(timer);
            notify("burst complete");
          }
        },
        Number(arg("--burst-delay") ?? 3),
      );
      break;
    }
    case "/dialog":
      out({
        type: "extension_ui_request",
        method: "input",
        id: "idle-dialog",
        title: "Idle dialog",
      });
      break;
    case "/queue":
      out({ type: "queue_update", steering: [], followUp: ["pending work"] });
      break;
    case "/retry":
      out({ type: "summarization_retry_scheduled", attempt: 1, maxAttempts: 3 });
      break;
    case "/compact":
      out({ type: "compaction_start", reason: "manual" });
      break;
    case "/silence":
      silence = true;
      break;
    case "/final":
      persist({
        role: "assistant",
        api: "openai-completions",
        provider: "fake",
        model: "alpha",
        stopReason: "stop",
        content: [{ type: "text", text: `Final ${sessionId}` }],
        timestamp: Date.now(),
      });
      streaming = false;
      out({ type: "agent_settled" });
      break;
    case "/events":
      persist({
        role: "assistant",
        api: "openai-completions",
        provider: "fake",
        model: "alpha",
        stopReason: "stop",
        content: [{ type: "text", text: "output behind hung readback" }],
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        timestamp: Date.now(),
      });
      out({
        type: "extension_ui_request",
        method: "input",
        id: "behind-readback",
        title: "Dialog behind readback",
      });
      break;
    case "/uncertain":
      notify("input received without acknowledgement");
      return;
    case "/settle":
      streaming = false;
      out({ type: "queue_update", steering: [], followUp: [] });
      out({ type: "agent_settled" });
      break;
    default:
      notify(`handled ${cmd.message}`);
  }
  reply(cmd, { disposition: cmd.message === "/hold" ? "started" : "handled" });
  notify(`barrier ${cmd.message}`);
}
