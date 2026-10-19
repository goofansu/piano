// A compacted ~1 MiB context followed by provider/tool boundaries. Pacing belongs to the
// provider/tool fixture, never to how often Piano asks for state or messages.
import { writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { setTimeout as delay } from "node:timers/promises";

const args = process.argv.slice(2);
const sessionId = args[args.indexOf("--session-id") + 1];
const metricsPath = args[args.indexOf("--metrics") + 1];
const metrics = { activeReads: 0, activeBytes: 0, settledReads: 0, settledBytes: 0 };
let messages = [];
let active = false;
let prompted = false;
const out = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
const reply = (command, data) => {
  const response = { type: "response", id: command.id, command: command.type, success: true, data };
  if (command.type === "get_messages" && prompted) {
    const phase = active ? "active" : "settled";
    metrics[`${phase}Reads`]++;
    metrics[`${phase}Bytes`] += Buffer.byteLength(JSON.stringify(response));
    writeFileSync(metricsPath, JSON.stringify(metrics));
  }
  out(response);
};
const end = (message) => {
  messages.push(message);
  out({ type: "message_start", message });
  out({ type: "message_end", message });
};
const assistant = (content) => ({
  role: "assistant",
  provider: "fake",
  model: "alpha",
  content,
  timestamp: 1,
});
async function prompt(command) {
  prompted = true;
  active = true;
  writeFileSync(metricsPath, JSON.stringify(metrics));
  // Pi compacts in preparation, before agent_start. get_state already knows it is active.
  out({ type: "compaction_start", reason: "threshold" });
  messages = [{ role: "compactionSummary", summary: "x".repeat(1024 * 1024) }];
  out({ type: "compaction_end" });
  out({ type: "agent_start" });
  end({ role: "user", content: command.message, timestamp: 1 });
  reply(command, { disposition: "started" });
  for (let i = 0; i < 5; i++) {
    await delay(150);
    end(
      assistant([
        { type: "toolCall", id: `tool-${i}`, name: "read", arguments: { path: `${i}.txt` } },
      ]),
    );
    out({
      type: "tool_execution_start",
      toolCallId: `tool-${i}`,
      toolName: "read",
      args: { path: `${i}.txt` },
    });
    await delay(150);
    const result = { content: [{ type: "text", text: `result ${i}` }], isError: false };
    out({
      type: "tool_execution_end",
      toolCallId: `tool-${i}`,
      toolName: "read",
      result,
      isError: false,
    });
    end({ role: "toolResult", toolCallId: `tool-${i}`, toolName: "read", ...result, timestamp: 1 });
  }
  await delay(150);
  end(assistant([{ type: "text", text: "DONE" }]));
  active = false;
  out({ type: "agent_end", messages: [], willRetry: false });
  out({ type: "agent_settled" });
}
createInterface({ input: process.stdin }).on("line", (line) => {
  const command = JSON.parse(line);
  switch (command.type) {
    case "get_state":
      return reply(command, {
        sessionId,
        isStreaming: active,
        model: { provider: "fake", id: "alpha" },
      });
    case "get_messages":
      return reply(command, { messages });
    case "get_entries":
      return reply(command, { entries: [] });
    case "get_session_stats":
      return reply(command, {
        cost: 1.25,
        contextUsage: { tokens: 1000, contextWindow: 10000, percent: 10 },
      });
    case "get_commands":
      return reply(command, { commands: [] });
    case "prompt":
      void prompt(command);
      return;
    default:
      throw new Error(`Unexpected command: ${command.type}`);
  }
});
