// A scripted stand-in for `pi --mode rpc`: speaks the JSONL protocol well enough to
// exercise PiSessions through its interface. Behaviour is driven by the prompt text.
import { spawn } from "node:child_process";
import { closeSync, existsSync, readdirSync, writeFileSync } from "node:fs";
import { StringDecoder } from "node:string_decoder";
// Oversized output fixtures follow Piano's inbound budget, so a policy change edits one constant.
import { inboundLimits } from "../server/InboundCapacity.ts";

const args = process.argv.slice(2);
// Simulate a personal extension remembering its project_trust decision during startup.
if (args.includes("--remember-project-trust")) {
  const { ProjectTrustStore, getAgentDir } = await import("@earendil-works/pi-coding-agent");
  new ProjectTrustStore(getAgentDir()).set(process.cwd(), true);
}
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
const dispatchedFrom = args.includes("--piano-dispatched-from")
  ? args[args.indexOf("--piano-dispatched-from") + 1]
  : undefined;
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
let startupSent = false;
let messageReads = 0;
let startupMessage;
const startupNotice = () => {
  const message = {
    role: "custom",
    customType: "startup",
    content: "STARTUP-NOTICE",
    display: true,
    timestamp: 1,
  };
  messages.push(message);
  out({ type: "message_start", message });
  out({ type: "message_end", message });
};
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
const publishedArtifacts = new Set();
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
      stopReason: "stop",
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
  if (!text.startsWith("/skill:")) return text;
  // Match Pi's literal-space delimiter, including its failure on a newline separator.
  const space = text.indexOf(" ");
  const name = space === -1 ? text.slice(7) : text.slice(7, space);
  if (!name || /\s/.test(name)) return text;
  const args = space === -1 ? "" : text.slice(space + 1).trim();
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
// slow-reader: Pi takes at least 1 ms per 4 KiB of input (256 ms per MiB) on any machine, as
// Pi's own reader does for a long line on a slow one.
const slowReader = sessionId === "slow-reader";
process.stdin.on("data", (d) => {
  buf += dec.write(d);
  drain();
  if (!slowReader || stdinPausedUntil) return;
  process.stdin.pause();
  setTimeout(() => stdinPausedUntil || process.stdin.resume(), d.length / 4096);
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
        for (let n = 0; n <= inboundLimits.records.messages; n++) out({ type: "future_event", n });
        return; // No readiness response: nothing consumes records until open completes.
      }
      if (sessionId === "capacity-record-bytes") {
        // Each record fits one RPC line; together they exceed the pending record bytes.
        const text = "x".repeat(Math.ceil(inboundLimits.records.bytes / 3));
        for (let n = 0; n < 3; n++) out({ type: "future_event", text });
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
      respond(cmd, state());
      if (sessionId.startsWith("startup-overlap") && !startupSent) {
        startupSent = true;
        startupNotice();
        if (sessionId.endsWith("identical")) startupNotice();
      }
      if (sessionId.startsWith("startup-delayed") && !startupSent) {
        startupSent = true;
        const assistant = sessionId.endsWith("assistant");
        startupMessage = assistant
          ? {
              role: "assistant",
              content: [{ type: "text", text: "STARTUP-FINAL" }],
              stopReason: "stop",
              timestamp: 1,
            }
          : {
              role: "custom",
              customType: "startup",
              content: "STARTUP-FINAL",
              display: true,
              timestamp: 1,
            };
        // Final history is visible, but message_end awaits an extension's dialog answer.
        messages.push(startupMessage);
        if (assistant) {
          streaming = true;
          out({ type: "agent_start" });
        }
        out({
          type: "message_start",
          message: assistant
            ? { ...startupMessage, content: [{ type: "text", text: "STARTUP-PARTIAL" }] }
            : startupMessage,
        });
        out({
          type: "tool_execution_start",
          toolCallId: "startup-tool",
          toolName: "read",
          args: { path: "startup.txt" },
        });
        out({
          type: "extension_ui_request",
          method: "setStatus",
          statusKey: "startup",
          statusText: "Waiting for startup answer",
        });
        out({
          type: "extension_ui_request",
          id: "startup-answer",
          method: "input",
          title: "Finish startup",
        });
      }
      return;
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
          // Like Pi, the project's templates as they were on disk when this child started.
          ...(existsSync(".pi/prompts") ? readdirSync(".pi/prompts") : [])
            .filter((file) => file.endsWith(".md"))
            .map((file) => ({ name: file.slice(0, -3), source: "prompt" })),
        ],
      });
    case "get_messages":
      messageReads++;
      // Open's one context read comes first; these fixtures disturb it.
      if (sessionId === "startup-read-failure")
        return respond(cmd, undefined, "startup read failed");
      if (sessionId === "startup-read-exit") return process.exit(3);
      if (
        sessionId === "startup-churn" ||
        (sessionId === "startup-during-read" && messageReads === 1)
      )
        startupNotice();
      // context-reads: Pi's context reports how many times it has been read.
      if (sessionId === "context-reads")
        return respond(cmd, {
          messages: [
            ...messages,
            {
              role: "custom",
              customType: "reads",
              content: `context reads: ${messageReads}`,
              display: true,
              timestamp: 1,
            },
          ],
        });
      return respond(cmd, { messages });
    case "get_entries": {
      // rejected-entries: Pi refuses to read its entries, as a failing extension could.
      if (sessionId.startsWith("rejected-entries"))
        return respond(cmd, undefined, "entries unavailable");
      const entries = [
        // `piano-dispatch` records the dispatching session once, as it does for a new child.
        ...(dispatchedFrom
          ? [
              {
                type: "custom",
                id: "e-dispatch",
                customType: "piano.dispatch",
                data: { parentSessionId: dispatchedFrom },
              },
            ]
          : []),
        ...messages.map((message, i) => ({ type: "message", id: `e-${i}`, message })),
      ];
      return respond(cmd, { entries, leafId: entries.at(-1)?.id });
    }
    case "get_session_stats":
      // held-usage: Pi never answers a usage readback, as if it were slow.
      if (sessionId.startsWith("held-usage")) return;
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
      if (cmd.id === "startup-answer") {
        out({ type: "message_end", message: startupMessage });
        out({
          type: "tool_execution_end",
          toolCallId: "startup-tool",
          toolName: "read",
          result: { content: [{ type: "text", text: "startup result" }] },
          isError: false,
        });
        streaming = false;
        out({ type: "agent_settled" });
        return;
      }
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
      // A child's edit, made where the child actually runs, before Pi admits the prompt.
      if (cmd.message.startsWith("write marker "))
        writeFileSync(`${process.cwd()}/${cmd.message.slice(13)}`, `${sessionId}\n`);
      // Stands in for the piano_preview tool: the request rides this generation's owner socket.
      if (cmd.message.startsWith("preview ")) {
        respond(cmd, { disposition: "handled" });
        import("../scripts/PreviewClient.ts")
          .then(({ ownerRequest }) =>
            ownerRequest(process.env.PIANO_PREVIEW_OWNER, JSON.parse(cmd.message.slice(8))),
          )
          .then(
            () => "preview answered",
            (error) => `preview failed: ${error.message}`,
          )
          .then((message) => out({ type: "extension_ui_request", method: "notify", message }));
        return;
      }
      // Pi accepts the prompt and is busy before its agent_start reaches Piano.
      if (cmd.message === "late start") {
        respond(cmd, { disposition: "started" });
        streaming = true;
        setTimeout(() => {
          out({ type: "agent_start" });
          const message = {
            role: "assistant",
            content: [{ type: "text", text: "Late reply" }],
            stopReason: "stop",
          };
          messages.push(message);
          out({ type: "message_end", message });
          out({ type: "agent_end", messages: [message], willRetry: false });
          streaming = false;
          out({ type: "agent_settled" });
        }, 200);
        return;
      }
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
        process.stdout.write("x".repeat(inboundLimits.rpcLineBytes + 1));
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
      if (cmd.message.startsWith("exit tail ")) {
        const mode = cmd.message.slice("exit tail ".length);
        out({ type: "agent_start" });
        const message = {
          role: "assistant",
          content: [{ type: "text", text: "Final reply before exit" }],
          stopReason: "stop",
        };
        out({ type: "message_end", message });
        if (mode === "descendant") {
          // A real inherited pipe stays open without an acknowledgement. The
          // transport must bound the drain and clean up its process group.
          const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
            stdio: ["ignore", process.stdout, "ignore"],
          });
          child.once("spawn", () => process.stdout.write("", () => process.exit(0)));
        } else if (mode === "truncated") {
          process.stdout.write('{"type":"response",', () => process.exit(0));
        } else {
          respond(cmd, { disposition: "started" });
          out({ type: "agent_end", messages: [message], willRetry: false });
          process.stdout.write(`${JSON.stringify({ type: "agent_settled" })}\n`, () =>
            process.exit(mode === "abnormal" ? 3 : 0),
          );
        }
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
      // Read and dropped: never acknowledged and never run, so Pi stays idle.
      if (cmd.message === "ignore input") return;
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
          // "ask expire": Pi advertises a 3-second timeout, so the dialog lapses unanswered.
          ...(cmd.message === "ask expire" ? { timeout: 3000 } : {}),
        });
        return; // stays streaming until answered (see extension_ui_response below is fire-and-forget; finish on answer)
      }
      if (cmd.message.startsWith("propose")) {
        // A `piano-library` save proposal: "propose hidden" changes only a value Piano redacts.
        // Imported here, not at startup, so every other fake Pi starts as fast as before.
        const hidden = cmd.message === "propose hidden";
        const files = hidden
          ? ["Use api_key: staging-111 for $1", "Use api_key: production-999 for $1"]
          : ["Deploy $1", "Deploy $1 to staging"];
        const file = (body) => `---\ndescription: "Deploy"\n---\n${body}\n`;
        import("../shared/library.ts").then(({ proposalDialog }) =>
          out({
            type: "extension_ui_request",
            id: "p1",
            method: "confirm",
            ...proposalDialog({
              kind: "prompt",
              change: "update",
              name: "deploy",
              previous: file(files[0]),
              file: file(files[1]),
            }),
          }),
        );
        return;
      }
      if (cmd.message.startsWith("exit cleanly")) process.exit(0);
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
      // A nested publication succeeds, then its outer script throws without printing the result.
      const nestedArtifact = /^codemode-artifact (\S+) (\d+) (.+)$/.exec(cmd.message);
      if (nestedArtifact) {
        const [, artifactId, revision, title] = nestedArtifact;
        const id = `artifact-code${messages.length}`;
        const receipt = {
          artifactId,
          revision: Number(revision),
          title,
          url: `https://radius.example.test/a/${artifactId}`,
          operationKey: `${artifactId}-${revision}`,
        };
        const asst = {
          role: "assistant",
          content: [
            {
              type: "toolCall",
              id,
              name: "codemode",
              arguments: {
                code: "await tools.radius_artifact_create(document); throw new Error('after publication');",
              },
            },
          ],
          timestamp: Date.now(),
        };
        messages.push(asst);
        out({ type: "message_end", message: asst });
        out({
          type: "entry_appended",
          entry: { type: "custom", customType: "radius-artifact-intent-v1", data: receipt },
        });
        out({
          type: "entry_appended",
          entry: { type: "custom", customType: "radius-artifact-publication-v1", data: receipt },
        });
        const result = {
          role: "toolResult",
          toolCallId: id,
          toolName: "codemode",
          content: [{ type: "text", text: "after publication" }],
          isError: true,
          timestamp: Date.now(),
          nestedCalls: {
            complete: false,
            calls: [
              {
                id: `${id}/1`,
                name: "radius_artifact_create",
                argumentsBytes: 121360,
                status: "ok",
              },
            ],
          },
        };
        messages.push(result);
        out({ type: "message_end", message: result });
        settle(result);
        return;
      }
      // "codemode <n> [fail <k>]": one codemode call whose script makes n nested bash/read/write
      // calls, k of them failing, as live executions each running for 150ms, then recorded in
      // its result.
      const codemode = /^codemode (\d+)(?: fail (\d+))?$/.exec(cmd.message);
      if (codemode) {
        const n = Number(codemode[1]);
        const failures = Number(codemode[2] ?? 0);
        const id = `code${messages.length}`;
        const code = `// @options: {"timeout_ms": 600000}\nfor (const file of files) await bash(\`wc -l \${file}\`);`;
        const asst = {
          role: "assistant",
          content: [{ type: "toolCall", id, name: "code", arguments: { code } }],
          model: model.id,
          provider: model.provider,
          stopReason: "toolUse",
          timestamp: Date.now(),
        };
        messages.push(asst);
        out({ type: "message_end", message: asst });
        out({ type: "tool_execution_start", toolCallId: id, toolName: "code", args: { code } });
        // Failures spread over the run, the first early enough to fold away.
        const failing = new Set(
          Array.from({ length: failures }, (_, i) => 2 + Math.floor((i * n) / failures)),
        );
        const tools = ["bash", "read", "write"];
        const calls = Array.from({ length: n }, (_, i) => {
          const name = tools[i % 3];
          const file = `/tmp/eval/file-${i + 1}.md`;
          return {
            id: `${id}/${i + 1}`,
            name,
            arguments:
              name === "bash"
                ? { command: `wc -l ${file}` }
                : name === "read"
                  ? { path: file }
                  : { path: file, content: `# ${i + 1}\n` },
            status: failing.has(i + 1) ? "error" : "ok",
          };
        });
        let i = 0;
        const step = () => {
          if (i < calls.length) {
            const c = calls[i++];
            const error = c.status === "error";
            out({
              type: "tool_execution_start",
              toolCallId: c.id,
              parentToolCallId: id,
              toolName: c.name,
              args: c.arguments,
            });
            // Each call runs for its 150ms before it ends and the next starts.
            return setTimeout(() => {
              out({
                type: "tool_execution_end",
                toolCallId: c.id,
                toolName: c.name,
                result: {
                  content: [
                    { type: "text", text: error ? "ENOENT: no such file" : `${i * 12} lines` },
                  ],
                },
                isError: error,
              });
              step();
            }, 150);
          }
          const content = [{ type: "text", text: `${n} calls, ${failures} failed` }];
          out({
            type: "tool_execution_end",
            toolCallId: id,
            toolName: "code",
            result: { content },
            isError: false,
          });
          const result = {
            role: "toolResult",
            toolCallId: id,
            toolName: "code",
            content,
            isError: false,
            nestedCalls: { complete: true, calls },
            timestamp: Date.now(),
          };
          messages.push(result);
          out({ type: "message_end", message: result });
          const reply = {
            role: "assistant",
            content: [{ type: "text", text: `Ran ${n} tool calls.` }],
            model: model.id,
            provider: model.provider,
            stopReason: "stop",
            timestamp: Date.now(),
          };
          messages.push(reply);
          out({ type: "message_end", message: reply });
          out({ type: "turn_end", message: reply, toolResults: [] });
          settle(reply);
        };
        step();
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
        // Pi ends every finished reply with its stop reason; a reply without one is still being written.
        stopReason: "stop",
        timestamp: Date.now(),
      };
      if (cmd.message === "identity files")
        asst.content.push({
          type: "toolCall",
          id: "write1",
          name: "write",
          arguments: {
            path: "keys/sk-abcdefghijklmnopqrstuvwxyz123456.ts",
            content: "sk-content-abcdefghijklmnopqrstuvwxyz",
          },
        });
      // "artifact <id> <confirmed|error> <title>": a radius-artifacts publication, as the bundled
      // extension's create (an ID not yet published) or update call and its result report it.
      const artifact = /^artifact (\S+) (confirmed|error) (.+)$/.exec(cmd.message);
      const artifactTool =
        artifact &&
        (publishedArtifacts.has(artifact[1]) ? "radius_artifact_update" : "radius_artifact_create");
      if (artifact)
        asst.content.push({
          type: "toolCall",
          id: `artifact${messages.length}`,
          name: artifactTool,
          arguments: { operationKey: artifact[1], title: artifact[3], content: "# Report" },
        });
      messages.push(asst);
      if (cmd.message === "live context")
        liveContext = { tokens: 42000, contextWindow: 200000, percent: 21 };
      out({ type: "message_end", message: asst });
      if (cmd.message === "identity files") {
        const result = {
          role: "toolResult",
          toolCallId: "write1",
          toolName: "write",
          content: "written",
          isError: false,
          nestedCalls: {
            complete: true,
            calls: [
              {
                id: "write1/edit",
                name: "edit",
                arguments: {
                  file_path: "keys/ghp_nested123456789.ts",
                  newText: "sk-content-abcdefghijklmnopqrstuvwxyz",
                },
                status: "ok",
              },
              {
                id: "write1/failed",
                name: "edit",
                arguments: { path: "failed.ts" },
                status: "error",
              },
              {
                id: "write1/pending",
                name: "write",
                arguments: { path: "pending.ts" },
                status: "unfinished",
              },
            ],
          },
        };
        out({
          type: "tool_execution_start",
          toolCallId: "write1/edit",
          parentToolCallId: "write1",
          toolName: "edit",
          args: result.nestedCalls.calls[0].arguments,
        });
        out({
          type: "tool_execution_end",
          toolCallId: "write1/edit",
          toolName: "edit",
          result: { content: [{ type: "text", text: "edited" }] },
          isError: false,
        });
        messages.push(result);
        out({ type: "message_end", message: result });
      }
      if (artifact) {
        const confirmed = artifact[2] === "confirmed";
        if (confirmed) publishedArtifacts.add(artifact[1]);
        const details = confirmed
          ? {
              status: "confirmed",
              message: "Radius publication confirmed.",
              artifactId: artifact[1],
              url: `https://radius.example.test/a/${artifact[1]}`,
              revision: 1,
            }
          : { status: "error", message: "Radius refused the publication." };
        const result = {
          role: "toolResult",
          toolCallId: asst.content.at(-1).id,
          toolName: artifactTool,
          content: [{ type: "text", text: JSON.stringify(details) }],
          details,
          isError: !confirmed,
        };
        messages.push(result);
        out({ type: "message_end", message: result });
      }
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
