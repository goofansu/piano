// A scripted stand-in for `pi --mode rpc`: speaks the JSONL protocol well enough to
// exercise PiSessions through its interface. Behaviour is driven by the prompt text.
import { closeSync, existsSync } from "node:fs";
import { StringDecoder } from "node:string_decoder";

const args = process.argv.slice(2);
const verifyChildEnvironment = args.includes("--verify-child-environment");
let verifiedImage = false;
if (verifyChildEnvironment) {
  if ("WATCH_REPORT_DEPENDENCIES" in process.env)
    throw new Error("Pi child inherited WATCH_REPORT_DEPENDENCIES");
  if (process.env.PIANO_TEST_PRESERVED_ENV !== "preserved")
    throw new Error("Pi child lost an unrelated environment variable");
  const { processImage } = await import(
    new URL(
      "../node_modules/@earendil-works/pi-coding-agent/dist/utils/image-process.js",
      import.meta.url,
    ).href
  );
  // Valid 1×1 RGBA PNG, including chunk CRCs, for the installed Pi decoder.
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==",
    "base64",
  );
  const image = await processImage(png, "image/png");
  if (!image.ok) throw new Error(image.message);
  verifiedImage = true;
}
const environmentFixture = verifyChildEnvironment
  ? `env:${process.env.PIANO_TEST_PRESERVED_ENV};image:${verifiedImage ? "accepted" : "omitted"}`
  : undefined;
const sessionId = args[args.indexOf("--session-id") + 1] || "nosession";
const modelArg = args.includes("--model") ? args[args.indexOf("--model") + 1] : "fake/alpha";
let model = { provider: modelArg.split("/")[0], id: modelArg.split("/")[1] };
let thinkingLevel = "medium";
let sessionName = environmentFixture ?? "fake";
const state = () => ({
  model,
  thinkingLevel,
  isStreaming: streaming,
  isCompacting: compacting,
  sessionFile: `/tmp/${sessionId}.jsonl`,
  sessionId,
  sessionName,
});
const out = (o) => process.stdout.write(JSON.stringify(o) + "\n");
let streaming = false;
let compacting = false;
let delayedPrompt;
let heldState;
let heldClear;
let holdNextState = false;
const capacityHeld = [];
// capacity-readback: usage readbacks Pi holds alongside the held prompts.
const heldReads = [];
let capacityRound = 0;
const capacityCount = () =>
  out({
    type: "extension_ui_request",
    id: "capacity-count",
    method: "notify",
    message: `Capacity held: ${capacityHeld.length + heldReads.length}`,
  });
function releaseCapacity() {
  for (const cmd of capacityHeld.splice(0)) respond(cmd, { disposition: "handled" });
  for (const cmd of heldReads.splice(0)) handle(cmd);
}
let liveContext;
let liveStage = 0;
const steering = [];
const followUp = [];
const messages = [];
const queueUpdate = () =>
  out({ type: "queue_update", steering: [...steering], followUp: [...followUp] });
const settle = (last) => {
  out({ type: "agent_end", messages: last ? [last] : [], willRetry: false });
  while (steering.length || followUp.length) {
    const text = steering.length ? steering.shift() : followUp.shift();
    queueUpdate(); // Pi removes a pending message before it starts appearing in history.
    const user = { role: "user", content: text, timestamp: Date.now() };
    const assistant = {
      role: "assistant",
      content: [{ type: "text", text: `echo: ${text}` }],
      model: model.id,
      provider: model.provider,
      timestamp: Date.now(),
    };
    out({ type: "agent_start" });
    messages.push(user);
    out({ type: "message_start", message: user });
    out({ type: "message_end", message: user });
    messages.push(assistant);
    out({ type: "message_end", message: assistant });
    out({ type: "agent_end", messages: [assistant], willRetry: false });
  }
  streaming = false;
  out({ type: "agent_settled" });
};
/** Pi rewrites a `/skill:name args` prompt into the skill file before it enters history. */
const expandSkill = (text) => {
  const match = /^\/skill:(\S+)\s*([\s\S]*)$/.exec(text);
  if (!match) return text;
  const [, name, args] = match;
  const block = `<skill name="${name}" location="/fake/skills/${name}/SKILL.md">\nReferences are relative to /fake/skills/${name}.\n\n# ${name}\n\nFake skill body for **${name}**.\n</skill>`;
  return args ? `${block}\n\n${args}` : block;
};
const dec = new StringDecoder("utf8");
let buf = "";
/** While set, Pi reads no more input, as a blocked Pi would, until this file exists. */
let stdinPausedUntil;

