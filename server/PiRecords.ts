/** Pi-only translation and content-indexed reconstruction. Originals stay in Pi. */
import type { RenderMsg, SessionEvent, ToolExecution, Usage } from '../shared/wire.ts';
import { imagePreview } from './ImagePreviews.ts';
import { projectDisplay, redactDisplay } from './DisplayProjection.ts';

interface RawContent {
  type: string;
  text?: string;
  data?: string;
  mimeType?: string;
  id?: string;
  name?: string;
  arguments?: unknown;
}
interface RawUsage {
  input?: number; output?: number; cacheRead?: number; cacheWrite?: number;
  totalTokens?: number; cost?: { total?: number };
}
export interface RawMessage {
  role: string;
  content: string | RawContent[];
  model?: string;
  provider?: string;
  thinkingLevel?: string;
  responseModel?: string;
  usage?: RawUsage;
  stopReason?: string;
  errorMessage?: string;
  toolName?: string;
  toolCallId?: string;
  isError?: boolean;
  summary?: string;
  customType?: string;
  command?: string;
  output?: string;
  nestedCalls?: { complete: boolean; calls: { id: string; name: string; arguments?: unknown; status: 'ok' | 'error' | 'unfinished' }[] };
}
const argsOf = (args: unknown) => args === undefined ? '' : JSON.stringify(args, null, 2);
function textOf(content: string | RawContent[] | undefined): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter(c => c.type === 'text').map(c => c.text ?? '').join('');
}
const usageOf = (usage?: RawUsage): Usage | undefined => usage ? {
  input: usage.input ?? 0, output: usage.output ?? 0, cacheRead: usage.cacheRead ?? 0,
  cacheWrite: usage.cacheWrite ?? 0, totalTokens: usage.totalTokens ?? 0, cost: usage.cost?.total ?? 0,
} : undefined;

export function serializeMessage(id: string, msg: RawMessage): RenderMsg | null {
  let result: RenderMsg;
  if (msg.role === 'user') result = { id, role: 'user', text: textOf(msg.content),
    attachments: Array.isArray(msg.content) ? msg.content.flatMap(block => {
      if (block.type !== 'image') return [];
      const url = block.data && block.mimeType ? imagePreview(block.data, block.mimeType) : undefined;
      return [{ kind: 'image' as const, url: url ?? '' }];
    }) : undefined,
  };
  else if (msg.role === 'assistant') {
    const blocks = Array.isArray(msg.content) ? msg.content : [];
    const toolCalls = blocks.filter(c => c.type === 'toolCall').map(c => ({ id: c.id ?? '', name: c.name ?? '', args: argsOf(c.arguments) }));
    result = {
      id, role: 'assistant', text: textOf(msg.content), toolCalls: toolCalls.length ? toolCalls : undefined,
      model: msg.provider && msg.model ? `${msg.provider}/${msg.model}` : msg.model,
      thinkingLevel: msg.thinkingLevel, responseModel: msg.responseModel,
      usage: usageOf(msg.usage), stopReason: msg.stopReason, errorMessage: msg.errorMessage,
    };
  } else if (msg.role === 'toolResult') result = {
    id, role: 'tool_result', text: textOf(msg.content), toolName: msg.toolName,
    toolCallId: msg.toolCallId, isError: msg.isError, usage: usageOf(msg.usage),
    nestedCalls: msg.nestedCalls?.calls.map(c => ({ id: c.id, parentId: c.id.includes('/') ? c.id.slice(0, c.id.lastIndexOf('/')) : msg.toolCallId, name: c.name, args: argsOf(c.arguments), status: c.status === 'ok' ? 'success' : c.status === 'error' ? 'error' : 'incomplete', text: '', outputKind: 'unavailable' })),
    nestedCallsComplete: msg.nestedCalls?.complete,
  };
  else if (msg.role === 'compactionSummary' || msg.role === 'branchSummary') result = { id, role: 'context', label: msg.role === 'compactionSummary' ? 'Compaction summary' : 'Branch summary', text: msg.summary ?? '' };
  else if (msg.role === 'custom') result = { id, role: 'context', label: msg.customType ?? 'Extension context', text: textOf(msg.content) };
  else if (msg.role === 'bashExecution') result = { id, role: 'context', label: `Shell: ${msg.command ?? ''}`, text: msg.output ?? '' };
  else return null; // System declarations and thinking are outside this display scope.
  return projectDisplay(result);
}
export function serializeMessages(msgs: ReadonlyArray<RawMessage>, prefix = 'm'): RenderMsg[] {
  return msgs.flatMap((m, i) => { const result = serializeMessage(`${prefix}${i}`, m); return result ? [result] : []; });
}
export interface PiRecord { type: string; id?: string; [key: string]: unknown }
interface MessageEventRecord extends PiRecord {
  message?: RawMessage;
  usage?: RawUsage;
  assistantMessageEvent?: {
    type: string; contentIndex?: number; delta?: string; content?: string; id?: string; toolName?: string;
    toolCall?: { id: string; name: string; arguments: unknown };
  };
  toolCallId?: string; parentToolCallId?: string; toolName?: string; args?: unknown;
  partialResult?: { content?: RawContent[] }; result?: { content?: RawContent[] }; isError?: boolean;
}
type Block = { type: 'text'; text: string } | { type: 'tool'; id: string; name: string; args: string };

