/**
 * Translation of Pi's raw RPC records into the shared wire vocabulary.
 * Pure functions plus one small stateful assembler for streaming partials.
 */
import type { RenderMsg, SessionEvent } from "../shared/wire.ts";

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
  if (msg.role === "user") return { id, role: "user", text: textOf(msg.content) };
  if (msg.role === "assistant") {
    const blocks = Array.isArray(msg.content) ? msg.content : [];
    const toolCalls = blocks
      .filter((c) => c.type === "toolCall")
      .map((c) => ({ id: c.id ?? "", name: c.name ?? "", args: JSON.stringify(c.arguments, null, 2) }));
    return {
      id,
      role: "assistant",
      text: textOf(msg.content),
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      model: msg.provider && msg.model ? `${msg.provider}/${msg.model}` : msg.model,
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

export function serializeMessages(msgs: ReadonlyArray<RawMessage>, prefix = "m"): RenderMsg[] {
  const out: RenderMsg[] = [];
  msgs.forEach((m, i) => {
    const r = serializeMessage(`${prefix}${i}`, m);
    if (r) out.push(r);
  });
  return out;
}

/** Any record Pi writes to stdout. */
export interface PiRecord {
  type: string;
  id?: string;
  [key: string]: unknown;
}

interface MessageEventRecord extends PiRecord {
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
  isError?: boolean;
}

/**
 * Turns Pi session events into SessionEvents. Owns the partial assistant
 * message being streamed (Pi sends deltas only).
 */
type MutableToolCall = { id: string; name: string; args: string };
type PartialMsg = { -readonly [K in keyof RenderMsg]: RenderMsg[K] } & { toolCalls?: MutableToolCall[] };

export class StreamAssembler {
  private partial: PartialMsg | null = null;
  private seq = 0;

  private nextId(): string {
    this.seq += 1;
    return `e${Date.now().toString(36)}-${this.seq}`;
  }

  handle(raw: PiRecord): SessionEvent[] {
    const event = raw as MessageEventRecord;
    switch (event.type) {
      case "message_start": {
        if (event.message?.role !== "assistant") return [];
        const start = serializeMessage("pending", event.message) ?? { id: "pending", role: "assistant", text: "" };
        this.partial = { ...start, toolCalls: start.toolCalls ? start.toolCalls.map((t) => ({ ...t })) : undefined };
        return [{ _tag: "message_update", message: this.snapshot() }];
      }
      case "message_update":
        return this.applyDelta(event.assistantMessageEvent);
      case "message_end": {
        this.partial = null;
        if (!event.message) return [];
        const m = serializeMessage(this.nextId(), event.message);
        return m ? [{ _tag: "message_end", message: m }] : [];
      }
      case "tool_execution_start":
        return [{ _tag: "tool_start", toolCallId: event.toolCallId ?? "", toolName: event.toolName ?? "" }];
      case "tool_execution_end":
        return [{ _tag: "tool_end", toolCallId: event.toolCallId ?? "", isError: !!event.isError }];
      case "agent_end":
        this.partial = null;
        return [];
      default:
        return [];
    }
  }

  private snapshot(): RenderMsg {
    const p = this.partial as PartialMsg;
    return { ...p, toolCalls: p.toolCalls ? p.toolCalls.map((t) => ({ ...t })) : undefined };
  }

  private applyDelta(ev: MessageEventRecord["assistantMessageEvent"]): SessionEvent[] {
    if (!ev) return [];
    if (!this.partial) this.partial = { id: "pending", role: "assistant", text: "" };
    const p = this.partial;
    const calls = (): MutableToolCall[] => {
      if (!p.toolCalls) p.toolCalls = [];
      return p.toolCalls;
    };
    switch (ev.type) {
      case "text_delta":
        p.text += ev.delta ?? "";
        break;
      case "toolcall_start":
        calls().push({ id: ev.id ?? "", name: ev.toolName ?? "", args: "" });
        break;
      case "toolcall_delta": {
        const tc = calls()[calls().length - 1];
        if (tc) tc.args += ev.delta ?? "";
        break;
      }
      case "toolcall_end": {
        if (!ev.toolCall) return [];
        const done = { id: ev.toolCall.id, name: ev.toolCall.name, args: JSON.stringify(ev.toolCall.arguments, null, 2) };
        const tc = calls().find((t) => t.id === done.id) ?? calls()[calls().length - 1];
        if (tc) Object.assign(tc, done);
        else calls().push(done);
        break;
      }
      default:
        return [];
    }
    return [{ _tag: "message_update", message: this.snapshot() }];
  }
}
