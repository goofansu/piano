import type { RenderMsg, ToolExecution } from "@shared/wire";
import { cutText } from "../../../shared/cutText.ts";
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
} from "../../../shared/dispatch.ts";
import { abbrevHome, DETACHED_HEAD, stripAnsi, toolArgsText } from "./format.ts";
import { type MessageError, messageError } from "./messageError.ts";

/** DOM id of a message's article, so a jump can find it without a shared ref. */
export const messageAnchorId = (id: string) => `msg-${id.replace(/[^a-zA-Z0-9_-]/g, "_")}`;

export type JumpEntry =
  | { kind: "top"; id: string; label: string }
  | { kind: "bottom"; id: string; label: string }
  | { kind: "user" | "assistant"; id: string; label: string; messageId: string };

type ToolCall = NonNullable<RenderMsg["toolCalls"]>[number];

/** What became of a tool call: still running, settled with or without a result, or not heard from yet. */
export type ToolOutcome = "running" | "failed" | "incomplete" | "done" | "pending";

export type Badge = "destructive" | "secondary" | "success" | "warning";

/** A tool call folded together with the result it produced and the calls it made. */
export interface ToolRow {
  call: ToolCall;
  result: RenderMsg | undefined;
  outcome: ToolOutcome;
  /** The result's text, else the latest execution preview. */
  output?: string;
  /** Calls made inside this one: recorded with its result, then any still streaming in. */
  nested: ToolExecution[];
  /** False when the result says some nested calls were not recorded. */
  nestedComplete: boolean;
  /** What the call did, in the tense its outcome calls for ("Running", "Read", "Failed"). */
  verb: string;
  /** False for a tool without its own verb, whose name then follows the generic one. */
  knownTool: boolean;
  /** The command, path or pattern the call acted on. */
  summary: string;
  /** Set when the call started or waited on Piano sessions: it renders one row per session. */
  dispatch?: DispatchFacts[];
  /** Completed ask_user results, paired with the original questions in Pi's history. */
  answers?: QuestionAnswers;
}

export interface QuestionAnswers {
  status: "answered" | "cancelled";
  items: { id: string; question: string; answer?: string }[];
}

/** One session a dispatch tool started or waited on, as the parent observed it. */
export interface DispatchFacts {
  /** Null until Piano names the session, and when it was never created. */
  sessionId: string | null;
  /** The brief's first line: what the session was asked to do. */
  title: string;
  /** The branch of the worktree the session works in, when the parent knows it; the detached
   * label once a status read finds the checkout on no branch. */
  branch?: string;
  /** The parent's observation, never the child's current state. */
  status: string;
  badge: Badge;
  /** The call's arguments as `key: value` lines, as other tool calls show them. Start rows only. */
  params?: string;
  /** The session's answer, as a wait observed it. */
  answer?: string;
  /** Why the observation is limited, in the tool's own words. */
  detail?: string;
}

/**
 * One rendered transcript row. `jump` is the row's Jump to label: a row is a destination
 * exactly when it carries one, so the jump list and the transcript cannot disagree.
 */
export type TranscriptRow =
  | { kind: "user"; key: string; msg: RenderMsg; text: string; jump?: string }
  | {
      kind: "reply";
      key: string;
      msg: RenderMsg;
      /** Visible prose; empty when messages-only hides an intermediate reply. */
      text: string;
      tools: ToolRow[];
      error?: MessageError;
      streaming: boolean;
      /** Set on a reply that ended a turn: it is offered for copying and listed in Jump to. */
      jump?: string;
    }
  | { kind: "context"; key: string; msg: RenderMsg }
  /** A result whose call never reached us. */
  | { kind: "orphan"; key: string; msg: RenderMsg; tool: ToolRow };

export interface TranscriptOptions {
  /** The message Pi is still writing; never a Jump to destination. */
  pending?: RenderMsg | null;
  tools?: Readonly<Record<string, ToolExecution>>;
  /** The current turn has not settled, including gaps between assistant messages. */
  working?: boolean;
  /** False shows only Jump to destinations and errors, without changing authoritative history. */
  showTools?: boolean;
}

/** How a context row reads: Pi's summaries are Markdown it wrote; shell output and extension
 * context are shown as they came. The label is the server's wire vocabulary for the row. */
export interface ContextFacts {
  kind: "compaction" | "branch" | "shell" | "extension";
  title: string;
  /** The shell command, beside the title. */
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

/** One line of a message, with markdown prefixes and extra whitespace folded away. */
export function messageLabel(text: string, max = 80): string {
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
    // Partial arguments while streaming, or a failure the tool reported as text.
    return undefined;
  }
};
const stringOf = (value: unknown) => (typeof value === "string" ? value : undefined);

