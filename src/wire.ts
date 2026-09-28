/**
 * Wire protocol shared by all runners and the browser.
 *
 * RenderMsg / WireEvent shapes are borrowed from pi-remote-control so the UI
 * can be reused. EventBridge turns pi session events (SDK, JSON, or RPC
 * flavour) into WireEvents.
 */

export interface RenderMsg {
  id: string; // entry id, index, or "pending" while streaming
  role: "user" | "assistant" | "tool_result";
  text: string;
  toolCalls?: Array<{ id: string; name: string; args: string }>;
  toolName?: string;
  toolCallId?: string;
  isError?: boolean;
  model?: string;
}

export type WireEvent =
  | { type: "agent_start" }
  | { type: "agent_end" }
  | { type: "message_update"; message: RenderMsg }
  | { type: "message_end"; message: RenderMsg }
  | { type: "tool_start"; toolCallId: string; toolName: string; args: unknown }
  | { type: "tool_end"; toolCallId: string; result: string; isError: boolean }
  | { type: "error"; message: string };

interface RawContent {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  arguments?: unknown;
}

export interface RawMessage {
  role: string;
  content: string | RawContent[];
  model?: string;
  provider?: string;
  toolName?: string;
  toolCallId?: string;
  isError?: boolean;
}

function textOf(content: string | RawContent[] | undefined): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((c) => c.type === "text")
    .map((c) => c.text ?? "")
    .join("");
}

export function serializeMessage(id: string, msg: RawMessage): RenderMsg | null {
  if (msg.role === "user") {
    return { id, role: "user", text: textOf(msg.content) };
  }
  if (msg.role === "assistant") {
    const blocks = Array.isArray(msg.content) ? msg.content : [];
    const toolCalls = blocks
      .filter((c) => c.type === "toolCall")
      .map((c) => ({
        id: c.id ?? "",
        name: c.name ?? "",
        args: JSON.stringify(c.arguments, null, 2),
      }));
    return {
      id,
      role: "assistant",
      text: textOf(msg.content),
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      model: msg.model,
    };
  }
  if (msg.role === "toolResult") {
    return {
      id,
      role: "tool_result",
      text: textOf(msg.content),
      toolName: msg.toolName,
      toolCallId: msg.toolCallId,
      isError: msg.isError,
    };
  }
  return null;
}

export function serializeMessages(msgs: RawMessage[], prefix = "m"): RenderMsg[] {
  const out: RenderMsg[] = [];
  msgs.forEach((m, i) => {
    const r = serializeMessage(`${prefix}${i}`, m);
    if (r) out.push(r);
  });
  return out;
}

export function toolResultText(result: unknown): string {
  if (typeof result === "string") return result;
  if (result && typeof result === "object") {
    const content = (result as { content?: unknown }).content;
    if (Array.isArray(content)) return textOf(content as RawContent[]);
  }
  return "";
}

type AnyEvent = {
  type: string;
  message?: RawMessage;
  assistantMessageEvent?: {
    type: string;
    contentIndex?: number;
    delta?: string;
    id?: string;
    toolName?: string;
    toolCall?: { id: string; name: string; arguments: unknown };
  };
  toolCallId?: string;
  toolName?: string;
  args?: unknown;
  result?: unknown;
  isError?: boolean;
};

/**
 * Translates pi session events into WireEvents.
 *
 * SDK events carry a cumulative `message` on message_update; JSON and RPC
 * events are delta-only (`assistantMessageEvent`). Both are handled here so
 * every runner produces the same stream for the browser.
 */
export class EventBridge {
  private partial: RenderMsg | null = null;
  private seq = 0;
  private readonly prefix: string;

  constructor(prefix = "e") {
    this.prefix = prefix;
  }

  private nextId(): string {
    this.seq += 1;
    return `${this.prefix}${Date.now().toString(36)}-${this.seq}`;
  }

  handle(raw: unknown): WireEvent[] {
    const event = raw as AnyEvent;
    switch (event.type) {
      case "agent_start":
        return [{ type: "agent_start" }];
      case "agent_end":
        this.partial = null;
        return [{ type: "agent_end" }];
      case "message_start": {
        if (event.message?.role !== "assistant") return [];
        this.partial = serializeMessage("pending", event.message) ?? {
          id: "pending",
          role: "assistant",
          text: "",
        };
        return [{ type: "message_update", message: this.snapshot() }];
      }
      case "message_update": {
        if (event.message) {
          const m = serializeMessage("pending", event.message);
          if (!m) return [];
          this.partial = m;
          return [{ type: "message_update", message: this.snapshot() }];
        }
        return this.applyDelta(event.assistantMessageEvent);
      }
      case "message_end": {
        this.partial = null;
        if (!event.message) return [];
        const m = serializeMessage(this.nextId(), event.message);
        return m ? [{ type: "message_end", message: m }] : [];
      }
      case "tool_execution_start":
        return [
          {
            type: "tool_start",
            toolCallId: event.toolCallId ?? "",
            toolName: event.toolName ?? "",
            args: event.args,
          },
        ];
      case "tool_execution_end":
        return [
          {
            type: "tool_end",
            toolCallId: event.toolCallId ?? "",
            result: toolResultText(event.result),
            isError: !!event.isError,
          },
        ];
      default:
        return [];
    }
  }

  private snapshot(): RenderMsg {
    const p = this.partial as RenderMsg;
    return { ...p, toolCalls: p.toolCalls ? p.toolCalls.map((t) => ({ ...t })) : undefined };
  }

  private applyDelta(ev: AnyEvent["assistantMessageEvent"]): WireEvent[] {
    if (!ev) return [];
    if (!this.partial) this.partial = { id: "pending", role: "assistant", text: "" };
    const p = this.partial;
    switch (ev.type) {
      case "text_delta":
        p.text += ev.delta ?? "";
        break;
      case "toolcall_start":
        (p.toolCalls ??= []).push({ id: ev.id ?? "", name: ev.toolName ?? "", args: "" });
        break;
      case "toolcall_delta": {
        const tc = p.toolCalls?.[p.toolCalls.length - 1];
        if (tc) tc.args += ev.delta ?? "";
        break;
      }
      case "toolcall_end": {
        if (!ev.toolCall) return [];
        const tc =
          p.toolCalls?.find((t) => t.id === ev.toolCall?.id) ?? p.toolCalls?.[p.toolCalls.length - 1];
        const done = {
          id: ev.toolCall.id,
          name: ev.toolCall.name,
          args: JSON.stringify(ev.toolCall.arguments, null, 2),
        };
        if (tc) Object.assign(tc, done);
        else (p.toolCalls ??= []).push(done);
        break;
      }
      default:
        return [];
    }
    return [{ type: "message_update", message: this.snapshot() }];
  }
}
