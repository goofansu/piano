// Deliberately contradictory partial/final records, driven by explicit prompt barriers.
import { StringDecoder } from "node:string_decoder";

const out = (value) => process.stdout.write(JSON.stringify(value) + "\n");
const reply = (c, data, error) =>
  out({ type: "response", id: c.id, command: c.type, success: !error, data, error });
const args = process.argv.slice(2);
const sessionId = args[args.indexOf("--session-id") + 1] ?? "projection";
const canary = process.env.PIANO_TEST_SECRET ?? "sk-projection-canary-123456789";
const usage = (n) => ({
  input: 10,
  output: n,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 10 + n,
  cost: { total: n / 100 },
});
let messages = [],
  streaming = false,
  thinkingLevel = "low",
  raceContext = false,
  failRefresh = false,
  malformed = false;
const assistant = (content) => ({
  role: "assistant",
  provider: "physical",
  model: "answer",
  thinkingLevel: "high",
  content,
  usage: usage(5),
  stopReason: "stop",
});
const ui = (method, fields) => out({ type: "extension_ui_request", id: method, method, ...fields });
const delta = (type, contentIndex, fields = {}, n = 1) =>
  out({
    type: "message_update",
    usage: usage(n),
    assistantMessageEvent: { type, contentIndex, ...fields },
  });