export class StreamAssembler {
  private partial: RenderMsg | undefined;
  private blocks = new Map<number, Block>();
  private tools = new Map<string, ToolExecution>();
  private seq = 0;

  /** Used by the same atomic snapshot boundary as retained finalized messages. */
  snapshot(): { pending?: RenderMsg; tools: ToolExecution[] } {
    return { pending: this.partial, tools: [...this.tools.values()] };
  }

  handle(raw: PiRecord): SessionEvent[] {
    const event = raw as MessageEventRecord;
    switch (event.type) {
      case 'message_start': {
        if (event.message?.role !== 'assistant') return [];
        this.blocks.clear();
        if (Array.isArray(event.message.content)) event.message.content.forEach((b, i) => {
          if (b.type === 'text') this.blocks.set(i, { type: 'text', text: b.text ?? '' });
          if (b.type === 'toolCall') this.blocks.set(i, { type: 'tool', id: b.id ?? '', name: b.name ?? '', args: argsOf(b.arguments) });
        });
        this.partial = serializeMessage('pending', event.message) ?? undefined;
        return this.update();
      }
      case 'message_update': {
        const ev = event.assistantMessageEvent;
        if (!ev) return [];
        if (!this.partial) this.partial = { id: 'pending', role: 'assistant', text: '' };
        if (event.usage) this.partial = { ...this.partial, usage: usageOf(event.usage) };
        const index = ev.contentIndex ?? 0;
        const block = this.blocks.get(index);
        switch (ev.type) {
          case 'text_start': this.blocks.set(index, { type: 'text', text: '' }); break;
          case 'text_delta': this.blocks.set(index, { type: 'text', text: (block?.type === 'text' ? block.text : '') + (ev.delta ?? '') }); break;
          case 'text_end': this.blocks.set(index, { type: 'text', text: ev.content ?? '' }); break;
          case 'toolcall_start': this.blocks.set(index, { type: 'tool', id: ev.id ?? '', name: ev.toolName ?? '', args: '' }); break;
          case 'toolcall_delta': if (block?.type === 'tool') this.blocks.set(index, { ...block, args: block.args + (ev.delta ?? '') }); break;
          case 'toolcall_end': if (ev.toolCall) this.blocks.set(index, { type: 'tool', id: ev.toolCall.id, name: ev.toolCall.name, args: argsOf(ev.toolCall.arguments) }); break;
        }
        return this.update();
      }
      case 'message_end': {
        if (event.message?.role === 'assistant') { this.partial = undefined; this.blocks.clear(); }
        if (!event.message) return [];
        const message = serializeMessage(`e${++this.seq}`, event.message);
        return message ? [{ _tag: 'message_end', message }] : [];
      }
      case 'tool_execution_start':
      case 'tool_execution_update':
      case 'tool_execution_end': {
        const id = event.toolCallId ?? '';
        const old = this.tools.get(id);
        const ended = event.type === 'tool_execution_end';
        const result = ended ? event.result : event.partialResult;
        const tool: ToolExecution = projectDisplay({
          id, parentId: event.parentToolCallId ?? old?.parentId, name: event.toolName ?? old?.name ?? '',
          args: event.args === undefined ? old?.args ?? '' : redactDisplay(argsOf(event.args), !ended),
          // RPC does not define arbitrary tool updates as append-only. Show the
          // latest update explicitly; only execution_end claims complete output.
          text: result ? redactDisplay(textOf(result.content), !ended) : old?.text ?? '',
          status: ended ? event.isError ? 'error' : 'success' : 'running',
          outputKind: ended ? 'final' : 'latest-update',
        });
        this.tools.set(id, tool);
        return [{ _tag: 'tool_update', tool }];
      }
      case 'agent_settled':
      case 'piano_closed': {
        this.partial = undefined; this.blocks.clear();
        return [...this.tools.values()].flatMap(tool => {
          if (tool.status !== 'running') return [];
          const incomplete: ToolExecution = { ...tool, status: 'incomplete' };
          this.tools.set(tool.id, incomplete);
          return [{ _tag: 'tool_update' as const, tool: incomplete }];
        });
      }
      default: return [];
    }
  }

  private update(): SessionEvent[] {
    if (!this.partial) return [];
    const blocks = [...this.blocks.entries()].sort(([a], [b]) => a - b).map(([, b]) => b);
    this.partial = projectDisplay({ ...this.partial,
      text: redactDisplay(blocks.filter(b => b.type === 'text').map(b => b.text).join(''), true),
      toolCalls: blocks.flatMap(b => b.type === 'tool' ? [{ id: b.id, name: b.name, args: redactDisplay(b.args, true) }] : []),
    });
    return [{ _tag: 'message_update', message: this.partial }];
  }
}
