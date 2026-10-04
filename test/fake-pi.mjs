// A scripted stand-in for `pi --mode rpc`: speaks the JSONL protocol well enough to
// exercise PiSessions through its interface. Behaviour is driven by the prompt text.
import { StringDecoder } from "node:string_decoder";

const args = process.argv.slice(2);
const sessionId = args[args.indexOf("--session-id") + 1] || "nosession";
const modelArg = args.includes("--model") ? args[args.indexOf("--model") + 1] : "fake/alpha";
let model = { provider: modelArg.split("/")[0], id: modelArg.split("/")[1] };
let thinkingLevel = "medium";
const state = () => ({ model, thinkingLevel, isStreaming: streaming, sessionFile: `/tmp/${sessionId}.jsonl`, sessionId, sessionName: "fake" });
const out = (o) => process.stdout.write(JSON.stringify(o) + "\n");
let streaming = false;
let liveContext;
let liveStage = 0;
const followUp = [];
const messages = [];
const queueUpdate = () => out({ type: "queue_update", steering: [], followUp: [...followUp] });
const settle = (last) => {
  out({ type: "agent_end", messages: last ? [last] : [], willRetry: false });
  while (followUp.length) {
    const text = followUp.shift();
    queueUpdate(); // Pi removes a pending message before it starts appearing in history.
    const user = { role: "user", content: text, timestamp: Date.now() };
    const assistant = { role: "assistant", content: [{ type: "text", text: `echo: ${text}` }], model: model.id, provider: model.provider, timestamp: Date.now() };
    out({ type: "agent_start" });
    messages.push(user);
    out({ type: "message_start", message: user }); out({ type: "message_end", message: user });
    messages.push(assistant);
    out({ type: "message_end", message: assistant });
    out({ type: "agent_end", messages: [assistant], willRetry: false });
  }
  streaming = false;
  out({ type: "agent_settled" });
};
const dec = new StringDecoder("utf8");
let buf = "";

process.stdin.on("data", (d) => {
  buf += dec.write(d);
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    if (line.trim()) handle(JSON.parse(line));
  }
});
process.stdin.on("end", () => { out({ type: "bye" }); process.exit(0); });

const respond = (cmd, data, error) => out({ id: cmd.id, type: "response", command: cmd.type, success: !error, ...(error ? { error } : { data }) });

function handle(cmd) {
  switch (cmd.type) {
    case "get_state": return respond(cmd, state());
    case "get_messages": return respond(cmd, { messages });
    case "get_session_stats": return respond(cmd, { cost: 0.01 * messages.length, contextUsage: liveContext ?? { tokens: 1200 * messages.length, contextWindow: model.id === "beta" ? 400000 : 200000, percent: (model.id === "beta" ? 0.3 : 0.6) * messages.length } });
    case "get_available_models": return respond(cmd, { models: [
      { provider: "fake", id: "alpha", reasoning: true, contextWindow: 1000, thinkingLevelMap: { minimal: null, xhigh: "xhigh" } },
      { provider: "fake", id: "beta", reasoning: false, contextWindow: 2000 } ] });
    case "set_model": model = { provider: cmd.provider, id: cmd.modelId }; return respond(cmd, model);
    case "set_thinking_level": thinkingLevel = cmd.level; out({ type: "thinking_level_changed", level: cmd.level }); return respond(cmd, undefined);
    case "abort": settle(); return respond(cmd, undefined);
    case "follow_up": {
      if (cmd.message === "reject queue") return respond(cmd, undefined, "queue rejected");
      if (cmd.message === "handled queue") return respond(cmd, { disposition: "handled" });
      followUp.push(cmd.message === "expand queue" ? "expanded follow-up" : cmd.message);
      queueUpdate();
      return respond(cmd, { disposition: "queued" });
    }
    case "extension_ui_response": {
      if (liveStage === 1) {
        liveStage = 2;
        liveContext = { tokens: null, contextWindow: 200000, percent: null };
        out({ type: "compaction_end", reason: "threshold", result: { summary: "compacted", tokensBefore: 42000 }, aborted: false, willRetry: false });
        out({ type: "extension_ui_request", id: "live2", method: "input", title: "After compaction" });
        return;
      }
      out({ type: "extension_ui_request", id: "n1", method: "notify", message: `answered ${cmd.id} with ${cmd.value ?? cmd.confirmed ?? "cancel"}`, notifyType: "info" });
      const asst = { role: "assistant", content: [{ type: "text", text: `you said ${cmd.value ?? ""}` }], model: model.id, provider: model.provider, timestamp: Date.now() };
      messages.push(asst);
      out({ type: "message_end", message: asst });
      settle(asst);
      return;
    }
    case "prompt": {
      if (streaming) return respond(cmd, undefined, "Agent is streaming; specify streamingBehavior");
      respond(cmd, undefined);
      streaming = true;
      const user = { role: "user", content: cmd.message, timestamp: Date.now() };
      messages.push(user);
      out({ type: "agent_start" }); out({ type: "turn_start" });
      out({ type: "message_start", message: user }); out({ type: "message_end", message: user });
      if (cmd.message.startsWith("ask")) {
        out({ type: "extension_ui_request", id: "d1", method: "input", title: "Enter a value", placeholder: "type" });
        return; // stays streaming until answered (see extension_ui_response below is fire-and-forget; finish on answer)
      }
      if (cmd.message.startsWith("crash")) { process.stderr.write("boom\n"); process.exit(3); }
      const text = `echo: ${cmd.message}`;
      out({ type: "message_start", message: { role: "assistant", content: [], model: model.id, provider: model.provider } });
      for (const ch of text) out({ type: "message_update", usage: {}, assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: ch } });
      const asst = { role: "assistant", content: [{ type: "text", text }], model: model.id, provider: model.provider, timestamp: Date.now() };
      messages.push(asst);
      if (cmd.message === "live context") liveContext = { tokens: 42000, contextWindow: 200000, percent: 21 };
      out({ type: "message_end", message: asst });
      out({ type: "turn_end", message: asst, toolResults: [] });
      if (cmd.message === "live context") {
        liveStage = 1;
        out({ type: "extension_ui_request", id: "live1", method: "input", title: "Running after response" });
        return; // deterministic pause before the next response, not agent_settled
      }
      settle(asst);
      return;
    }
    default: return respond(cmd, undefined, `unknown ${cmd.type}`);
  }
}
