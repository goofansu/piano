import type { FinalOutput, RenderMsg, SubagentCard, ToolExecution } from "@shared/wire";
import { abbrevHome, stripAnsi, toolArgsText } from "./format.ts";
import { type MessageError, messageError } from "./messageError.ts";

/** DOM id of a message's article, so a jump can find it without a shared ref. */
export const messageAnchorId = (id: string) => `msg-${id.replace(/[^a-zA-Z0-9_-]/g, "_")}`;

export type JumpEntry =
  | { kind: "top"; id: string; label: string }
  | { kind: "bottom"; id: string; label: string }
  | { kind: "user" | "assistant"; id: string; label: string; messageId: string };

type ToolCall = NonNullable<RenderMsg["toolCalls"]>[number];
export type TerminalStatus = "completed" | "failed" | "cancelled";

/** What became of a tool call: still running, settled with or without a result, or not heard from yet. */
export type ToolOutcome = "running" | "failed" | "incomplete" | "done" | "pending";

export type Badge = "destructive" | "secondary" | "success" | "warning";

/** One block of what came back: a Run's answer, or a sentence as pi-subagent wrote it. */
export interface SubagentOutput {
  /** The Run the block is about, when the row covers several. */
  label?: string;
  text?: string;
  /** The text is an agent's Markdown; otherwise it is shown as it came. */
  markdown: boolean;
}

/** The opened row, in the order its slots are shown: a subagent row reads as a tool row, with
 * what was sent and what came back, and its diagnostics on one quiet line at the end. */
export interface SubagentBody {
  /** Why the Run ended as it did, or what its output lacks; nothing for a plain outcome. */
  status?: string;
  /** What the agent sent: a prompt, or guidance. */
  input?: string;
  outputs: SubagentOutput[];
  /** Ids, duration, cost and model. */
  meta?: string;
}

/** A pi-subagent card with what it means once every card in the transcript has been read. */
export interface SubagentFacts {
  card: SubagentCard;
  title: string;
  ariaLabel: string;
  /** The card reports on Run results, so its title reads "Result · <title>". */
  isResult: boolean;
  profile?: string;
  runId?: string;
  /** The run's settled status: reported by a later card, else by this card itself. */
  terminal?: TerminalStatus;
  /** The badge text: the status's head, before its first " · "; it names `terminal` whenever
   * there is one, so it agrees with `badge`. The status's remaining clauses, such as why a
   * request was refused, open the body's status line. */
  statusLabel: string;
  badge: Badge;
  /** The gutter dot: a failed call or Run, a completed Run, or neither. */
  dot: "err" | "ok" | "idle";
  /** The tool call that carried the card failed. */
  failed: boolean;
  body: SubagentBody;
  /** Anything to show when opened: any slot of `body`. */
  hasDetails: boolean;
}

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
  /** Set when the call delegated to, or reported on, a subagent: it renders as that card. */
  subagent?: SubagentFacts;
  /** Set when the call started or waited on Piano sessions: it renders one row per session. */
  dispatch?: DispatchFacts[];
}