/** Only a matching, complete result replaces raw tool output. Damaged/foreign records stay inspectable. */
function questionAnswersOf(
  call: ToolCall,
  output: string | undefined,
): QuestionAnswers | undefined {
  if (call.name !== "ask_user") return;
  const questions = parsed(call.args)?.questions;
  const result = parsed(output);
  const answers = recordOf(result?.answers);
  if (
    !Array.isArray(questions) ||
    !questions.length ||
    !answers ||
    (result?.status !== "answered" && result?.status !== "cancelled")
  )
    return;
  const items: QuestionAnswers["items"] = [];
  const ids = new Set<string>();
  for (const value of questions) {
    const item = recordOf(value);
    const id = stringOf(item?.id);
    const question = stringOf(item?.question);
    if (!id?.trim() || !question?.trim() || ids.has(id)) return;
    ids.add(id);
    if (Object.hasOwn(answers, id)) {
      const answer = stringOf(answers[id]);
      if (answer === undefined) return;
      items.push({ id, question, answer });
    } else {
      if (result.status === "answered") return;
      items.push({ id, question });
    }
  }
  if (Object.keys(answers).some((id) => !ids.has(id))) return;
  return { status: result.status, items };
}

/** What became of a dispatch's first prompt, in the words the badge shows. */
const SUBMISSION: Record<SessionSubmission, [status: string, badge: Badge]> = {
  started: ["Started", "secondary"],
  queued: ["Queued", "secondary"],
  handled: ["Handled", "secondary"],
  rejected: ["Rejected", "destructive"],
  needs_input: ["Needs input", "warning"],
  not_sent: ["Not sent", "warning"],
  uncertain: ["Uncertain", "warning"],
};
/** What a wait observed. Finished is settlement, which does not say the task succeeded. */
const OBSERVED: Record<WaitStatus, [status: string, badge: Badge]> = {
  running: ["Running", "secondary"],
  settled: ["Finished", "secondary"],
  failed: ["Failed", "destructive"],
  cancelled: ["Cancelled", "secondary"],
  needs_input: ["Needs input", "warning"],
  unknown: ["Unknown", "warning"],
};

/** What a status read reported. Finished is settlement, which does not say the task succeeded. */
const DISPOSITION: Record<Disposition, [status: string, badge: Badge]> = {
  running: ["Running", "secondary"],
  needs_input: ["Needs input", "warning"],
  settled: ["Finished", "secondary"],
  exited: ["Exited", "warning"],
  unknown: ["Unknown", "warning"],
};

/**
 * A dispatch tool's JSON as a saved session gives it back: the shared shape, but any field may be
 * missing, so an older or damaged record renders what it can. Each reader keeps a field only when
 * it has the right kind, and spells its name through the shared type, so a renamed field fails
 * the type check here instead of emptying the row.
 */
type Recovered<T> = {
  readonly [K in keyof T]?: NonNullable<T[K]> extends ReadonlyArray<infer E>
    ? Recovered<E>[]
    : NonNullable<T[K]> extends object
      ? Recovered<NonNullable<T[K]>>
      : T[K];
};
const oneOf = <T extends string>(names: Record<T, unknown>, value: unknown): T | undefined =>
  typeof value === "string" && Object.hasOwn(names, value) ? (value as T) : undefined;
/** Sessions saved before the start and wait tools said `needs_input` carry its earlier name. */
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
/** Undefined when the output is not the tool's JSON (a refused brief). */
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
/** A status's Git view: absent outside a checkout, and named as Changes names a detached one. */
const changesOf = (value: unknown) => {
  const changes = recordOf(value);
  return changes && { branch: changes.branch === null ? DETACHED_HEAD : stringOf(changes.branch) };
};
/** Undefined when the output is not the tool's JSON (an unknown session). */
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
/** Undefined when the output is not the tool's JSON. */
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

/** What this transcript dispatched to a session: its brief, and the branch of its new worktree. */
interface Dispatched {
  readonly brief: string;
  readonly branch?: string;
}

/** Every session this transcript dispatched, so a wait or a status can name what it reads. */
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

/** The sessions a dispatch call started or waited on; undefined for any other call, or a result
 * that is not the tool's JSON (a refused brief), which then shows as an ordinary tool call. */
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

/** One line that says what a tool call did: the command, the path, or the pattern. A one-line
 * command is its own description. A multi-line command (a heredoc script, a `&&` chain) shows
 * how it starts and how many lines follow; those wait in the row's details. */
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
  } catch {
    /* partial JSON while streaming */
  }
  return "";
}

/** A nested tool call's badge, by what became of the call. */
export function nestedStatus(status: ToolExecution["status"]): { label: string; badge: Badge } {
  switch (status) {
    case "running":
      return { label: "Running", badge: "warning" };
    case "success":
      return { label: "Done", badge: "success" };
    case "error":
      return { label: "Failed", badge: "destructive" };
    case "incomplete":
      return { label: "Incomplete", badge: "secondary" };
  }
}

const turnLabel = (m: RenderMsg) =>
  messageLabel(m.skill ? `/skill:${m.skill.name} ${m.text}` : m.text) ||
  (m.attachments?.length ? "Image" : "");

/**
 * The transcript as rows, in one pass over history. Tool results are folded under the call
 * that produced them; a prompt, and a reply that ended a turn, are Jump to destinations.
 * Tool-only replies and intermediate reasoning text are not destinations.
 */