const end = (message) => {
  messages.push(message);
  out({ type: "message_end", message });
};
function handle(c) {
  switch (c.type) {
    case "get_state":
      return reply(
        c,
        malformed
          ? { sessionId, model: "router/auto" }
          : {
              sessionId,
              model: { provider: "router", id: "auto" },
              thinkingLevel,
              isStreaming: streaming,
            },
      );
    case "get_messages": {
      if (failRefresh) return reply(c, undefined, "Fixture refresh failed " + canary);
      if (malformed) return reply(c, {});
      if (raceContext) {
        raceContext = false;
        const stale = messages;
        messages = [
          { role: "compactionSummary", summary: "Authoritative compacted context " + canary },
        ];
        ui("notify", { message: "Context changed during readback" });
        return reply(c, { messages: stale });
      }
      return reply(c, { messages });
    }
    case "get_commands":
      return reply(c, {
        commands: [{ name: "project-command", description: process.cwd(), source: "extension" }],
      });
    case "get_available_models":
      return reply(c, {
        models: [
          {
            provider: "router",
            id: "auto",
            name: process.cwd(),
            reasoning: true,
            contextWindow: 1000,
          },
        ],
      });
    case "get_session_stats":
      return reply(
        c,
        malformed
          ? { cost: "1.23" }
          : {
              cost: 1.23,
              tokens: { input: 100, output: 20, cacheRead: 30, cacheWrite: 0, total: 150 },
              contextUsage: { tokens: 50, contextWindow: 1000, percent: 5 },
            },
      );
    case "set_thinking_level":
      thinkingLevel = "low";
      return reply(c);
    case "extension_ui_response":
      return ui("notify", {
        message: c.value === canary ? "original option received" : "wrong option received",
      });
    case "prompt": {
      if (c.message === "/partial") {
        streaming = true;
        out({ type: "agent_start" });
        out({ type: "message_start", message: assistant([]) });
        delta("text_delta", 2, { delta: "second draft" });
        delta("text_delta", 0, { delta: "first draft" }, 2);
        delta("toolcall_start", 1, { id: "parent", toolName: "codemode" });
        delta("toolcall_start", 3, { id: "other", toolName: "read" });
        delta("toolcall_delta", 1, { delta: '{"code":"wrong"}' });
        delta("toolcall_end", 1, {
          toolCall: { id: "parent", name: "codemode", arguments: { code: "correct" } },
        });
        delta("text_end", 0, { content: "first corrected " }, 3);
        delta("text_end", 2, { content: "second corrected" }, 3);
      } else if (c.message === "/secret") {
        delta("text_delta", 4, { delta: " " + canary.slice(0, 12) });
      } else if (c.message === "/finish") {
        delta("text_delta", 4, { delta: canary.slice(12) });
        end(
          assistant([
            {
              type: "text",
              text: `FINAL corrected ${canary} <img src=x onerror="window.pwned=1"> [bad](javascript:alert(1))`,
            },
            { type: "toolCall", id: "parent", name: "codemode", arguments: { code: "correct" } },
          ]),
        );
        out({
          type: "tool_execution_start",
          toolCallId: "parent",
          toolName: "codemode",
          args: { code: "correct" },
        });
        out({
          type: "tool_execution_start",
          toolCallId: "parent/1",
          parentToolCallId: "parent",
          toolName: "read",
          args: { path: "/fixture" },
        });
        for (const text of ["old preview", "latest preview"])
          out({
            type: "tool_execution_update",
            toolCallId: "parent/1",
            parentToolCallId: "parent",
            toolName: "read",
            partialResult: { content: [{ type: "text", text }] },
          });
        out({
          type: "tool_execution_end",
          toolCallId: "parent/1",
          parentToolCallId: "parent",
          toolName: "read",
          result: { content: [{ type: "text", text: "nested final " + canary }] },
          isError: false,
        });
        out({
          type: "tool_execution_end",
          toolCallId: "parent",
          toolName: "codemode",
          result: { content: [{ type: "text", text: "parent final" }] },
          isError: false,
        });
        end({
          role: "toolResult",
          toolCallId: "parent",
          toolName: "codemode",
          content: [{ type: "text", text: "parent final" }],
          usage: usage(8),
          nestedCalls: {
            complete: true,
            calls: [
              {
                id: "parent/1",
                name: "read",
                arguments: { path: "/fixture" },
                status: "ok",
                durationMs: 4,
              },
            ],
          },
        });
        ui("setStatus", { statusKey: "fixture", statusText: "Projection ready " + canary });
        ui("setWidget", {
          widgetKey: "fixture",
          widgetLines: ["Widget <script>window.pwned=1</script> " + canary],
          widgetPlacement: "aboveEditor",
        });
        ui("setTitle", { title: "Extension title" });
        ui("set_editor_text", { text: "Suggested follow-up " + canary });
        ui("notify", { message: "Notice " + canary });
        streaming = false;
        out({ type: "agent_settled" });
      } else if (c.message === "/compact") {
        messages = [{ role: "compactionSummary", summary: "STALE readback" }];
        raceContext = true;
        out({ type: "compaction_end", result: { summary: "different event summary" } });
      } else if (c.message === "/refresh-fail") {
        failRefresh = true;
      } else if (c.message === "/readbacks-malformed") {
        malformed = true;
      } else if (c.message === "/refresh-recover") {
        failRefresh = false;
        malformed = false;
      } else if (c.message === "/edit-context") {
        messages = [{ role: "custom", content: "Authoritative context edit", display: true }];
      } else if (c.message === "/select-secret") {
        ui("select", { options: [canary], title: "Secret option" });
      } else if (c.message === "/clear") {
        ui("setStatus", { statusKey: "fixture" });
        ui("setWidget", { widgetKey: "fixture" });
      } else if (c.message === "/error") return reply(c, undefined, "Rejected " + canary);
      else if (c.message === "/crash") {
        process.stderr.write("Failure " + canary);
        return process.exit(3);
      }
      ui("notify", { message: "barrier " + c.message });
      return reply(c, { disposition: "handled" });
    }
    default:
      return reply(c);
  }
}
const decoder = new StringDecoder("utf8");
let buffer = "";
process.stdin.on("data", (chunk) => {
  buffer += decoder.write(chunk);
  for (let i = buffer.indexOf("\n"); i !== -1; i = buffer.indexOf("\n")) {
    const line = buffer.slice(0, i);
    buffer = buffer.slice(i + 1);
    if (line.trim()) handle(JSON.parse(line));
  }
});
process.stdin.on("end", () => process.exit(0));