/** One session a dispatch tool started or waited on, as the parent observed it. */
export interface DispatchFacts {
  /** Null until Piano names the session, and when it was never created. */
  sessionId: string | null;
  cwd: string;
  /** The brief's first line: what the session was asked to do. */
  title: string;
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
  | { kind: "subagent"; key: string; msg: RenderMsg; subagent: SubagentFacts }
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
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
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

const START_TOOL = "piano_start_session";
const WAIT_TOOL = "piano_wait_sessions";

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

/** What became of a dispatch's first prompt, in the words the badge shows. */
const SUBMISSION: Record<string, [status: string, badge: Badge]> = {
  started: ["Started", "secondary"],
  queued: ["Queued", "secondary"],
  handled: ["Handled", "secondary"],
  rejected: ["Rejected", "destructive"],
  waiting_for_input: ["Needs input", "warning"],
  not_sent: ["Not sent", "warning"],
  uncertain: ["Uncertain", "warning"],
};
/** What a wait observed. Finished is settlement, which does not say the task succeeded. */
const OBSERVED: Record<string, [status: string, badge: Badge]> = {
  running: ["Running", "secondary"],
  settled: ["Finished", "secondary"],
  failed: ["Failed", "destructive"],
  cancelled: ["Cancelled", "secondary"],
  waiting_for_input: ["Needs input", "warning"],
  unknown: ["Unknown", "warning"],
};

/** The briefs of every session this transcript dispatched, so a wait can name what it waits on. */
function dispatchBriefs(messages: ReadonlyArray<RenderMsg>): Map<string, string> {
  const briefs = new Map<string, string>();
  const calls = new Map<string, string>();
  for (const m of messages) {
    for (const call of m.toolCalls ?? [])
      if (call.name === START_TOOL) {
        const brief = stringOf(parsed(call.args)?.prompt);
        if (brief) calls.set(call.id, brief);
      }
    const brief = m.role === "tool_result" && m.toolCallId ? calls.get(m.toolCallId) : undefined;
    const sessionId = stringOf(recordOf(parsed(m.text)?.handle)?.sessionId);
    if (brief && sessionId) briefs.set(sessionId, brief);
  }
  return briefs;
}

/** The sessions a dispatch call started or waited on; undefined for any other call, or a result
 * that is not the tool's JSON (a refused brief), which then shows as an ordinary tool call. */
function dispatchFacts(
  call: ToolCall,
  output: string | undefined,
  outcome: ToolOutcome,
  briefs: ReadonlyMap<string, string>,
): DispatchFacts[] | undefined {
  if (call.name !== START_TOOL && call.name !== WAIT_TOOL) return undefined;
  const args = parsed(call.args);
  const settled = outcome === "done" || outcome === "failed";
  const result = settled ? parsed(output) : undefined;
  if (settled && !result) return undefined;
  if (call.name === START_TOOL) {
    const brief = stringOf(args?.prompt) ?? "";
    const handle = recordOf(result?.handle);
    const creation = stringOf(result?.creation);
    const [status, badge]: [string, Badge] = !result
      ? outcome === "incomplete"
        ? ["Incomplete", "warning"]
        : ["Starting", "secondary"]
      : creation === "refused"
        ? ["Not started", "destructive"]
        : creation === "created"
          ? (SUBMISSION[stringOf(result.submission) ?? ""] ?? ["Uncertain", "warning"])
          : ["Uncertain", "warning"];
    return [
      {
        sessionId: stringOf(handle?.sessionId) ?? null,
        cwd: stringOf(handle?.cwd) ?? stringOf(result?.cwd) ?? stringOf(args?.cwd) ?? "",
        title: messageLabel(brief) || "New session",
        status,
        badge,
        ...(call.args ? { params: toolArgsText(call.args) } : {}),
        ...(stringOf(result?.detail) ? { detail: stringOf(result?.detail) } : {}),
      },
    ];
  }
  const observed = (handle: Record<string, unknown> | undefined) => {
    const sessionId = stringOf(handle?.sessionId) ?? null;
    return {
      sessionId,
      cwd: stringOf(handle?.cwd) ?? "",
      title: messageLabel((sessionId && briefs.get(sessionId)) || "") || "Session",
    };
  };
  if (!result) {
    const sessions = Array.isArray(args?.sessions) ? args.sessions : [];
    return sessions.map((handle) => ({
      ...observed(recordOf(handle)),
      status: outcome === "incomplete" ? "Incomplete" : "Waiting",
      badge: outcome === "incomplete" ? ("warning" as const) : ("secondary" as const),
    }));
  }
  const results = Array.isArray(result.results) ? result.results : [];
  return results.map((value) => {
    const r = recordOf(value);
    const [status, badge] = OBSERVED[stringOf(r?.status) ?? ""] ?? ["Unknown", "warning"];
    const answer = stringOf(r?.answer);
    const detail = stringOf(r?.detail);
    return {
      ...observed(recordOf(r?.handle)),
      status,
      badge,
      ...(answer ? { answer } : {}),
      ...(detail ? { detail } : {}),
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
      const head = first.length > 160 ? `${first.slice(0, 159)}…` : first;
      const more = lines.length - 1;
      return more > 0 ? `${head} (+${more} ${more === 1 ? "line" : "lines"})` : head;
    }
  } catch {
    /* partial JSON while streaming */
  }
  return "";
}

const titleCase = (s: string) => s[0]!.toUpperCase() + s.slice(1);

/** Reported Run outcomes apply only to delegation cards. The last qualifying observation wins;
 * a cancellation request alone never settles a Run or erases an observed outcome (INV-03). */
function reportedSubagentStatus(
  messages: ReadonlyArray<RenderMsg>,
): (card: SubagentCard | undefined) => TerminalStatus | undefined {
  const terminalRuns = new Map<string, TerminalStatus>();
  for (const { subagent: card } of messages) {
    if (card?.kind === "result" && card.runId && card.terminalStatus)
      terminalRuns.set(card.runId, card.terminalStatus);
    if (card?.kind === "collection")
      for (const run of card.runs) terminalRuns.set(run.runId, run.status);
    if (card?.kind === "cancellation")
      for (const outcome of card.outcomes)
        if (outcome.kind === "already terminal") terminalRuns.set(outcome.runId, outcome.phase);
  }
  return (card) =>
    card?.kind === "delegation" && card.runId ? terminalRuns.get(card.runId) : undefined;
}

function subagentTitle(card: SubagentCard): string {
  switch (card.kind) {
    case "delegation":
      return card.label ?? (card.action === "resume" ? "Resume subagent" : "Delegate task");
    case "control":
      return card.label ?? "Subagent guidance";
    case "collection":
      return card.label ?? "Subagent results";
    case "result":
      return card.label ?? "Subagent result";
    case "cancellation":
      return "Subagent cancellation";
  }
}

const formatDuration = (ms: number): string => {
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60
    ? `${minutes}m ${Math.round(seconds % 60)}s`
    : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
};

/** A Run's duration, cost and model, in the order every quiet line prints them. */
const spendParts = (run: {
  durationMillis?: number;
  usage?: { cost: number };
  model?: string;
}): (string | undefined)[] => [
  run.durationMillis !== undefined ? formatDuration(run.durationMillis) : undefined,
  run.usage?.cost ? `$${run.usage.cost.toFixed(4)}` : undefined,
  run.model,
];

/** One quiet line of a Run's identity and spend, from whichever facts the card carries. A wait
 * that delivered exactly one Run speaks for that Run, spend included. */
function metaOf(card: SubagentCard): string | undefined {
  const spend = card.kind === "collection" && card.runs.length === 1 ? card.runs[0] : card;
  const parts = [
    "subagentId" in card ? card.subagentId : undefined,
    "runId" in card ? card.runId : undefined,
    ...spendParts({
      ...("durationMillis" in card ? { durationMillis: card.durationMillis } : {}),
      ...(spend && "usage" in spend ? { usage: spend.usage, model: spend.model } : {}),
    }),
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : undefined;
}

/** What the Run's final output fact says the output lacks, as a status clause. */
function retentionOf(card: SubagentCard): string | undefined {
  const output = "finalOutput" in card ? card.finalOutput : undefined;
  if (output?.kind === "removed") return `Output removed · ${output.removedBytes} bytes`;
  if (output?.kind === "retained-prefix")
    return `Beginning only · ${output.removedBytes} bytes cut`;
  if (output && "preview" in output) return "Preview · the whole answer is in the Run's Result";
  return undefined;
}

/** A Run's answer from its final output fact: the agent's Markdown, or a long answer's preview. */
function answerOf(output: FinalOutput | undefined): SubagentOutput | undefined {
  if (!output) return undefined;
  if ("text" in output) return output.text ? { text: output.text, markdown: true } : undefined;
  if ("preview" in output)
    return output.preview ? { text: output.preview, markdown: false } : undefined;
  return undefined;
}

/** What came back, one block per Run. A result's answer is its final output fact when the card
 * carries one, else the text as pi-subagent wrote it (Markdown when Pi inserted it as context).
 * A refused call shows its refusal sentence; an admitted one has nothing to add to "Started". */
function outputsOf(
  card: SubagentCard,
  text: string | undefined,
  rawMarkdown: boolean,
): SubagentOutput[] {
  const raw = text ? [{ text, markdown: rawMarkdown }] : [];
  switch (card.kind) {
    case "delegation":
      return card.admitted ? [] : raw;
    case "control":
      return card.attention ? raw : [];
    case "cancellation":
      return card.outcomes.map((outcome) => ({
        label: `${outcome.runId} · ${outcome.kind}${outcome.kind === "already terminal" ? ` · ${outcome.phase}` : ""}`,
        markdown: false,
      }));
    case "result":
      return card.finalOutput ? [answerOf(card.finalOutput)].filter((o) => !!o) : raw;
    case "collection": {
      if (card.runs.length === 1 && card.finalOutput)
        return [answerOf(card.finalOutput)].filter((o) => !!o);
      if (card.runs.length === 0) return [];
      if (!card.runs.some((run) => run.finalOutput)) return raw;
      return card.runs.map((run) => ({
        label: [run.runId, run.profile, run.status, ...spendParts(run)].filter(Boolean).join(" · "),
        ...answerOf(run.finalOutput),
        markdown: !!answerOf(run.finalOutput)?.markdown,
      }));
    }
  }
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

/** A card's facts, given the settled status another card reported for its run. `text` is the
 * message's raw text; a card that carries the Run's answer as a fact shows that instead. */
function subagentFacts(
  card: SubagentCard,
  reported: TerminalStatus | undefined,
  text: string | undefined,
  failed: boolean,
  rawMarkdown: boolean,
): SubagentFacts {
  const terminal = reported ?? ("terminalStatus" in card ? card.terminalStatus : undefined);
  // pi-subagent phrases a status as a head and clauses ("Resume refused · unknown Subagent").
  // The head is the badge; the whole phrase opens the body's status line, but only while the
  // clauses qualify the head the card itself reported, never a settled status another card
  // reported later.
  const [head = "", ...clauses] = card.status.split(" · ");
  const statusLabel = terminal && head !== titleCase(terminal) ? titleCase(terminal) : head;
  const status = [
    clauses.length && statusLabel === head ? card.status : undefined,
    retentionOf(card),
  ]
    .filter(Boolean)
    .join(" · ");
  const input =
    card.kind === "delegation" ? card.prompt : card.kind === "control" ? card.message : undefined;
  const meta = metaOf(card);
  const body: SubagentBody = {
    ...(status ? { status } : {}),
    ...(input ? { input } : {}),
    outputs: outputsOf(card, text, rawMarkdown),
    ...(meta ? { meta } : {}),
  };
  const badge: Badge =
    terminal === "completed"
      ? "success"
      : terminal === "failed"
        ? "destructive"
        : terminal === "cancelled"
          ? "secondary"
          : card.kind === "delegation"
            ? card.admitted
              ? "secondary"
              : "destructive"
            : card.attention
              ? "warning"
              : "secondary";
  const title = subagentTitle(card);
  const isResult = card.kind === "result" || card.kind === "collection";
  const profile = "profile" in card ? card.profile : undefined;
  const runId = "runId" in card ? card.runId : undefined;
  return {
    card,
    title,
    ariaLabel: `${card.kind === "delegation" ? "Delegation" : isResult ? "Subagent result" : "Subagent operation"}: ${title}`,
    isResult,
    ...(profile ? { profile } : {}),
    ...(runId ? { runId } : {}),
    ...(terminal ? { terminal } : {}),
    statusLabel,
    badge,
    dot: failed || terminal === "failed" ? "err" : terminal === "completed" ? "ok" : "idle",
    failed,
    body,
    hasDetails: !!(body.status || body.input || body.outputs.length || body.meta),
  };
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
  const cardStatus = reportedSubagentStatus(messages);
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
    const card = result?.subagent ?? execution?.subagent;
    const dispatch = dispatchFacts(call, output, outcome, briefs);
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
      ...(card ? { subagent: subagentFacts(card, cardStatus(card), output, failed, false) } : {}),
      ...(dispatch ? { dispatch } : {}),
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
    if (!showTools && (m.subagent || m.role === "tool_result" || m.role === "context")) return;
    const text = showTools || jump ? m.text : "";
    if (m.subagent) {
      rows.push({
        kind: "subagent",
        key,
        msg: m,
        subagent: subagentFacts(
          m.subagent,
          cardStatus(m.subagent),
          m.text || undefined,
          false,
          m.role === "context",
        ),
      });
    } else if (m.role === "context") {
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
