import type { RenderMsg, ToolExecution } from "@shared/wire";
import { cutText } from "../../../../shared/cutText.ts";
import {
  type Disposition,
  type SessionCreation,
  type SessionHandle,
  type SessionStatus,
  type SessionSubmission,
  START_TOOL,
  STATUS_TOOL,
  type StartArguments,
  type StartToolResult,
  WAIT_TOOL,
  type WaitArguments,
  type WaitStatus,
  type WaitToolResult,
} from "../../../../shared/session/dispatch.ts";
import {
  type LibraryResult,
  storedLibraryResult,
} from "../../../../shared/session/libraryTools.ts";
import {
  abbrevHome,
  DETACHED_HEAD,
  stripAnsi,
  toolArgsText,
} from "../../../../web/src/shared/lib/format.ts";
import { ASK_USER_TOOL, type AskUserOutcome, askUserOutcome } from "../../contracts/askUser.ts";
import { type MessageError, messageError } from "./messageError.ts";

export const messageAnchorId = (id: string) => `msg-${id.replace(/[^a-zA-Z0-9_-]/g, "_")}`;

export type JumpEntry =
  | { kind: "top"; id: string; label: string }
  | { kind: "bottom"; id: string; label: string }
  | { kind: "user" | "assistant"; id: string; label: string; messageId: string };

type ToolCall = NonNullable<RenderMsg["toolCalls"]>[number];

export type ToolOutcome = "running" | "failed" | "incomplete" | "done" | "pending";

export type Badge = "destructive" | "secondary" | "success" | "warning";

export interface ToolRow {
  call: ToolCall;
  result: RenderMsg | undefined;
  outcome: ToolOutcome;
  output?: string;
  nested: NestedView;
  verb: string;
  knownTool: boolean;
  summary: string;
  dispatch?: DispatchFacts[];
  answers?: QuestionAnswers;
  library?: LibraryResult;
}

export type QuestionAnswers = AskUserOutcome;

export interface NestedCall {
  call: ToolExecution;
  outcome: ToolOutcome;
  inputNote?: string;
  summary: string;
}

export interface NestedView {
  calls: NestedCall[];
  folded: NestedCall[];
  fold?: { showAll: string; showFewer: string };
  failed: number;
  latest?: NestedCall;
  complete: boolean;
  warning?: string;
}

export interface DispatchFacts {
  sessionId: string | null;
  title: string;
  branch?: string;
  status: string;
  badge: Badge;
  params?: string;
  answer?: string;
  detail?: string;
}

export type TranscriptRow =
  | { kind: "user"; key: string; msg: RenderMsg; text: string; jump?: string }
  | {
      kind: "reply";
      key: string;
      msg: RenderMsg;
      text: string;
      tools: ToolRow[];
      error?: MessageError;
      streaming: boolean;
      jump?: string;
    }
  | { kind: "context"; key: string; msg: RenderMsg }
  | { kind: "orphan"; key: string; msg: RenderMsg; tool: ToolRow };

export interface TranscriptOptions {
  pending?: RenderMsg | null;
  tools?: Readonly<Record<string, ToolExecution>>;
  working?: boolean;
  showTools?: boolean;
}

export interface ContextFacts {
  kind: "compaction" | "branch" | "shell" | "extension";
  title: string;
  note?: string;
  markdown: boolean;
}

export function contextFacts(label: string | undefined): ContextFacts {
  if (label === "Compaction summary") return { kind: "compaction", title: label, markdown: true };
  if (label === "Branch summary") return { kind: "branch", title: label, markdown: true };
  if (label?.startsWith("Shell: "))
    return { kind: "shell", title: "Shell", note: label.slice("Shell: ".length), markdown: false };
  return { kind: "extension", title: label || "Extension context", markdown: false };
}

