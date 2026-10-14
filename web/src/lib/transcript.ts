import type { RenderMsg, SubagentCard, ToolExecution } from "@shared/wire";
import { abbrevHome } from "./format.ts";
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

/** One part of a subagent card's on-demand details, in the order it is shown. */
export type SubagentDetail =
  /** Which Subagent and Run the card is about. */
  | { kind: "identity"; subagentId?: string; runId?: string }
  /** What was sent to the Subagent, under its label. */
  | { kind: "text"; label: "Prompt" | "Guidance"; text: string }
  /** A quiet summary line, such as a duration or a collection's counts. */
  | { kind: "note"; text: string }
  /** One Run's line in a collection or cancellation, led by its Run ID. */
  | { kind: "run"; text: string };

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
  /** The badge text; it names `terminal` whenever there is one, so it agrees with `badge`. */
  statusLabel: string;
  badge: Badge;
  /** The gutter dot: a failed call or Run, a completed Run, or neither. */
  dot: "err" | "ok" | "idle";
  /** The tool call that carried the card failed. */
  failed: boolean;
  output?: string;
  details: SubagentDetail[];
  /** Anything to show when opened: `details` or output. */
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
  /** A quiet qualifier beside the title: the shell command, or what a summary stands for. */
  note?: string;
  markdown: boolean;
}

export function contextFacts(label: string | undefined): ContextFacts {
  if (label === "Compaction summary")
    return {
      kind: "compaction",
      title: label,
      note: "The earlier conversation, as Pi carried it forward",
      markdown: true,
    };
  if (label === "Branch summary")
    return {
      kind: "branch",
      title: label,
      note: "The branch this session continued from",
      markdown: true,
    };
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

/** One line that says what a tool call did: the command, the path, or the pattern. */
function summarize(args: string): string {
  try {
    const a = JSON.parse(args) as Record<string, unknown>;
    const v = a.command ?? a.path ?? a.file_path ?? a.pattern ?? a.url ?? a.query;
    if (typeof v === "string") return abbrevHome(v.split("\n")[0]).slice(0, 160);
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

function subagentDetails(card: SubagentCard): SubagentDetail[] {
  const details: SubagentDetail[] = [];
  const subagentId = "subagentId" in card ? card.subagentId : undefined;
  const runId = "runId" in card ? card.runId : undefined;
  if (subagentId || runId)
    details.push({
      kind: "identity",
      ...(subagentId ? { subagentId } : {}),
      ...(runId ? { runId } : {}),
    });
  if (card.kind === "delegation" && card.prompt)
    details.push({ kind: "text", label: "Prompt", text: card.prompt });
  if (card.kind === "control" && card.message)
    details.push({ kind: "text", label: "Guidance", text: card.message });
  if (card.kind === "result" && card.durationMillis !== undefined)
    details.push({ kind: "note", text: `Duration ${(card.durationMillis / 1000).toFixed(1)}s` });
  if (card.kind === "collection") {
    details.push({
      kind: "note",
      text: `Delivered ${card.runs.length} · Unavailable ${card.unavailable} · Still running when checked ${card.stillRunning} · Unknown ${card.unknown}`,
    });
    for (const run of card.runs)
      details.push({ kind: "run", text: `${run.runId} · ${run.profile} · ${run.status}` });
  }
  if (card.kind === "cancellation")
    for (const outcome of card.outcomes)
      details.push({
        kind: "run",
        text: `${outcome.runId} · ${outcome.kind}${outcome.kind === "already terminal" ? ` · ${outcome.phase}` : ""}`,
      });
  return details;
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

/** A card's facts, given the settled status another card reported for its run. */
function subagentFacts(
  card: SubagentCard,
  reported: TerminalStatus | undefined,
  output: string | undefined,
  failed: boolean,
): SubagentFacts {
  const terminal = reported ?? ("terminalStatus" in card ? card.terminalStatus : undefined);
  // The card's own text may add to the status ("Failed · Result unavailable"); keep it when it agrees.
  const statusLabel =
    terminal && !card.status.startsWith(titleCase(terminal)) ? titleCase(terminal) : card.status;
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
  const details = subagentDetails(card);
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
    ...(output ? { output } : {}),
    details,
    hasDetails: !!output || details.length > 0,
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
    const output = result?.text ?? execution?.text;
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
      ...(card ? { subagent: subagentFacts(card, cardStatus(card), output, failed) } : {}),
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
        subagent: subagentFacts(m.subagent, cardStatus(m.subagent), m.text || undefined, false),
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
  if (pending) add(pending, `pending:${pending.id}`, undefined, true, () => messages);
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
