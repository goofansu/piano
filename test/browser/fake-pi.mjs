// The Pi the browser journeys talk to: `pi --mode rpc` for one session, without a model.
// It resumes a session file's history, echoes each prompt with priced usage, and keeps a prompt
// of exactly "hold" running until Stop. PIANO_TEST_AUDIT records every command it receives.
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";

const args = process.argv.slice(2);
const arg = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const file = arg("--session");
const entries =
  file && existsSync(file) ? readFileSync(file, "utf8").trim().split("\n").map(JSON.parse) : [];
const sessionId = entries[0]?.id ?? arg("--session-id") ?? "probe";
const sessionFile =
  file ?? join(process.env.PI_CODING_AGENT_SESSION_DIR ?? process.cwd(), `${sessionId}.jsonl`);
// A compaction entry replays as the summary message Pi's get_messages would report.
const messages = entries
  .filter((e) => e.type === "message" || e.type === "compaction")
  .map((e) =>
    e.type === "compaction"
      ? { role: "compactionSummary", summary: e.summary, tokensBefore: e.tokensBefore }
      : e.message,
  );
const [provider, id] = (arg("--model") ?? "fake/alpha").split("/");
let model = { provider, id };
let thinkingLevel = arg("--thinking") ?? "medium";
let sessionName = arg("--name");
let streaming = false;
let streamTimer;

const out = (record) => process.stdout.write(`${JSON.stringify(record)}\n`);
const respond = (cmd, data, error) =>
  out({
    id: cmd.id,
    type: "response",
    command: cmd.type,
    success: !error,
    ...(error ? { error } : { data }),
  });
const audit = (record) => {
  if (process.env.PIANO_TEST_AUDIT)
    appendFileSync(process.env.PIANO_TEST_AUDIT, `${JSON.stringify(record)}\n`);
};
audit({ command: "start", args, sessionId, cwd: process.cwd() });
const cost = () => messages.reduce((sum, m) => sum + (m.usage?.cost?.total ?? 0), 0);

function reply(text) {
  const usage = {
    input: 1200,
    output: 300,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 1500,
    cost: { input: 0.0018, output: 0.0045, cacheRead: 0, cacheWrite: 0, total: 0.0063 },
  };
  const message = {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "fake",
    provider: model.provider,
    model: model.id,
    usage,
    stopReason: "stop",
    timestamp: Date.now(),
  };
  out({ type: "message_start", message: { ...message, content: [] } });
  out({
    type: "message_update",
    assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: text },
  });
  messages.push(message);
  out({ type: "message_end", message });
  out({ type: "turn_end", message, toolResults: [] });
  out({ type: "agent_end", messages: [message], willRetry: false });
  streaming = false;
  out({ type: "agent_settled" });
}

function handle(cmd) {
  audit({ command: cmd.type, text: cmd.message, sessionId });
  switch (cmd.type) {
    case "get_state":
      return respond(cmd, {
        sessionId,
        sessionFile,
        sessionName,
        model,
        thinkingLevel,
        isStreaming: streaming,
        isCompacting: false,
      });
    case "get_messages":
      return respond(cmd, { messages });
    case "get_entries": {
      // Extensions' custom entries come first, as Piano's dispatch record does in a real file.
      const all = [
        ...entries.filter((e) => e.type === "custom"),
        ...messages.map((message, i) => ({ type: "message", id: `e${i}`, message })),
      ];
      const since = cmd.since === undefined ? -1 : all.findIndex((e) => e.id === cmd.since);
      return respond(cmd, { entries: all.slice(since + 1), leafId: all.at(-1)?.id ?? null });
    }
    case "get_session_stats":
      return respond(cmd, {
        cost: cost(),
        contextUsage: {
          tokens: 1500 * messages.length,
          contextWindow: 200000,
          percent: 0.75 * messages.length,
        },
      });
    case "get_commands":
      return respond(cmd, { commands: [] });
    case "get_available_models":
      return respond(cmd, {
        models: [
          { provider: "fake", id: "alpha", reasoning: true, contextWindow: 200000 },
          { provider: "fake", id: "gamma", reasoning: true, contextWindow: 400000 },
        ],
      });
    case "set_model":
      model = { provider: cmd.provider, id: cmd.modelId };
      return respond(cmd, model);
    case "set_thinking_level":
      thinkingLevel = cmd.level;
      out({ type: "thinking_level_changed", level: cmd.level });
      return respond(cmd);
    case "set_session_name":
      sessionName = cmd.name;
      return respond(cmd, {});
    case "clear_queue":
      return respond(cmd, { steering: [], followUp: [] });
    case "abort":
      clearInterval(streamTimer);
      streaming = false;
      out({ type: "agent_end", messages: [], willRetry: false });
      out({ type: "agent_settled" });
      return respond(cmd);
    case "prompt": {
      if (streaming) return respond(cmd, undefined, "Agent is streaming");
      respond(cmd, { disposition: "started" });
      streaming = true;
      const user = { role: "user", content: cmd.message, timestamp: Date.now() };
      messages.push(user);
      out({ type: "agent_start" });
      out({ type: "turn_start" });
      out({ type: "message_start", message: user });
      out({ type: "message_end", message: user });
      if (cmd.message === "stream") {
        out({ type: "message_start", message: { role: "assistant", content: [] } });
        let line = 0;
        streamTimer = setInterval(() => {
          out({
            type: "message_update",
            assistantMessageEvent: {
              type: "text_delta",
              contentIndex: 0,
              delta: `Streaming line ${++line}. ${"Variable height output. ".repeat(12)}\n\n`,
            },
          });
        }, 120);
      } else if (cmd.message !== "hold") reply(`echo: ${cmd.message}`);
      return;
    }
    default:
      return respond(cmd, undefined, `fake Pi does not handle ${cmd.type}`);
  }
}

const decoder = new StringDecoder("utf8");
let buffer = "";
process.stdin.on("data", (chunk) => {
  buffer += decoder.write(chunk);
  for (let end = buffer.indexOf("\n"); end >= 0; end = buffer.indexOf("\n")) {
    const line = buffer.slice(0, end);
    buffer = buffer.slice(end + 1);
    if (line.trim()) handle(JSON.parse(line));
  }
});
process.stdin.on("end", () => process.exit(0));
