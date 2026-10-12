import type { RenderMsg, SubagentCard, ToolExecution } from "@shared/wire";
// Relative so node tests can load this pure module without the web alias.
import { reportedSubagentStatus } from "../../../shared/sessionProjection.ts";
import { abbrevHome } from "./format.ts";
import { type MessageError, messageError } from "./messageError.ts";

/** The transcript's scroll container; the jump list reads and moves it. */
export const TRANSCRIPT_SELECTOR = '[data-slot="transcript"]';

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

/** A pi-subagent card with what it means once every card in the transcript has been read. */
export interface SubagentFacts {
  card: SubagentCard;
  /** The run's settled status: reported by a later card, else by this card itself. */
  terminal?: TerminalStatus;
  /** The badge text; it names `terminal` whenever there is one, so it agrees with `badge`. */
  statusLabel: string;
  badge: "destructive" | "secondary" | "success" | "warning";
  /** The tool call that carried the card failed. */
  failed: boolean;
  output?: string;
  /** Anything to show when opened: identity, prompt, guidance, outcomes or output. */
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
  /** False shows only Jump to destinations and errors, without changing authoritative history. */
  showTools?: boolean;
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
  const badge =
    terminal === "completed"
      ? "success"
      : terminal === "failed"
        ? "destructive"
        : terminal === "cancelled"
          ? "secondary"
          : card.kind === "delegation" && !card.admitted
            ? "destructive"
            : /unknown|unavailable|still running|cancell/i.test(card.status)
              ? "warning"
              : "secondary";
  const hasDetails =
    !!output ||
    card.kind === "collection" ||
    card.kind === "cancellation" ||
    ("subagentId" in card && !!card.subagentId) ||
    ("runId" in card && !!card.runId) ||
    (card.kind === "delegation" && !!card.prompt) ||
    (card.kind === "control" && !!card.message) ||
    (card.kind === "result" && card.durationMillis !== undefined);
  return {
    card,
    ...(terminal ? { terminal } : {}),
    statusLabel,
    badge,
    failed,
    ...(output ? { output } : {}),
    hasDetails,
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
  { pending = null, tools = {}, showTools = true }: TranscriptOptions = {},
): TranscriptRow[] {
  const results = new Map<string, RenderMsg>();
  const callIds = new Set<string>();
  const cardStatus = reportedSubagentStatus(messages);
  // Destinations, with their labels: every labelled prompt, and every labelled reply that
  // ended a turn (the next prompt or reply is not another reply).
  const destinations = new Map<string, string>();
  let nextTurn: RenderMsg["role"] | undefined;
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
  entries.push({ kind: "bottom", id: "bottom", label: "End of conversation" });
  return entries;
}

/** The entry the reader is looking at: bottom when pinned there, else the message under the top edge. */
export function currentEntry(container: HTMLElement, entries: ReadonlyArray<JumpEntry>): string {
  if (container.scrollHeight - container.scrollTop - container.clientHeight < 80) return "bottom";
  if (container.scrollTop <= 40) return "top";
  const cutoff = container.getBoundingClientRect().top + 80;
  let current = "top";
  for (const entry of entries) {
    if (entry.kind !== "user" && entry.kind !== "assistant") continue;
    const el = document.getElementById(messageAnchorId(entry.messageId));
    if (el && el.getBoundingClientRect().top <= cutoff) current = entry.id;
  }
  return current;
}

const motion = () =>
  (window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ? "auto"
    : "smooth") as ScrollBehavior;

/** Fired on the transcript container when a jump should leave the reader pinned to the bottom. */
export const STICK_EVENT = "piano:stick";

/** The scroll offset that puts an element just under the container's top edge. */
const offsetWithin = (container: HTMLElement, el: HTMLElement, margin: number) =>
  el.getBoundingClientRect().top -
  container.getBoundingClientRect().top +
  container.scrollTop -
  margin;

/**
 * Scroll the transcript to an entry and flash the message it landed on. Only the transcript
 * moves: `scrollIntoView` would also scroll `main` on phones and leave the composer sitting high.
 */
export function jumpTo(entry: JumpEntry): boolean {
  const container = document.querySelector<HTMLElement>(TRANSCRIPT_SELECTOR);
  if (!container) return false;
  if (entry.kind === "top" || entry.kind === "bottom") {
    if (entry.kind === "bottom") container.dispatchEvent(new CustomEvent(STICK_EVENT));
    container.scrollTo({
      top: entry.kind === "top" ? 0 : container.scrollHeight,
      behavior: motion(),
    });
    return true;
  }
  const el = document.getElementById(messageAnchorId(entry.messageId));
  if (!el) return false;
  container.scrollTo({ top: offsetWithin(container, el, 16), behavior: motion() });
  el.classList.remove("message-highlight");
  void el.offsetWidth;
  el.classList.add("message-highlight");
  window.setTimeout(() => el.classList.remove("message-highlight"), 2200);
  return true;
}