function messageLabel(text: string, max = 80): string {
  const line = text
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[#>*\-`\s]+/, "")
    .trim();
  return line.length > max ? `${cutText(line, max - 1)}…` : line;
}

const VERBS: Record<string, [running: string, done: string]> = {
  bash: ["Running", "Ran"],
  read: ["Reading", "Read"],
  write: ["Writing", "Wrote"],
  edit: ["Editing", "Edited"],
  grep: ["Searching", "Searched"],
  find: ["Searching", "Searched"],
  glob: ["Searching", "Searched"],
  ls: ["Listing", "Listed"],
};

const recordOf = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
const parsed = (text: string | undefined) => {
  if (!text) return undefined;
  try {
    return recordOf(JSON.parse(text));
  } catch {
    return undefined;
  }
};
const stringOf = (value: unknown) => (typeof value === "string" ? value : undefined);

function questionAnswersOf(
  call: ToolCall,
  output: string | undefined,
): QuestionAnswers | undefined {
  if (call.name !== ASK_USER_TOOL) return;
  return askUserOutcome(parsed(call.args), parsed(output));
}

const SUBMISSION: Record<SessionSubmission, [status: string, badge: Badge]> = {
  started: ["Started", "secondary"],
  queued: ["Queued", "secondary"],
  handled: ["Handled", "secondary"],
  rejected: ["Rejected", "destructive"],
  needs_input: ["Needs input", "warning"],
  not_sent: ["Not sent", "warning"],
  uncertain: ["Uncertain", "warning"],
};
const OBSERVED: Record<WaitStatus, [status: string, badge: Badge]> = {
  running: ["Running", "secondary"],
  settled: ["Finished", "secondary"],
  failed: ["Failed", "destructive"],
  cancelled: ["Cancelled", "secondary"],
  needs_input: ["Needs input", "warning"],
  unknown: ["Unknown", "warning"],
};

const DISPOSITION: Record<Disposition, [status: string, badge: Badge]> = {
  running: ["Running", "secondary"],
  needs_input: ["Needs input", "warning"],
  settled: ["Finished", "secondary"],
  exited: ["Exited", "warning"],
  unknown: ["Unknown", "warning"],
};

type Recovered<T> = {
  readonly [K in keyof T]?: NonNullable<T[K]> extends ReadonlyArray<infer E>
    ? Recovered<E>[]
    : NonNullable<T[K]> extends object
      ? Recovered<NonNullable<T[K]>>
      : T[K];
};
const oneOf = <T extends string>(names: Record<T, unknown>, value: unknown): T | undefined =>
  typeof value === "string" && Object.hasOwn(names, value) ? (value as T) : undefined;
const renamed = (value: unknown) => (value === "waiting_for_input" ? "needs_input" : value);
const creationOf = (value: unknown): SessionCreation | undefined =>
  value === "created" || value === "refused" || value === "uncertain" ? value : undefined;
const handleOf = (value: unknown): Recovered<SessionHandle> => ({
  sessionId: stringOf(recordOf(value)?.sessionId),
});
const worktreeOf = (value: unknown) => ({ branch: stringOf(recordOf(value)?.branch) });
const startArgumentsOf = (args: string | undefined): Recovered<StartArguments> | undefined => {
  const a = parsed(args);
  return a && { prompt: stringOf(a.prompt), worktree: worktreeOf(a.worktree) };
};
const waitArgumentsOf = (args: string | undefined): Recovered<WaitArguments> | undefined => {
  const a = parsed(args);
  return a && { sessions: Array.isArray(a.sessions) ? a.sessions.map(handleOf) : [] };
};
const startResultOf = (text: string | undefined): Recovered<StartToolResult> | undefined => {
  const r = parsed(text);
  return (
    r && {
      creation: creationOf(r.creation),
      submission: oneOf(SUBMISSION, renamed(r.submission)),
      handle: handleOf(r.handle),
      worktree: worktreeOf(r.worktree),
      detail: stringOf(r.detail),
    }
  );
};
const changesOf = (value: unknown) => {
  const changes = recordOf(value);
  return changes && { branch: changes.branch === null ? DETACHED_HEAD : stringOf(changes.branch) };
};
const statusResultOf = (text: string | undefined): Recovered<SessionStatus> | undefined => {
  const r = parsed(text);
  return (
    r && {
      sessionId: stringOf(r.sessionId),
      disposition: oneOf(DISPOSITION, r.disposition),
      needs: { title: stringOf(recordOf(r.needs)?.title) },
      lastAnswer: stringOf(r.lastAnswer),
      changes: changesOf(r.changes),
    }
  );
};
const waitResultOf = (text: string | undefined): Recovered<WaitToolResult> | undefined => {
  const r = parsed(text);
  return (
    r && {
      results: (Array.isArray(r.results) ? r.results : []).map(
        (value): Recovered<WaitToolResult["results"][number]> => {
          const observation = recordOf(value);
          return {
            handle: handleOf(observation?.handle),
            status: oneOf(OBSERVED, renamed(observation?.status)),
            answer: stringOf(observation?.answer),
            detail: stringOf(observation?.detail),
          };
        },
      ),
    }
  );
};

interface Dispatched {
  readonly brief: string;
  readonly branch?: string;
}

function dispatchBriefs(messages: ReadonlyArray<RenderMsg>): Map<string, Dispatched> {
  const briefs = new Map<string, Dispatched>();
  const calls = new Map<string, string>();
  for (const m of messages) {
    for (const call of m.toolCalls ?? [])
      if (call.name === START_TOOL) {
        const brief = startArgumentsOf(call.args)?.prompt;
        if (brief) calls.set(call.id, brief);
      }
    const brief = m.role === "tool_result" && m.toolCallId ? calls.get(m.toolCallId) : undefined;
    const result = brief ? startResultOf(m.text) : undefined;
    const sessionId = result?.handle?.sessionId;
    if (brief && sessionId) briefs.set(sessionId, { brief, branch: result?.worktree?.branch });
  }
  return briefs;
}

function dispatchFacts(
  call: ToolCall,
  output: string | undefined,
  outcome: ToolOutcome,
  briefs: ReadonlyMap<string, Dispatched>,
): DispatchFacts[] | undefined {
  if (call.name !== START_TOOL && call.name !== WAIT_TOOL && call.name !== STATUS_TOOL)
    return undefined;
  const settled = outcome === "done" || outcome === "failed";
  const observed = (sessionId: string | null) => {
    const dispatched = sessionId ? briefs.get(sessionId) : undefined;
    return {
      sessionId,
      title: messageLabel(dispatched?.brief ?? "") || "Session",
      ...(dispatched?.branch ? { branch: dispatched.branch } : {}),
    };
  };
  if (call.name === STATUS_TOOL) {
    const result = settled ? statusResultOf(output) : undefined;
    if (settled && !result) return undefined;
    const asked = stringOf(parsed(call.args)?.sessionId) ?? null;
    const facts = observed(result?.sessionId ?? asked);
    const branch = result?.changes?.branch ?? facts.branch;
    const [status, badge]: [string, Badge] = result
      ? result.disposition
        ? DISPOSITION[result.disposition]
        : ["Unknown", "warning"]
      : outcome === "incomplete"
        ? ["Incomplete", "warning"]
        : ["Reading", "secondary"];
    return [
      {
        ...facts,
        ...(branch ? { branch } : {}),
        status,
        badge,
        ...(result?.lastAnswer ? { answer: result.lastAnswer } : {}),
        ...(result?.needs?.title ? { detail: result.needs.title } : {}),
      },
    ];
  }
  if (call.name === START_TOOL) {
    const result = settled ? startResultOf(output) : undefined;
    if (settled && !result) return undefined;
    const args = startArgumentsOf(call.args);
    const brief = args?.prompt ?? "";
    const branch = result?.worktree?.branch ?? args?.worktree?.branch;
    const [status, badge]: [string, Badge] = !result
      ? outcome === "incomplete"
        ? ["Incomplete", "warning"]
        : ["Starting", "secondary"]
      : result.creation === "refused"
        ? ["Not started", "destructive"]
        : result.creation === "created" && result.submission
          ? SUBMISSION[result.submission]
          : ["Uncertain", "warning"];
    return [
      {
        sessionId: result?.handle?.sessionId ?? null,
        title: messageLabel(brief) || "New session",
        ...(branch ? { branch } : {}),
        status,
        badge,
        ...(call.args ? { params: toolArgsText(call.args) } : {}),
        ...(result?.detail ? { detail: result.detail } : {}),
      },
    ];
  }
  const result = settled ? waitResultOf(output) : undefined;
  if (settled && !result) return undefined;
  if (!result) {
    const sessions = waitArgumentsOf(call.args)?.sessions ?? [];
    return sessions.map((handle) => ({
      ...observed(handle.sessionId ?? null),
      status: outcome === "incomplete" ? "Incomplete" : "Waiting",
      badge: outcome === "incomplete" ? ("warning" as const) : ("secondary" as const),
    }));
  }
  return (result.results ?? []).map((r) => {
    const [status, badge] = r.status ? OBSERVED[r.status] : ["Unknown", "warning" as const];
    return {
      ...observed(r.handle?.sessionId ?? null),
      status,
      badge,
      ...(r.answer ? { answer: r.answer } : {}),
      ...(r.detail ? { detail: r.detail } : {}),
    };
  });
}

function summarize(args: string): string {
  try {
    const a = JSON.parse(args) as Record<string, unknown>;
    const v = a.command ?? a.path ?? a.file_path ?? a.pattern ?? a.url ?? a.query;
    if (typeof v === "string") {
      const lines = v.trim().split("\n");
      const first = abbrevHome(lines[0]!.trim());
      const head = first.length > 160 ? `${cutText(first, 159)}…` : first;
      const more = lines.length - 1;
      return more > 0 ? `${head} (+${more} ${more === 1 ? "line" : "lines"})` : head;
    }
  } catch {}
  return "";
}

function nestedOutcome(status: ToolExecution["status"]): ToolOutcome {
  switch (status) {
    case "running":
      return "running";
    case "success":
      return "done";
    case "error":
      return "failed";
    case "incomplete":
      return "incomplete";
  }
}

const NESTED_TAIL = 8;

function nestedView(
  calls: ReadonlyArray<ToolExecution>,
  running: boolean,
  lost: RenderMsg["nestedCallsLost"],
): NestedView {
  const all = calls.map((call) => ({
    call,
    outcome: nestedOutcome(call.status),
    summary: summarize(call.args),
    ...(!call.args && call.argsOmitted === "size"
      ? { inputNote: "Input too large to retain in history." }
      : {}),
  }));
  const tail = all.length - NESTED_TAIL;
  const folded = all.filter((c, i) => i >= tail || c.outcome === "running");
  const hidden = all.length - folded.length;
  const latest = running ? (all.findLast((c) => c.outcome === "running") ?? all.at(-1)) : undefined;
  return {
    calls: all,
    folded,
    ...(hidden > 0
      ? {
          fold: {
            showAll: `Show all ${all.length} tool calls`,
            showFewer:
              folded.length === NESTED_TAIL
                ? `Show last ${NESTED_TAIL} tool calls`
                : `Show ${folded.length} tool calls`,
          },
        }
      : {}),
    failed: all.filter((c) => c.outcome === "failed").length,
    ...(latest ? { latest } : {}),
    complete: lost === undefined,
    ...(lost === "details" ? { warning: "Some tool details are unavailable." } : {}),
  };
}

const turnLabel = (m: RenderMsg) =>
  messageLabel(m.skill ? `/skill:${m.skill.name} ${m.text}` : m.text) ||
  (m.attachments?.length ? "Image" : "");

export function transcriptRows(
  messages: ReadonlyArray<RenderMsg>,
  options: TranscriptOptions = {},
): TranscriptRow[] {
  const projection = projectHistory(messages, options);
  const pending = projection.pending(options.pending);
  return pending ? [...projection.rows, pending] : projection.rows;
}

export interface TranscriptProjection {
  history: readonly TranscriptRow[];
  pending: TranscriptRow | undefined;
}

export function createTranscriptProjector() {
  let current:
    | {
        messages: ReadonlyArray<RenderMsg>;
        tools: TranscriptOptions["tools"];
        showTools: boolean;
        working: boolean;
        projection: ReturnType<typeof projectHistory>;
      }
    | undefined;
  return (
    messages: ReadonlyArray<RenderMsg>,
    { pending, tools, showTools = true, working = false }: TranscriptOptions = {},
  ): TranscriptProjection => {
    if (
      !current ||
      current.messages !== messages ||
      current.tools !== tools ||
      current.showTools !== showTools ||
      current.working !== working
    ) {
      current = {
        messages,
        tools,
        showTools,
        working,
        projection: projectHistory(messages, { tools, showTools, working }),
      };
    }
    return { history: current.projection.rows, pending: current.projection.pending(pending) };
  };
}

function projectHistory(
  messages: ReadonlyArray<RenderMsg>,
  { tools = {}, showTools = true, working = false }: Omit<TranscriptOptions, "pending">,
) {
  const messageIds = new Set<string>();
  const results = new Map<string, RenderMsg>();
  const callIds = new Set<string>();
  const briefs = dispatchBriefs(messages);
  const destinations = new Map<string, string>();
  let nextTurn: RenderMsg["role"] | undefined = working ? "assistant" : undefined;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role !== "user" && m.role !== "assistant") continue;
    const label = m.role === "user" || nextTurn !== "assistant" ? turnLabel(m) : "";
    if (label) destinations.set(m.id, label);
    nextTurn = m.role;
  }
  for (const m of messages) {
    messageIds.add(m.id);
    if (m.role === "tool_result" && m.toolCallId) results.set(m.toolCallId, m);
    for (const call of m.toolCalls ?? []) callIds.add(call.id);
  }
  const children = new Map<string, ToolExecution[]>();
  const adopt = (parent: string, child: ToolExecution) =>
    children.set(parent, [...(children.get(parent) ?? []), child]);
  for (const execution of Object.values(tools)) {
    const parents = new Set(execution.parentId ? [execution.parentId] : []);
    for (let i = execution.id.indexOf("/"); i > 0; i = execution.id.indexOf("/", i + 1))
      parents.add(execution.id.slice(0, i));
    for (const parent of parents) adopt(parent, execution);
  }
  const toolRow = (call: ToolCall, result: RenderMsg | undefined, running: boolean): ToolRow => {
    const execution = tools[call.id];
    const failed = !!result?.isError || execution?.status === "error";
    const outcome: ToolOutcome = running
      ? "running"
      : failed
        ? "failed"
        : execution?.status === "incomplete"
          ? "incomplete"
          : result
            ? "done"
            : "pending";
    const raw = result?.text ?? execution?.text;
    const output = raw === undefined ? undefined : stripAnsi(raw);
    const nested = new Map((result?.nestedCalls ?? []).map((c) => [c.id, c]));
    for (const child of children.get(call.id) ?? []) nested.set(child.id, child);
    const verbs = VERBS[call.name];
    const [verbRunning, verbDone] = verbs ?? ["Calling", "Called"];
    const verb =
      outcome === "running"
        ? verbRunning
        : outcome === "failed"
          ? "Failed"
          : outcome === "incomplete"
            ? "Incomplete"
            : verbDone;
    const dispatch = dispatchFacts(call, output, outcome, briefs);
    const answers = outcome === "done" && result ? questionAnswersOf(call, output) : undefined;
    const library =
      outcome === "done" && result ? storedLibraryResult(call.name, output) : undefined;
    return {
      call,
      result,
      outcome,
      ...(output !== undefined ? { output } : {}),
      nested: nestedView([...nested.values()], outcome === "running", result?.nestedCallsLost),
      verb,
      knownTool: !!verbs,
      summary: summarize(call.args),
      ...(dispatch ? { dispatch } : {}),
      ...(answers ? { answers } : {}),
      ...(library ? { library } : {}),
    };
  };
  const noResults = new Map<string, RenderMsg>();
  const active = new Set(
    Object.values(tools)
      .filter((t) => t.status === "running")
      .map((t) => t.id),
  );

  const row = (
    m: RenderMsg,
    key: string,
    jump: string | undefined,
    streaming: boolean,
    preceding: () => readonly RenderMsg[],
  ): TranscriptRow | undefined => {
    if (!showTools && (m.role === "tool_result" || m.role === "context")) return;
    const text = showTools || jump ? m.text : "";
    if (m.role === "context") {
      return { kind: "context", key, msg: m };
    } else if (m.role === "user") {
      return { kind: "user", key, msg: m, text, ...(jump ? { jump } : {}) };
    } else if (m.role === "assistant") {
      const error = m.errorMessage
        ? messageError(
            m,
            showTools ? preceding() : [],
            showTools ? results : noResults,
            showTools ? tools : {},
          )
        : undefined;
      const calls = showTools ? (m.toolCalls ?? []) : [];
      if (!text && !error && !calls.length) return;
      const toolRows = calls.map((call) =>
        toolRow(
          call,
          results.get(call.id),
          active.has(call.id) || (streaming && !results.has(call.id) && !tools[call.id]),
        ),
      );
      return {
        kind: "reply",
        key,
        msg: m,
        text,
        tools: toolRows,
        ...(error ? { error } : {}),
        streaming,
        ...(jump ? { jump } : {}),
      };
    } else {
      return {
        kind: "orphan",
        key,
        msg: m,
        tool: toolRow({ id: m.toolCallId ?? m.id, name: m.toolName ?? "tool", args: "" }, m, false),
      };
    }
  };
  const rows: TranscriptRow[] = [];
  messages.forEach((m, index) => {
    if (m.role === "tool_result" && m.toolCallId && callIds.has(m.toolCallId)) return;
    const jump = destinations.get(m.id);
    if (!showTools && !jump && !m.errorMessage) return;
    const projected = row(m, m.id, jump, false, () => messages.slice(0, index));
    if (projected) rows.push(projected);
  });
  return {
    rows,
    pending: (pending: TranscriptOptions["pending"]) =>
      pending && !messageIds.has(pending.id)
        ? row(pending, pending.id, undefined, true, () => messages)
        : undefined,
  };
}

export const BOTTOM_ENTRY: JumpEntry = {
  kind: "bottom",
  id: "bottom",
  label: "End of conversation",
};

export function jumpEntries(rows: ReadonlyArray<TranscriptRow>): JumpEntry[] {
  const entries: JumpEntry[] = [{ kind: "top", id: "top", label: "Top of conversation" }];
  for (const row of rows) {
    if ((row.kind === "user" || row.kind === "reply") && row.jump) {
      entries.push({
        kind: row.kind === "user" ? "user" : "assistant",
        id: row.msg.id,
        label: row.jump,
        messageId: row.msg.id,
      });
    }
  }
  entries.push(BOTTOM_ENTRY);
  return entries;
}
