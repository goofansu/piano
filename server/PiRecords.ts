/**
 * Pi-only translation: every Pi record, readback and history message becomes the browser's wire
 * vocabulary here, with content-indexed reconstruction of streaming output. Originals stay in Pi.
 * PiSessions owns the child, locking, publication and readback scheduling; it never inspects a
 * record's fields itself.
 */
import { Schema } from 'effect';
import type { Dialog, QueuedMessage, RenderMsg, SessionEvent, SessionState, SubagentCard, ToolExecution, Usage } from '../shared/wire.ts';
import { SlashCommand } from '../shared/wire.ts';
import { projectDisplay, redactDisplay } from './DisplayProjection.ts';
import { imagePreview } from './ImagePreviews.ts';

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
  details?: unknown;
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

/**
 * Pi expands `/skill:name args` into `<skill name location>\nReferences are relative to dir.\n\nbody\n</skill>\n\nargs`
 * before the prompt reaches history. The browser shows the skill as the command it was, not as the markup.
 */
const SKILL_BLOCK = /^<skill name="([^"\n]+)" location="([^"\n]+)">\n(?:References are relative to [^\n]*\n\n)?([\s\S]*?)\n<\/skill>(?:\n\n([\s\S]*))?$/;
function splitSkill(text: string): Pick<RenderMsg, 'text' | 'skill'> {
  const match = SKILL_BLOCK.exec(text);
  if (!match) return { text };
  return { text: match[4] ?? '', skill: { name: match[1], location: match[2], body: match[3] } };
}

type DetailRecord = Record<string, unknown>;
type RunMeta = { subagentId?: string; label?: string; profile?: string };
const identifier = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 128 && /^[A-Za-z0-9._:-]+$/.test(value);
const bounded = (value: unknown, max = 500): value is string => typeof value === 'string' && value.length > 0 && value.length <= max;
const recordOf = (value: unknown): DetailRecord | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as DetailRecord : undefined;
const terminal = (value: unknown): value is 'completed' | 'failed' | 'cancelled' => value === 'completed' || value === 'failed' || value === 'cancelled';
const count = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0;
const tone = (value: unknown, result = false) => value === 'toolTitle' || value === 'warning' || value === 'error' || (result && value === 'toolOutput');
const titleStatus = (value: 'completed' | 'failed' | 'cancelled') => value[0].toUpperCase() + value.slice(1);
const parseArgs = (args: string | undefined): DetailRecord => {
  try { return recordOf(args ? JSON.parse(args) : undefined) ?? {}; } catch { return {}; }
};

/** Correlates only facts already present in Pi's ordered transcript. It never
 * claims that an admitted historical Run is currently active. */
class SubagentProjection {
  private calls = new Map<string, { name: string; args: string }>();
  private runs = new Map<string, RunMeta>();
  private subagents = new Map<string, RunMeta>();

  reset(): void {
    this.calls.clear();
    this.runs.clear();
    this.subagents.clear();
  }

  assistant(msg: RenderMsg): void {
    for (const call of msg.toolCalls ?? []) this.calls.set(call.id, { name: call.name, args: call.args });
  }

  tool(toolCallId: string | undefined, toolName: string | undefined, details: unknown, args?: string): SubagentCard | undefined {
    const call = toolCallId ? this.calls.get(toolCallId) : undefined;
    const name = toolName ?? call?.name;
    const input = parseArgs(args ?? call?.args);
    const facts = recordOf(details);
    if (!facts || !name) return undefined;

    if (name === 'agent_start' && facts.kind === 'start' && bounded(facts.rowPhrase) && bounded(facts.agent) && tone(facts.tone)) {
      const admitted = identifier(facts.subagentId) && identifier(facts.runId);
      if ((facts.subagentId !== undefined || facts.runId !== undefined) && !admitted) return undefined;
      const profile = typeof input.agent === 'string' ? input.agent : facts.agent;
      const label = typeof input.description === 'string' ? input.description : undefined;
      const prompt = typeof input.prompt === 'string' ? input.prompt : undefined;
      if (admitted) {
        const meta = { subagentId: facts.subagentId as string, label, profile };
        this.runs.set(facts.runId as string, meta);
        this.subagents.set(facts.subagentId as string, meta);
      }
      return { kind: 'delegation', action: 'start', profile, label, prompt, status: facts.rowPhrase, admitted,
        ...(admitted ? { subagentId: facts.subagentId as string, runId: facts.runId as string } : {}) };
    }
    if (name === 'agent_resume' && facts.kind === 'resume' && bounded(facts.rowPhrase) && tone(facts.tone)) {
      const admitted = identifier(facts.subagentId) && identifier(facts.runId);
      if ((facts.subagentId !== undefined || facts.runId !== undefined) && !admitted) return undefined;
      const subagentId = admitted ? facts.subagentId as string : identifier(input.id) ? input.id : undefined;
      const prior = subagentId ? this.subagents.get(subagentId) : undefined;
      const label = typeof input.description === 'string' ? input.description : undefined;
      const prompt = typeof input.prompt === 'string' ? input.prompt : undefined;
      const profile = prior?.profile;
      if (admitted) {
        const meta = { subagentId, label, profile };
        this.runs.set(facts.runId as string, meta);
        if (subagentId) this.subagents.set(subagentId, meta);
      }
      return { kind: 'delegation', action: 'resume', label, profile, prompt, status: facts.rowPhrase, admitted,
        ...(subagentId ? { subagentId } : {}), ...(admitted ? { runId: facts.runId as string } : {}) };
    }
    if (name === 'agent_steer' && facts.kind === 'steer' && bounded(facts.rowPhrase) && tone(facts.tone) && identifier(facts.runId)) {
      return { kind: 'control', action: 'steer', runId: facts.runId, ...this.runs.get(facts.runId), message: typeof input.message === 'string' ? input.message : undefined, status: facts.rowPhrase };
    }
    if ((name === 'agent_wait' || name === 'agent_wait_all') && facts.kind === 'collection') {
      if ((facts.scope !== 'named' && facts.scope !== 'all-active') || !Array.isArray(facts.runs) || !count(facts.stillRunning) || !count(facts.unknown) || !count(facts.unavailable) || typeof facts.noActiveRuns !== 'boolean') return undefined;
      const runs = facts.runs.flatMap(value => {
        const run = recordOf(value);
        return run && identifier(run.runId) && bounded(run.agent) && terminal(run.status) ? [{ ...this.runs.get(run.runId), runId: run.runId, profile: run.agent, status: run.status }] : [];
      });
      if (runs.length !== facts.runs.length) return undefined;
      const clauses = [runs.length ? `Delivered ${runs.length} ${runs.length === 1 ? 'result' : 'results'}` : '', facts.unavailable ? `${facts.unavailable} unavailable` : '', facts.stillRunning ? `${facts.stillRunning} still running when checked` : '', facts.unknown ? `${facts.unknown} unknown` : ''].filter(Boolean);
      // A partial wait is a collection outcome, not the one delivered Run's outcome.
      const one = runs.length === 1 && facts.stillRunning === 0 && facts.unknown === 0 && facts.unavailable === 0 ? runs[0] : undefined;
      return { kind: 'collection', scope: facts.scope, ...(one ? { runId: one.runId, subagentId: one.subagentId, label: one.label, profile: one.profile, terminalStatus: one.status } : {}), status: one ? titleStatus(one.status) : facts.noActiveRuns ? 'No active runs when checked' : clauses.join(' · ') || 'No run outcomes', runs, stillRunning: facts.stillRunning, unknown: facts.unknown, unavailable: facts.unavailable, noActiveRuns: facts.noActiveRuns };
    }
    if (name === 'agent_result' && facts.kind === 'result' && bounded(facts.rowPhrase) && tone(facts.tone, true)) {
      if (facts.outcome === 'available') {
        const run = recordOf(facts.run);
        if (!run || !identifier(run.runId) || !bounded(run.agent) || !terminal(run.status)) return undefined;
        return { kind: 'result', source: 'tool', ...this.runs.get(run.runId), runId: run.runId, profile: run.agent, status: titleStatus(run.status), terminalStatus: run.status };
      }
      if ((facts.outcome === 'still-running' || facts.outcome === 'unknown') && identifier(facts.runId)) return {
        kind: 'result', source: 'tool', runId: facts.runId, ...this.runs.get(facts.runId), status: facts.outcome === 'still-running' ? 'Still running when checked' : facts.rowPhrase,
      };
      if (facts.outcome === 'unavailable' && identifier(facts.runId) && terminal(facts.status)) return {
        kind: 'result', source: 'tool', runId: facts.runId, ...this.runs.get(facts.runId), status: `${titleStatus(facts.status)} · Result unavailable`, terminalStatus: facts.status,
      };
      return undefined;
    }
    if (name === 'agent_cancel' && facts.kind === 'cancel' && Array.isArray(facts.outcomes)) {
      const outcomes: Extract<SubagentCard, { kind: 'cancellation' }>['outcomes'][number][] = [];
      for (const value of facts.outcomes) {
        const outcome = recordOf(value);
        if (!outcome || !identifier(outcome.runId)) continue;
        if (outcome.kind === 'already terminal' && terminal(outcome.phase)) outcomes.push({ kind: outcome.kind, runId: outcome.runId, phase: outcome.phase });
        else if (outcome.kind === 'requested' || outcome.kind === 'already requested' || outcome.kind === 'unknown') outcomes.push({ kind: outcome.kind, runId: outcome.runId });
      }
      if (outcomes.length !== facts.outcomes.length) return undefined;
      const requested = outcomes.filter(o => o.kind === 'requested').length;
      const already = outcomes.filter(o => o.kind === 'already requested').length;
      const finished = outcomes.filter(o => o.kind === 'already terminal').length;
      const unknown = outcomes.filter(o => o.kind === 'unknown').length;
      const clauses = [requested ? `Cancellation requested: ${requested}` : '', already ? `Already cancelling: ${already}` : '', finished ? `Already finished: ${finished}` : '', unknown ? `Unknown run ids: ${unknown}` : ''].filter(Boolean);
      return { kind: 'cancellation', status: clauses.join(' · ') || 'No run ids were given', outcomes };
    }
    return undefined;
  }

  notification(details: unknown): SubagentCard | undefined {
    const facts = recordOf(details);
    if (!facts || !identifier(facts.runId) || !identifier(facts.subagentId) || !bounded(facts.agent) || !bounded(facts.label) || !terminal(facts.status) || typeof facts.durationMillis !== 'number' || !Number.isFinite(facts.durationMillis) || facts.durationMillis < 0) return undefined;
    const meta = { subagentId: facts.subagentId, label: facts.label, profile: facts.agent };
    this.runs.set(facts.runId, meta);
    this.subagents.set(facts.subagentId, meta);
    return { kind: 'result', source: 'notification', runId: facts.runId, ...meta, status: titleStatus(facts.status), terminalStatus: facts.status, durationMillis: facts.durationMillis };
  }
}

export function serializeMessage(id: string, msg: RawMessage, projection = new SubagentProjection()): RenderMsg | null {
  let result: RenderMsg;
  if (msg.role === 'user') result = { id, role: 'user', ...splitSkill(textOf(msg.content)),
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
    subagent: projection.tool(msg.toolCallId, msg.toolName, msg.details),
  };
  else if (msg.role === 'compactionSummary' || msg.role === 'branchSummary') result = { id, role: 'context', label: msg.role === 'compactionSummary' ? 'Compaction summary' : 'Branch summary', text: msg.summary ?? '' };
  else if (msg.role === 'custom') result = { id, role: 'context', label: msg.customType ?? 'Extension context', text: textOf(msg.content),
    subagent: msg.customType === 'subagent-notification' ? projection.notification(msg.details) : undefined,
  };
  else if (msg.role === 'bashExecution') result = { id, role: 'context', label: `Shell: ${msg.command ?? ''}`, text: msg.output ?? '' };
  else return null; // System declarations and thinking are outside this display scope.
  const projected = projectDisplay(result);
  if (projected.role === 'assistant') projection.assistant(projected);
  return projected;
}
function serializeWithProjection(msgs: ReadonlyArray<RawMessage>, prefix: string, projection: SubagentProjection): RenderMsg[] {
  projection.reset();
  const rendered = msgs.flatMap((m, i) => { const result = serializeMessage(`${prefix}${i}`, m, projection); return result ? [result] : []; });
  const terminalRuns = new Map<string, 'completed' | 'failed' | 'cancelled'>();
  for (const message of rendered) {
    const card = message.subagent;
    if (card?.kind === 'result' && card.runId && card.terminalStatus) terminalRuns.set(card.runId, card.terminalStatus);
    if (card?.kind === 'collection') for (const run of card.runs) terminalRuns.set(run.runId, run.status);
    if (card?.kind === 'cancellation') for (const outcome of card.outcomes) if (outcome.kind === 'already terminal') terminalRuns.set(outcome.runId, outcome.phase);
  }
  return rendered.map(message => {
    const card = message.subagent;
    if (card?.kind !== 'delegation' || !card.runId) return message;
    const status = terminalRuns.get(card.runId);
    return status ? { ...message, subagent: { ...card, status: titleStatus(status), terminalStatus: status } } : message;
  });
}
export function serializeMessages(msgs: ReadonlyArray<RawMessage>, prefix = 'm'): RenderMsg[] {
  return serializeWithProjection(msgs, prefix, new SubagentProjection());
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
  partialResult?: { content?: RawContent[]; details?: unknown }; result?: { content?: RawContent[]; details?: unknown }; isError?: boolean;
}
type Block = { type: 'text'; text: string } | { type: 'tool'; id: string; name: string; args: string };

// ── Readbacks ────────────────────────────────────────────────────────────────

/** Pi's `get_state` reply. */
export interface RawState {
  model?: { provider: string; id: string };
  thinkingLevel?: string;
  isStreaming: boolean;
  isCompacting?: boolean;
  sessionFile?: string;
  sessionId: string;
  sessionName?: string;
}

/** Pi's `get_session_stats` reply. */
export interface RawStats {
  cost?: number;
  tokens?: SessionState['tokens'];
  contextUsage?: { tokens: number | null; contextWindow: number; percent: number | null };
}

/** The facts any Pi state source establishes: a live readback, or a session file read without Pi. */
export const stateFactsOf = (raw: RawState) => ({
  sessionId: raw.sessionId,
  sessionFile: raw.sessionFile,
  sessionName: raw.sessionName,
  model: raw.model ? `${raw.model.provider}/${raw.model.id}` : undefined,
  thinkingLevel: raw.thinkingLevel,
  isStreaming: raw.isStreaming,
});

export const statsOf = (raw: RawStats) => ({ context: raw.contextUsage, cost: raw.cost, tokens: raw.tokens });

/** Pi's steering and follow-up queue, from `queue_update` or `clear_queue`. Undefined when malformed. */
export const queuedMessagesOf = (value: unknown): ReadonlyArray<QueuedMessage> | undefined => {
  if (!value || typeof value !== 'object') return;
  const { steering, followUp } = value as { steering?: unknown; followUp?: unknown };
  if (!Array.isArray(steering) || !Array.isArray(followUp) ||
      ![...steering, ...followUp].every((text) => typeof text === 'string')) return;
  return [
    ...steering.map((text: string) => ({ kind: 'steering' as const, text })),
    ...followUp.map((text: string) => ({ kind: 'follow-up' as const, text })),
  ];
};

/** Keep Pi's execution precedence, exposing only browser-useful catalog fields. Undefined when malformed. */
export const commandsOf = (data: unknown): ReadonlyArray<SlashCommand> | undefined => {
  const commands = (data as { commands?: unknown } | undefined)?.commands;
  if (!Schema.is(Schema.Array(SlashCommand))(commands)) return;
  const unique = new Map<string, SlashCommand>();
  // Extensions execute before skills and templates; skills expand before templates.
  for (const source of ['extension', 'skill', 'prompt'] as const) for (const command of commands) {
    if (command.source === source && !unique.has(command.name)) unique.set(command.name, {
      name: command.name, description: command.description, source,
    });
  }
  return [...unique.values()];
};

// ── Live records ─────────────────────────────────────────────────────────────

/** A Pi readback a record makes due. */
export type RefreshKind = 'stats' | 'context' | 'state';

/** What one Pi record means for the session, to publish atomically in this order. */
export interface RecordProjection {
  /** State fields the record establishes, merged into current state before `events`. */
  readonly state?: Partial<SessionState>;
  readonly events: ReadonlyArray<SessionEvent>;
  /** Readbacks to schedule after publishing; never awaited by the record consumer. */
  readonly refresh: ReadonlyArray<RefreshKind>;
  /** A newly opened dialog, also among `events`. The caller owns its deadline and resolution. */
  readonly dialog?: Dialog;
}

const DIALOG_METHODS = new Set(['select', 'confirm', 'input', 'editor']);
const EXTENSION_STATE_METHODS = new Set(['setStatus', 'setWidget', 'setTitle', 'set_editor_text']);
const project = (events: ReadonlyArray<SessionEvent> = [], state?: Partial<SessionState>, refresh: ReadonlyArray<RefreshKind> = []): RecordProjection =>
  ({ events, refresh, ...(state ? { state } : {}) });
const notice = (level: 'info' | 'warning' | 'error', message: string): SessionEvent => ({ _tag: 'notice', level, message });

/**
 * One Pi child's records in the browser's vocabulary. Owns everything a record sequence
 * implies: the streaming partial, tool executions, subagent correlation, retry flags,
 * extension status/widgets and dialog construction. Pure and synchronous; callers serialize
 * `record`, `history` and `closed` under their snapshot lock.
 */
export class PiProjector {
  private partial: RenderMsg | undefined;
  private blocks = new Map<number, Block>();
  private tools = new Map<string, ToolExecution>();
  private projection = new SubagentProjection();
  private seq = 0;
  private turnRetry = false;
  private summaryRetry = false;
  private extension: NonNullable<SessionState['extension']> = { statuses: [], widgets: [] };
  private seenDialogs = new Set<string>();

  /** `generation` names this child in dialog and editor request IDs; `recoveryMs` bounds a
   * dialog without a usable Pi timeout. */
  private readonly options: { readonly generation: string; readonly recoveryMs: number };
  constructor(options: { readonly generation: string; readonly recoveryMs: number }) { this.options = options; }

  /** Initial live state from Pi's `get_state`, before any record arrives. */
  state(raw: RawState): SessionState {
    return { ...stateFactsOf(raw), isCompacting: raw.isCompacting ?? false, isRetrying: false, queuedMessages: [] };
  }

  /** Seed or replace authoritative history (`get_messages`) and retain its correlation facts
   * for subsequent live records. The messages themselves remain owned by Pi. */
  history(msgs: ReadonlyArray<RawMessage>, prefix = 'm'): RenderMsg[] {
    return serializeWithProjection(msgs, prefix, this.projection);
  }

  record(raw: PiRecord, receivedAt: number): RecordProjection {
    switch (raw.type) {
      case 'agent_start':
        return project([], { isStreaming: true });
      case 'queue_update': {
        const messages = queuedMessagesOf(raw);
        return project([messages ? { _tag: 'queue_update', messages } : notice('warning', 'Pi sent an invalid queue update.')]);
      }
      case 'agent_settled':
        this.turnRetry = false;
        this.summaryRetry = false;
        return project(this.settle(), { isStreaming: false, isCompacting: false, isRetrying: false }, ['context', 'state', 'stats']);
      case 'message_start':
        return project(this.stream(raw), { contextIsLastKnown: true });
      case 'message_end':
        return project(this.stream(raw), { contextIsLastKnown: true }, ['stats']);
      case 'compaction_start':
        return project([notice('info', `Compacting context (${raw.reason})`)], { isCompacting: true });
      case 'compaction_end':
        // Pi reports null tokens/percent until fresh post-compaction usage exists.
        return project([], { isCompacting: false }, ['context', 'stats']);
      case 'session_info_changed':
        return project([], { sessionName: raw.name as string | undefined });
      case 'thinking_level_changed':
        return project([], { thinkingLevel: raw.level as string | undefined });
      case 'auto_retry_start':
        this.turnRetry = true;
        return project([notice('warning', `Retrying (${raw.attempt}/${raw.maxAttempts}): ${raw.errorMessage}`)], { isStreaming: true, isRetrying: true });
      case 'auto_retry_end':
        this.turnRetry = false;
        return project([], { isRetrying: this.summaryRetry });
      case 'summarization_retry_scheduled':
        this.summaryRetry = true;
        return project([notice('warning', `Retrying summary (${raw.attempt}/${raw.maxAttempts}): ${raw.errorMessage}`)], { isRetrying: true });
      case 'summarization_retry_finished':
        this.summaryRetry = false;
        return project([], { isRetrying: this.turnRetry });
      case 'extension_error':
        return project([notice('error', `Extension error: ${raw.error}`)]);
      case 'extension_ui_request':
        return this.extensionUi(raw, receivedAt);
      default:
        return project(this.stream(raw));
    }
  }

  /** The child is gone: no tool still running in it can finish. */
  closed(): SessionEvent[] {
    return this.settle();
  }

  private extensionUi(raw: PiRecord, receivedAt: number): RecordProjection {
    const method = String(raw.method);
    if (method === 'notify') {
      return project([notice(raw.notifyType === 'error' ? 'error' : raw.notifyType === 'warning' ? 'warning' : 'info', String(raw.message ?? ''))]);
    }
    if (EXTENSION_STATE_METHODS.has(method)) {
      const current = this.extension;
      const extension = { ...current };
      if (method === 'setStatus') extension.statuses = [
        ...current.statuses.filter(s => s.key !== raw.statusKey),
        ...(typeof raw.statusText === 'string' ? [{ key: String(raw.statusKey), text: raw.statusText }] : []),
      ];
      if (method === 'setWidget') extension.widgets = [
        ...current.widgets.filter(w => w.key !== raw.widgetKey),
        ...(Array.isArray(raw.widgetLines) ? [{ key: String(raw.widgetKey), lines: raw.widgetLines.map(String), placement: raw.widgetPlacement === 'belowEditor' ? 'belowEditor' as const : 'aboveEditor' as const }] : []),
      ];
      if (method === 'setTitle') extension.title = String(raw.title ?? '');
      if (method === 'set_editor_text') extension.editorRequest = { id: `${this.options.generation}:${raw.id}`, text: String(raw.text ?? '') };
      this.extension = extension;
      return project([], { extension });
    }
    const id = String(raw.id);
    if (!DIALOG_METHODS.has(method) || this.seenDialogs.has(id)) return project();
    this.seenDialogs.add(id);
    const { generation, recoveryMs } = this.options;
    const timeoutMs = typeof raw.timeout === 'number' && Number.isFinite(raw.timeout) && raw.timeout > 0 ? raw.timeout : undefined;
    const piTimeout = timeoutMs !== undefined && timeoutMs <= recoveryMs;
    const dialog: Dialog = {
      id, generation, receivedAt, timeoutMs,
      deadlineAt: receivedAt + (piTimeout ? timeoutMs : recoveryMs),
      deadlineKind: piTimeout ? 'pi-timeout' : 'host-recovery',
      method: method as Dialog['method'],
      title: raw.title as string | undefined,
      message: raw.message as string | undefined,
      options: raw.options as string[] | undefined,
      placeholder: raw.placeholder as string | undefined,
      prefill: raw.prefill as string | undefined,
    };
    return { events: [{ _tag: 'dialog', dialog }], refresh: [], dialog };
  }

  /** Streaming output: the partial reply, final messages and tool executions. */
  private stream(raw: PiRecord): SessionEvent[] {
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
        const message = serializeMessage(`e${++this.seq}`, event.message, this.projection);
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
          subagent: ended ? this.projection.tool(id, event.toolName ?? old?.name, result?.details, event.args === undefined ? old?.args : argsOf(event.args)) : old?.subagent,
        });
        this.tools.set(id, tool);
        return [{ _tag: 'tool_update', tool }];
      }
      default: return [];
    }
  }

  /** Pi will not continue this run: drop the partial and mark unfinished tools incomplete. */
  private settle(): SessionEvent[] {
    this.partial = undefined; this.blocks.clear();
    return [...this.tools.values()].flatMap(tool => {
      if (tool.status !== 'running') return [];
      const incomplete: ToolExecution = { ...tool, status: 'incomplete' };
      this.tools.set(tool.id, incomplete);
      return [{ _tag: 'tool_update' as const, tool: incomplete }];
    });
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