const drain = () => {
  for (let i = buf.indexOf("\n"); !stdinPausedUntil && i >= 0; i = buf.indexOf("\n")) {
    const line = buf.slice(0, i);
    buf = buf.slice(i + 1);
    if (line.trim()) handle(JSON.parse(line));
  }
};
process.stdin.on("data", (d) => {
  buf += dec.write(d);
  drain();
});
process.stdin.on("end", () => {
  out({ type: "bye" });
  process.exit(0);
});

const respond = (cmd, data, error) =>
  out({
    id: cmd.id,
    type: "response",
    command: cmd.type,
    success: !error,
    ...(error ? { error } : { data }),
  });

function handle(cmd) {
  switch (cmd.type) {
    case "get_state":
      if (sessionId === "capacity-records") {
        for (let n = 0; n < 257; n++) out({ type: "future_event", n });
        return; // No readiness response: nothing consumes records until open completes.
      }
      if (sessionId === "capacity-record-bytes") {
        for (let n = 0; n < 3; n++)
          out({ type: "future_event", text: "x".repeat(12 * 1024 * 1024) });
        return;
      }
      if (args.includes("--silence-readiness")) return; // alive, but never ready
      if (holdNextState) {
        holdNextState = false;
        heldState = { cmd, data: state() };
        out({
          type: "extension_ui_request",
          id: "held-state",
          method: "notify",
          message: "Fixture captured an old state response",
        });
        return;
      }
      return respond(cmd, state());
    case "get_commands":
      if (sessionId === "silent-commands") return; // a readback Pi never answers
      if (heldClear) {
        respond(heldClear.cmd, heldClear.restored);
        heldClear = undefined;
      }
      return respond(cmd, {
        commands: [
          { name: "handled", description: "Handle without a model call", source: "extension" },
          { name: "handled", description: "Shadowed template", source: "prompt" },
          { name: "skill:research", description: "Investigate a question", source: "skill" },
          {
            name: args.includes("--no-session") ? "skill:probe-only" : "skill:live-only",
            source: "skill",
          },
          { name: "review", description: "Review changes", source: "prompt" },
          { name: args.includes("--no-session") ? "probe-only" : "live-only", source: "extension" },
        ],
      });
    case "get_messages":
      return respond(cmd, { messages });
    case "get_entries": {
      // A Pi without pi-subagent: ordinary entries, plus near misses another extension could write.
      const entries = [
        {
          type: "custom_message",
          id: "e-other",
          customType: "todo-reminder",
          content: "Remember",
          display: true,
          details: {
            runId: "r",
            agent: "a",
            usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, cost: 1 },
          },
        },
        {
          type: "message",
          id: "e-read",
          message: {
            role: "toolResult",
            toolCallId: "t",
            toolName: "read",
            content: [{ type: "text", text: "file" }],
            usage: {
              input: 1,
              output: 1,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 2,
              cost: { total: 1 },
            },
            details: { kind: "collection", runs: [] },
          },
        },
        ...messages.map((message, i) => ({ type: "message", id: `e-${i}`, message })),
      ];
      const since =
        cmd.since === undefined ? -1 : entries.findIndex((entry) => entry.id === cmd.since);
      if (cmd.since !== undefined && since === -1)
        return respond(cmd, undefined, `Entry not found: ${cmd.since}`);
      return respond(cmd, { entries: entries.slice(since + 1), leafId: entries.at(-1).id });
    }
    case "get_session_stats":
      if (sessionId === "capacity-readback" && capacityHeld.length) {
        heldReads.push(cmd);
        return capacityCount();
      }
      return respond(cmd, {
        cost: 0.01 * messages.length,
        contextUsage: liveContext ?? {
          tokens: 1200 * messages.length,
          contextWindow: model.id === "beta" ? 400000 : 200000,
          percent: (model.id === "beta" ? 0.3 : 0.6) * messages.length,
        },
      });
    case "get_available_models":
      return respond(cmd, {
        models: [
          {
            provider: "fake",
            id: "alpha",
            name: environmentFixture,
            reasoning: true,
            contextWindow: 1000,
            thinkingLevelMap: { minimal: null, xhigh: "xhigh" },
          },
          { provider: "fake", id: "beta", reasoning: false, contextWindow: 2000 },
        ],
      });
    case "set_model":
      model = { provider: cmd.provider, id: cmd.modelId };
      return respond(cmd, model);
    case "set_thinking_level":
      thinkingLevel = cmd.level;
      out({ type: "thinking_level_changed", level: cmd.level });
      return respond(cmd, undefined);
    case "abort":
      releaseCapacity();
      if (sessionId === "stop-abort-exit") return process.exit(3);
      if (sessionId === "stop-abort-failure")
        return respond(cmd, undefined, "fixture abort failed");
      if (sessionId.startsWith("stop-") && (steering.length || followUp.length))
        return respond(cmd, undefined, "abort before clear");
      // Pi 1.0.2 abort pauses pending work; it does not consume its queues.
      streaming = false;
      out({ type: "agent_end", messages: [], willRetry: false });
      out({ type: "agent_settled" });
      if (sessionId === "response-notifications")
        out({ type: "extension_ui_request", method: "notify", message: "completion barrier" });
      return respond(cmd, undefined);
    case "clear_queue": {
      if (sessionId === "stop-clear-failure")
        return respond(cmd, undefined, "fixture clear failed");
      const restored = { steering: [...steering], followUp: [...followUp] };
      steering.length = 0;
      followUp.length = 0;
      queueUpdate();
      if (sessionId === "stop-concurrent") {
        heldClear = { cmd, restored };
        return;
      }
      return respond(cmd, restored);
    }
    case "follow_up": {
      if (cmd.message === "reject queue") return respond(cmd, undefined, "queue rejected");
      if (cmd.message === "handled queue") return respond(cmd, { disposition: "handled" });
      followUp.push(cmd.message === "expand queue" ? "expanded follow-up" : cmd.message);
      queueUpdate();
      return respond(cmd, { disposition: "queued" });
    }
    case "extension_ui_response": {
      if (cmd.id.startsWith("capacity-")) {
        releaseCapacity();
        streaming = false;
        out({
          type: "extension_ui_request",
          id: "capacity-answered",
          method: "notify",
          message: "Capacity dialog answered",
        });
        settle();
        return;
      }
      if (liveStage === 1) {
        liveStage = 2;
        liveContext = { tokens: null, contextWindow: 200000, percent: null };
        out({
          type: "compaction_end",
          reason: "threshold",
          result: { summary: "compacted", tokensBefore: 42000 },
          aborted: false,
          willRetry: false,
        });
        out({
          type: "extension_ui_request",
          id: "live2",
          method: "input",
          title: "After compaction",
        });
        return;
      }
      out({
        type: "extension_ui_request",
        id: "n1",
        method: "notify",
        message: `answered ${cmd.id} with ${cmd.value ?? cmd.confirmed ?? "cancel"}`,
        notifyType: "info",
      });
      // A dialog released after native abort must not fabricate an assistant
      // reply or drain the queue that real Pi has paused.
      if (cmd.cancelled && !streaming) return;
      const asst = {
        role: "assistant",
        content: [{ type: "text", text: `you said ${cmd.value ?? ""}` }],
        model: model.id,
        provider: model.provider,
        timestamp: Date.now(),
      };
      messages.push(asst);
      out({ type: "message_end", message: asst });
      settle(asst);
      return;
    }
    case "prompt": {
      if (cmd.message.startsWith("notification ")) {
        respond(cmd, { disposition: "started" });
        if (cmd.message !== "notification finish") {
          streaming = true;
          out({ type: "agent_start" });
        }
        const message = {
          role: "assistant",
          content: [{ type: "text", text: "Private reply" }],
          stopReason:
            cmd.message === "notification error"
              ? "error"
              : cmd.message === "notification length"
                ? "length"
                : "stop",
        };
        messages.push(message);
        out({ type: "message_end", message });
        out({
          type: "agent_end",
          messages: [message],
          willRetry: cmd.message === "notification pause",
        });
        if (cmd.message !== "notification pause") {
          streaming = false;
          out({ type: "agent_settled" });
          out({ type: "agent_settled" }); // duplicate lifecycle records must not duplicate completion
        }
        out({ type: "extension_ui_request", method: "notify", message: "completion barrier" });
        return;
      }
      if (cmd.message === "capacity hold") {
        if (capacityHeld.length === 0)
          out({
            type: "extension_ui_request",
            id: `capacity-${++capacityRound}`,
            method: "input",
            title: "Release capacity",
          });
        capacityHeld.push(cmd);
        streaming = true;
        // The user message's end makes Piano refresh usage in the background.
        if (sessionId === "capacity-readback" && capacityHeld.length === 1)
          out({
            type: "message_end",
            message: { role: "user", content: cmd.message, timestamp: Date.now() },
          });
        return capacityCount();
      }
      if (cmd.message === "capacity oversized-line") {
        process.stdout.write("x".repeat(32 * 1024 * 1024 + 1));
        return; // Intentionally no newline and no response.
      }
      if (cmd.message === "capacity fragmented") {
        const bytes = Buffer.from(
          JSON.stringify({
            type: "extension_ui_request",
            id: "unicode",
            method: "notify",
            message: "Fragmented € record",
          }) + "\n",
        );
        const split = bytes.indexOf(Buffer.from("€")) + 1;
        process.stdout.write(bytes.subarray(0, split));
        setImmediate(() => {
          process.stdout.write(bytes.subarray(split));
          respond(cmd, { disposition: "handled" });
        });
        return;
      }
      if (cmd.message.startsWith("protocol raw:")) {
        process.stdout.write(`${cmd.message.slice("protocol raw:".length)}\n`);
        return;
      }
      if (cmd.message === "protocol eof") {
        process.stdout.end();
        return;
      }
      if (cmd.message === "protocol future") out({ type: "future_event", extra: { version: 2 } });
      // Extension commands run before busy checks. Never accept these through follow_up.
      if (cmd.message === "/handled") {
        model = { provider: "fake", id: "beta" };
        thinkingLevel = "high";
        return respond(cmd, { disposition: "handled" });
      }
      if (cmd.message === "handled input" || cmd.message === "handled queue")
        return respond(cmd, { disposition: "handled" });
      if (cmd.message === "/hold-state") {
        holdNextState = true;
        return respond(cmd, { disposition: "handled" });
      }
      if (cmd.message === "/release-state") {
        respond(cmd, { disposition: "handled" });
        if (heldState) {
          respond(heldState.cmd, heldState.data);
          heldState = undefined;
        }
        return;
      }
      if (cmd.message === "withhold acknowledgement") {
        delayedPrompt = cmd;
        streaming = true;
        out({ type: "agent_start" });
        out({
          type: "extension_ui_request",
          id: "withheld",
          method: "notify",
          message: "Fixture received input without acknowledging it",
        });
        return;
      }
      if (cmd.message === "/release-ack") {
        respond(cmd, { disposition: "handled" });
        if (delayedPrompt) {
          respond(delayedPrompt, { disposition: "started" });
          delayedPrompt = undefined;
        }
        return;
      }
      if (cmd.message === "/retry") {
        out({ type: "agent_end", messages: [], willRetry: true });
        out({
          type: "auto_retry_start",
          attempt: 1,
          maxAttempts: 3,
          delayMs: 2000,
          errorMessage: "fixture overload",
        });
        return respond(cmd, { disposition: "handled" });
      }
      if (cmd.message === "/compact") {
        compacting = true;
        out({ type: "agent_end", messages: [], willRetry: false });
        out({ type: "compaction_start", reason: "overflow" });
        return respond(cmd, { disposition: "handled" });
      }
      if (cmd.message === "/summary-retry") {
        out({
          type: "summarization_retry_scheduled",
          attempt: 1,
          maxAttempts: 3,
          delayMs: 1000,
          errorMessage: "fixture summary error",
        });
        return respond(cmd, { disposition: "handled" });
      }
      if (cmd.message === "/recover") {
        compacting = false;
        out({ type: "summarization_retry_finished" });
        out({ type: "compaction_end", reason: "overflow", aborted: false, willRetry: true });
        out({ type: "auto_retry_end", success: true, attempt: 1 });
        settle();
        return respond(cmd, { disposition: "handled" });
      }
      if (cmd.message === "reject queue" || cmd.message === "reject input" || compacting)
        return respond(
          cmd,
          undefined,
          compacting ? "Cannot prompt during compaction" : "input rejected",
        );
      if (streaming) {
        if (!["followUp", "steer"].includes(cmd.streamingBehavior))
          return respond(cmd, undefined, "Agent is streaming; specify streamingBehavior");
        const queue = cmd.streamingBehavior === "steer" ? steering : followUp;
        queue.push(
          cmd.message === "expand queue"
            ? cmd.streamingBehavior === "steer"
              ? "expanded steering"
              : "expanded follow-up"
            : cmd.message,
        );
        queueUpdate();
        return respond(cmd, { disposition: "queued" });
      }
      respond(cmd, { disposition: "started" });
      streaming = true;
      const expanded = expandSkill(cmd.message);
      const user = {
        role: "user",
        content: cmd.images?.length ? [{ type: "text", text: expanded }, ...cmd.images] : expanded,
        timestamp: Date.now(),
      };
      messages.push(user);
      out({ type: "agent_start" });
      out({ type: "turn_start" });
      out({ type: "message_start", message: user });
      out({ type: "message_end", message: user });
      if (cmd.message.startsWith("ask")) {
        out({
          type: "extension_ui_request",
          id: "d1",
          method: "input",
          title: "Enter a value",
          placeholder: "type",
        });
        return; // stays streaming until answered (see extension_ui_response below is fire-and-forget; finish on answer)
      }
      if (cmd.message.startsWith("crash")) {
        process.stderr.write("boom\n");
        process.exit(3);
      }
      if (cmd.message.startsWith("close stdin then crash")) {
        // Piano's next write fails before the exit it precedes is observed.
        process.stdin.destroy();
        closeSync(0);
        process.stderr.write("boom\n");
        setTimeout(() => process.exit(3), 300);
        return;
      }
      if (cmd.message.startsWith("close stdin and keep running")) {
        process.stdin.destroy();
        closeSync(0);
        setInterval(() => {}, 1000);
        return;
      }
      const text = `echo: ${cmd.message}`;
      out({
        type: "message_start",
        message: { role: "assistant", content: [], model: model.id, provider: model.provider },
      });
      for (const ch of text)
        out({
          type: "message_update",
          usage: {},
          assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: ch },
        });
      const asst = {
        role: "assistant",
        content: [{ type: "text", text }],
        model: model.id,
        provider: model.provider,
        timestamp: Date.now(),
      };
      messages.push(asst);
      if (cmd.message === "live context")
        liveContext = { tokens: 42000, contextWindow: 200000, percent: 21 };
      out({ type: "message_end", message: asst });
      out({ type: "turn_end", message: asst, toolResults: [] });
      if (cmd.message === "live context") {
        liveStage = 1;
        out({
          type: "extension_ui_request",
          id: "live1",
          method: "input",
          title: "Running after response",
        });
        return; // deterministic pause before the next response, not agent_settled
      }
      settle(asst);
      return;
    }
    case "set_session_name":
      sessionName = cmd.name;
      if (cmd.name === "withhold acknowledgement") return; // applied, never acknowledged
      if (cmd.name.startsWith("pause stdin until ")) {
        // Stop reading stdin, so Piano's input backs up, with a dialog open; never acknowledged.
        stdinPausedUntil = cmd.name.slice("pause stdin until ".length);
        process.stdin.pause();
        out({ type: "extension_ui_request", id: "paused", method: "input", title: "Paused" });
        const poll = setInterval(() => {
          if (!existsSync(stdinPausedUntil)) return;
          clearInterval(poll);
          stdinPausedUntil = undefined;
          drain();
          process.stdin.resume();
        }, 10);
        return;
      }
      return respond(cmd, {});
    default:
      return respond(cmd, undefined, `unknown ${cmd.type}`);
  }
}
