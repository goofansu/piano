// Deterministic dialog/abort barriers at the actual Pi JSONL process seam. No model calls.
import { closeSync } from "node:fs";
import { StringDecoder } from "node:string_decoder";

const out = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
const reply = (cmd, data) =>
  out({ type: "response", id: cmd.id, command: cmd.type, success: true, data });
const notice = (message) =>
  out({ type: "extension_ui_request", id: "notice", method: "notify", message });
const args = process.argv.slice(2);
const sessionId = args[args.indexOf("--session-id") + 1];
const pending = new Map();
const responses = [];
// Piano's ask_user tool as Pi's native records show it: a running call raises its question and
// ends with the batch result it stores. `mode` scripts what the fixture does with the reply.
const questions = new Map();
const held = new Set();
const toolEnd = (call, answers) => {
  const status = answers.length === call.count ? "answered" : "cancelled";
  const result = { status, answers: Object.fromEntries(answers.map((a, i) => [`q${i + 1}`, a])) };
  out({
    type: "tool_execution_end",
    toolCallId: call.id,
    toolName: "ask_user",
    result: { content: [{ type: "text", text: JSON.stringify(result) }], details: result },
    isError: false,
  });
};
const ask = (call) => {
  const id = `d${++serial}`;
  call.asked++;
  questions.set(id, call);
  out({ type: "extension_ui_request", id, method: "editor", title: `Question ${id}` });
};
let serial = 0,
  streaming = false,
  abortHeld,
  holdAbort = false,
  model = "alpha";
function dialog(cmd, method = "input", timeout) {
  const id = `d${++serial}`;
  pending.set(id, cmd);
  out({
    type: "extension_ui_request",
    id,
    method,
    title: `Fixture ${id}`,
    options: ["A", "B"],
    ...(timeout ? { timeout } : {}),
  });
}
function handle(cmd) {
  switch (cmd.type) {
    case "get_state":
      return reply(cmd, {
        sessionId,
        isStreaming: streaming,
        model: { provider: "fake", id: model },
        thinkingLevel: "off",
      });
    case "get_commands":
      return reply(cmd, { commands: [] });
    case "get_messages":
      return reply(cmd, { messages: [] });
    case "get_session_stats":
      return reply(cmd, {});
    case "get_entries":
      return reply(cmd, { entries: [], leafId: null });
    case "get_available_models":
      return reply(cmd, {
        models: [{ provider: "fake", id: "alpha", reasoning: false, contextWindow: 200000 }],
      });
    case "extension_ui_response":
      responses.push(cmd);
      if (questions.has(cmd.id)) {
        const call = questions.get(cmd.id);
        questions.delete(cmd.id);
        const last = call.asked >= call.count;
        if (!cmd.cancelled && call.mode !== "drop" && !(call.mode === "drop-last" && last))
          call.answers.push(cmd.value);
        if (call.mode === "hold") held.add(call);
        else if (cmd.cancelled || call.mode === "drop" || last) toolEnd(call, call.answers);
        else ask(call);
        return;
      }
      if (!cmd.cancelled) model = "beta"; // An extension command changes model after its dialog returns.
      if (pending.has(cmd.id)) {
        if (pending.get(cmd.id)) reply(pending.get(cmd.id), { disposition: "handled" });
        pending.delete(cmd.id);
      }
      return notice(`received ${cmd.id}`);
    case "abort":
      if (holdAbort) {
        abortHeld = cmd;
        dialog(undefined); // A supported dialog arriving while abort acknowledgement is pending.
        return;
      }
      streaming = false;
      out({ type: "agent_settled" });
      return reply(cmd);
    case "prompt": {
      // `/ask [mode] [count]`: ask_user starts and raises its first question. Modes: `hold`
      // keeps the call running after the reply until `/end-held`; `drop` ends it without storing
      // the reply (Pi aborted it first); `drop-last` stores every reply but the last one.
      if (cmd.message.startsWith("/ask")) {
        const [, mode = "store", count = "1"] = cmd.message.split(" ");
        const call = { id: `call${++serial}`, mode, count: Number(count), asked: 0, answers: [] };
        const questions = Array.from({ length: call.count }, (_, i) => ({
          id: `q${i + 1}`,
          question: `Question ${i + 1}`,
        }));
        out({
          type: "tool_execution_start",
          toolCallId: call.id,
          toolName: "ask_user",
          args: { questions },
        });
        ask(call);
        return reply(cmd, { disposition: "handled" });
      }
      if (cmd.message === "/end-held") {
        for (const call of held) toolEnd(call, call.answers);
        held.clear();
      }
      if (cmd.message === "/close-ask") {
        for (const [id, call] of questions) {
          questions.delete(id);
          toolEnd(call, call.answers);
        }
      }
      if (cmd.message.startsWith("/dialog")) {
        const [, method, timeout] = cmd.message.split(" ");
        return dialog(cmd, method, Number(timeout)); // originating command acknowledgement is blocked
      }
      if (cmd.message === "/hold-abort") holdAbort = true;
      if (cmd.message === "/new-turn" || cmd.message === "/new-turn-release-abort") {
        streaming = true;
        out({ type: "agent_start" });
        dialog(undefined);
      }
      if (cmd.message === "/release-abort" || cmd.message === "/new-turn-release-abort") {
        reply(abortHeld);
        abortHeld = undefined;
        notice("old abort acknowledged");
      }
      if (cmd.message === "/audit") notice(`audit ${JSON.stringify(responses)}`);
      if (cmd.message === "/close-input") {
        closeSync(0);
        setInterval(() => {}, 1000);
        notice("input closed");
        return;
      }
      if (cmd.message === "/exit") process.exit(3);
      return reply(cmd, { disposition: "handled" });
    }
  }
}
const decoder = new StringDecoder("utf8");
let buffer = "";
process.stdin.on("data", (chunk) => {
  buffer += decoder.write(chunk);
  for (let newline = buffer.indexOf("\n"); newline >= 0; newline = buffer.indexOf("\n")) {
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    if (line) handle(JSON.parse(line));
  }
});
process.stdin.on("end", () => process.exit(0));