export function transcriptRows(
  messages: ReadonlyArray<RenderMsg>,
  { pending = null, tools = {}, showTools = true, working = false }: TranscriptOptions = {},
): TranscriptRow[] {
  const results = new Map<string, RenderMsg>();
  const callIds = new Set<string>();
  const briefs = dispatchBriefs(messages);
  // Destinations, with their labels: every labelled prompt, and every labelled reply that
  // ended a turn (the next prompt or reply is not another reply).
  const destinations = new Map<string, string>();
  // The tail cannot be a final reply until the agent settles.
  // A completed message alone is not enough: another assistant message may follow.
  let nextTurn: RenderMsg["role"] | undefined = working ? "assistant" : undefined;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role !== "user" && m.role !== "assistant") continue;
    const label = m.role === "user" || nextTurn !== "assistant" ? turnLabel(m) : "";
    if (label) destinations.set(m.id, label);
    nextTurn = m.role;
  }
  for (const m of messages) {
    if (m.role === "tool_result" && m.toolCallId) results.set(m.toolCallId, m);
    for (const call of m.toolCalls ?? []) callIds.add(call.id);
  }
  // Live calls made inside another call, by the call that made them: named as its parent, or
  // under its id as a "parent/child" path. Built once so each row finds its own in one lookup.
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
    return {
      call,
      result,
      outcome,
      ...(output !== undefined ? { output } : {}),
      nested: [...nested.values()],
      nestedComplete: result?.nestedCallsComplete !== false,
      verb,
      knownTool: !!verbs,
      summary: summarize(call.args),
      ...(dispatch ? { dispatch } : {}),
      ...(answers ? { answers } : {}),
    };
  };
  const noResults = new Map<string, RenderMsg>();
  const active = new Set(
    Object.values(tools)
      .filter((t) => t.status === "running")
      .map((t) => t.id),
  );

  const rows: TranscriptRow[] = [];
  const add = (
    m: RenderMsg,
    key: string,
    jump: string | undefined,
    streaming: boolean,
    preceding: () => readonly RenderMsg[],
  ) => {
    if (!showTools && (m.role === "tool_result" || m.role === "context")) return;
    const text = showTools || jump ? m.text : "";
    if (m.role === "context") {
      rows.push({ kind: "context", key, msg: m });
    } else if (m.role === "user") {
      rows.push({ kind: "user", key, msg: m, text, ...(jump ? { jump } : {}) });
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
      // Pi starts a message before its first visible text or tool block arrives.
      if (!text && !error && !calls.length) return;
      const toolRows = calls.map((call) =>
        toolRow(
          call,
          results.get(call.id),
          active.has(call.id) || (streaming && !results.has(call.id) && !tools[call.id]),
        ),
      );
      rows.push({
        kind: "reply",
        key,
        msg: m,
        text,
        tools: toolRows,
        ...(error ? { error } : {}),
        streaming,
        ...(jump ? { jump } : {}),
      });
    } else {
      rows.push({
        kind: "orphan",
        key,
        msg: m,
        tool: toolRow({ id: m.toolCallId ?? m.id, name: m.toolName ?? "tool", args: "" }, m, false),
      });
    }
  };
  messages.forEach((m, index) => {
    // A result that found its call is shown under the call.
    if (m.role === "tool_result" && m.toolCallId && callIds.has(m.toolCallId)) return;
    const jump = destinations.get(m.id);
    if (!showTools && !jump && !m.errorMessage) return;
    add(m, m.id, jump, false, () => messages.slice(0, index));
  });
  // The server gives a partial reply the id of the message it becomes, so its row keeps its key
  // (and its open folds) when it ends. Once that message is in history, it is the reply.
  if (pending && !messages.some((m) => m.id === pending.id))
    add(pending, pending.id, undefined, true, () => messages);
  return rows;
}

/** The end of the conversation: a jump there leaves the reader pinned to it. */
export const BOTTOM_ENTRY: JumpEntry = {
  kind: "bottom",
  id: "bottom",
  label: "End of conversation",
};

/** What a reader can jump to: the transcript's destination rows, with "Top" and "End of conversation" around them. */
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

/**
 * Where a mention in message `messageId` is shown, as jumps to try in order: the message's own
 * row, which the transcript renders when it shows everything, then the nearest earlier Jump to
 * destination, the exchange the mention belongs to, for when that row is folded away. Only the
 * viewport knows which rows exist, so it tries them.
 */
export function revealEntries(
  messages: ReadonlyArray<RenderMsg>,
  entries: ReadonlyArray<JumpEntry>,
  messageId: string,
): JumpEntry[] {
  const index = messages.findIndex((m) => m.id === messageId);
  if (index < 0) return [];
  const message = messages[index]!;
  const exact: JumpEntry = {
    kind: message.role === "user" ? "user" : "assistant",
    id: messageId,
    label: messageLabel(message.text),
    messageId,
  };
  const before = new Set(messages.slice(0, index).map((m) => m.id));
  const fallback = entries.findLast(
    (entry) => (entry.kind === "user" || entry.kind === "assistant") && before.has(entry.messageId),
  );
  return fallback ? [exact, fallback] : [exact];
}
