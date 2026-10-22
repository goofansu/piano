/**
 * Pi-only translation: every Pi record, readback and history message becomes the browser's wire
 * vocabulary here, with content-indexed reconstruction of streaming output, and every Snapshot,
 * live or saved, comes from one projection of Pi's facts (`PiSessionFacts`). Originals stay in Pi.
 * Outbound, browser actions become Pi's CLI arguments and RPC commands here, and each exchange
 * (a readback or an action's command) decodes its own reply, so a reply of the wrong shape is a
 * protocol failure.
 * PiSessions owns the child, locking, publication and readback scheduling; it never inspects or
 * builds a record's fields itself.
 */
import { createHmac, randomBytes } from "node:crypto";
import { Option, Schema } from "effect";
import { imageType } from "../shared/attachments.ts";
import { DISPATCH_ENTRY, DISPATCHED_FROM_FLAG } from "../shared/dispatch.ts";
import { turnEnding } from "../shared/turnEnding.ts";
import type {
  Dialog,
  ModelChoice,
  QueuedMessage,
  RenderMsg,
  SessionAction,
  SessionEvent,
  SessionState,
  Snapshot,
  ThinkingLevel,
  ToolExecution,
  Usage,
} from "../shared/wire.ts";
import { Attachments, ContextUsage, SessionStats, SlashCommand } from "../shared/wire.ts";
import { compileRedaction, type DisplayRedaction } from "./DisplayProjection.ts";
import { imagePreview } from "./ImagePreviews.ts";

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
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  totalTokens?: number;
  cost?: { total?: number };
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
  nestedCalls?: {
    complete: boolean;
    calls: { id: string; name: string; arguments?: unknown; status: string }[];
  };
  details?: unknown;
}
const argsOf = (args: unknown) => (args === undefined ? "" : JSON.stringify(args, null, 2));
function textOf(content: string | RawContent[] | undefined): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((c) => c.type === "text")
    .map((c) => c.text ?? "")
    .join("");
}
const usageOf = (usage?: RawUsage): Usage | undefined =>
  usage
    ? {
        input: usage.input ?? 0,
        output: usage.output ?? 0,
        cacheRead: usage.cacheRead ?? 0,
        cacheWrite: usage.cacheWrite ?? 0,
        totalTokens: usage.totalTokens ?? 0,
        cost: usage.cost?.total ?? 0,
      }
    : undefined;

/**
 * Pi expands `/skill:name args` into `<skill name location>\nReferences are relative to dir.\n\nbody\n</skill>\n\nargs`
 * before the prompt reaches history. The browser shows the skill as the command it was, not as the markup.
 */
const SKILL_BLOCK =
  /^<skill name="([^"\n]+)" location="([^"\n]+)">\n(?:References are relative to [^\n]*\n\n)?([\s\S]*?)\n<\/skill>(?:\n\n([\s\S]*))?$/;
function splitSkill(text: string): Pick<RenderMsg, "text" | "skill"> {
  const match = SKILL_BLOCK.exec(text);
  if (!match) return { text };
  return { text: match[4] ?? "", skill: { name: match[1], location: match[2], body: match[3] } };
}
const recordOf = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

// Pi's skill parser splits on a literal space, not other whitespace. Accept a command
// on its own line without changing the skill body or interpreting unknown skills here.
function skillCommandForPi(text: string): string {
  return text.replace(/^(\/skill:[^\s]+)\s+/, "$1 ");
}
/** Equality evidence, not display text or a durable receipt. The key never leaves this process.
 * Pi owns skill expansion; normalize only its command name/arguments, before redaction. Plain
 * input stays byte-for-byte: a transformed prompt must not become equal through trimming. */
const inputKey = randomBytes(32);
export function inputFingerprint(text: string): string {
  const { text: args, skill } = splitSkill(text);
  const command = skill ? `/skill:${skill.name}${args ? ` ${args}` : ""}` : skillCommandForPi(text);
  const space = command.indexOf(" ");
  const normalized =
    command.startsWith("/skill:") && space !== -1
      ? ["skill", command.slice(7, space), command.slice(space + 1).trim()]
      : command.startsWith("/skill:")
        ? ["skill", command.slice(7), ""]
        : ["text", command];
  return createHmac("sha256", inputKey).update(JSON.stringify(normalized)).digest("hex");
}

/** Only supported writing tools supply file identity; arbitrary arguments remain display text. */
function writtenPath(name: string | undefined, args: unknown): string | undefined {
  if (name !== "write" && name !== "edit") return undefined;
  const fields = recordOf(args);
  const path = fields?.path ?? fields?.file_path;
  return typeof path === "string" && path.trim() ? path : undefined;
}

export function serializeMessage(
  id: string,
  msg: RawMessage,
  redaction: DisplayRedaction = compileRedaction(),
): RenderMsg | null {
  let result: RenderMsg;
  if (msg.role === "user")
    result = {
      id,
      role: "user",
      ...splitSkill(textOf(msg.content)),
      inputFingerprint:
        Array.isArray(msg.content) && msg.content.some((c) => c.type !== "text")
          ? undefined
          : inputFingerprint(textOf(msg.content)),
      attachments: Array.isArray(msg.content)
        ? msg.content.flatMap((block) => {
            if (block.type !== "image") return [];
            const url =
              block.data && block.mimeType ? imagePreview(block.data, block.mimeType) : undefined;
            return [{ kind: "image" as const, url: url ?? "" }];
          })
        : undefined,
    };
  else if (msg.role === "assistant") {
    const blocks = Array.isArray(msg.content) ? msg.content : [];
    const toolCalls = blocks
      .filter((c) => c.type === "toolCall")
      .map((c) => ({
        id: c.id ?? "",
        name: c.name ?? "",
        args: argsOf(c.arguments),
        writtenPath: writtenPath(c.name, c.arguments),
      }));
    result = {
      id,
      role: "assistant",
      text: textOf(msg.content),
      toolCalls: toolCalls.length ? toolCalls : undefined,
      model: msg.provider && msg.model ? `${msg.provider}/${msg.model}` : msg.model,
      thinkingLevel: msg.thinkingLevel,
      responseModel: msg.responseModel,
      usage: usageOf(msg.usage),
      stopReason: msg.stopReason,
      errorMessage: msg.errorMessage,
    };
  } else if (msg.role === "toolResult")
    result = {
      id,
      role: "tool_result",
      text: textOf(msg.content),
      toolName: msg.toolName,
      toolCallId: msg.toolCallId,
      isError: msg.isError,
      usage: usageOf(msg.usage),
      nestedCalls: msg.nestedCalls?.calls.map((c) => ({
        id: c.id,
        parentId: c.id.includes("/") ? c.id.slice(0, c.id.lastIndexOf("/")) : msg.toolCallId,
        name: c.name,
        args: argsOf(c.arguments),
        writtenPath: writtenPath(c.name, c.arguments),
        status: c.status === "ok" ? "success" : c.status === "error" ? "error" : "incomplete",
        text: "",
        outputKind: "unavailable",
      })),
      nestedCallsComplete: msg.nestedCalls?.complete,
    };
  else if (msg.role === "compactionSummary" || msg.role === "branchSummary")
    result = {
      id,
      role: "context",
      label: msg.role === "compactionSummary" ? "Compaction summary" : "Branch summary",
      text: msg.summary ?? "",
    };
  else if (msg.role === "custom")
    result = {
      id,
      role: "context",
      label: msg.customType ?? "Extension context",
      text: textOf(msg.content),
    };
  else if (msg.role === "bashExecution")
    result = { id, role: "context", label: `Shell: ${msg.command ?? ""}`, text: msg.output ?? "" };
  else return null; // System declarations and thinking are outside this display scope.
  return redaction.wire(result);
}
/** A message's id is its position in Pi's message list, so a live message and the readback that
 * later contains it name it alike, and the browser keeps its row. */
const messageId = (index: number) => `m${index}`;
function serializeMessages(msgs: ReadonlyArray<RawMessage>): RenderMsg[] {
  const redaction = compileRedaction();
  return msgs.flatMap((m, i) => {
    const result = serializeMessage(messageId(i), m, redaction);
    return result ? [result] : [];
  });
}
export interface PiRecord {
  type: string;
  id?: string;
  [key: string]: unknown;
}
interface MessageEventRecord extends PiRecord {
  message?: RawMessage;
  usage?: RawUsage;
  assistantMessageEvent?: {
    type: string;
    contentIndex?: number;
    delta?: string;
    content?: string;
    id?: string;
    toolName?: string;
    toolCall?: { id: string; name: string; arguments: unknown };
  };
  toolCallId?: string;
  parentToolCallId?: string;
  toolName?: string;
  args?: unknown;
  partialResult?: { content?: RawContent[]; details?: unknown };
  result?: { content?: RawContent[]; details?: unknown };
  isError?: boolean;
}
type Block =
  | { type: "text"; text: string }
  | { type: "tool"; id: string; name: string; args: string; writtenPath?: string };

// ── Readbacks ────────────────────────────────────────────────────────────────

/**
 * A Pi command and the decoding of its reply. `decode` returns undefined when the reply breaks the
 * protocol, which the caller reports as `invalid` rather than trusting the shape.
 */
export interface PiExchange<A> {
  readonly command: PiCommand;
  readonly decode: (data: unknown) => A | undefined;
  readonly invalid: string;
}

/** An exchange that only queries Pi, so it changes nothing. */
export type PiReadback<A> = PiExchange<A>;

/** The `get_state` facts Piano reads; Pi's other state fields stay in Pi. */
const RawState = Schema.Struct({
  model: Schema.optional(Schema.Struct({ provider: Schema.String, id: Schema.String })),
  thinkingLevel: Schema.optional(Schema.String),
  isStreaming: Schema.Boolean,
  isCompacting: Schema.optional(Schema.Boolean),
  sessionFile: Schema.optional(Schema.String),
  sessionId: Schema.String,
  sessionName: Schema.optional(Schema.String),
});
export type RawState = typeof RawState.Type;

/** The `get_session_stats` figures Piano shows; Pi's message counts stay in Pi. */
const RawStats = Schema.Struct({
  cost: Schema.optional(Schema.Number),
  tokens: SessionStats.fields.tokens,
  contextUsage: Schema.optional(ContextUsage),
});

/** What serializeMessage dereferences on a message it displays; other fields it reads defensively. */
const DisplayedMessage = Schema.Struct({
  content: Schema.optional(
    Schema.Union([Schema.String, Schema.Array(Schema.Struct({ type: Schema.String }))]),
  ),
  nestedCalls: Schema.optional(
    Schema.Struct({
      complete: Schema.Boolean,
      calls: Schema.Array(
        Schema.Struct({ id: Schema.String, name: Schema.String, status: Schema.String }),
      ),
    }),
  ),
});
const DISPLAYED_ROLES = new Set(["user", "assistant", "toolResult", "custom"]);
/** Extensions may add message roles of their own shape; only a role is asked of those. */
const isRawMessage = (value: unknown): value is RawMessage => {
  const message = recordOf(value);
  return (
    !!message &&
    typeof message.role === "string" &&
    (!DISPLAYED_ROLES.has(message.role) || Schema.is(DisplayedMessage)(message))
  );
};
const fieldOf = (data: unknown, field: string) => recordOf(data)?.[field];

/** The facts any Pi state source establishes: a live readback, or a session file read without Pi. */
export const stateFactsOf = (raw: RawState) => ({
  sessionId: raw.sessionId,
  sessionFile: raw.sessionFile,
  sessionName: raw.sessionName,
  model: raw.model ? `${raw.model.provider}/${raw.model.id}` : undefined,
  thinkingLevel: raw.thinkingLevel,
  isStreaming: raw.isStreaming,
});

/** The session that dispatched this one: the first `piano.dispatch` entry Piano's extension
 * recorded, on any branch, since it describes the whole session. */
export const dispatchedFromOf = (entries: ReadonlyArray<unknown>): string | undefined => {
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const { type, customType, data } = entry as Record<string, unknown>;
    if (type !== "custom" || customType !== DISPATCH_ENTRY) continue;
    const parent =
      data && typeof data === "object"
        ? (data as Record<string, unknown>).parentSessionId
        : undefined;
    if (typeof parent === "string" && parent) return parent;
  }
  return undefined;
};

/**
 * What Pi establishes about one session, and from where: a running child's `get_state`,
 * `get_messages` and `get_entries`, or its saved file read without Pi. Either becomes a Snapshot
 * only through {@link snapshotOf} or {@link PiProjector.snapshot}.
 */
export interface PiSessionFacts {
  readonly source: "live" | "saved";
  readonly state: RawState;
  readonly messages: ReadonlyArray<RawMessage>;
  /** Every entry, on any branch: the dispatching session is recorded once in them. */
  readonly entries: ReadonlyArray<unknown>;
}

/** The one projection of a Pi session into a Snapshot, with the session that dispatched it. A live session adds its run's own state (compacting only if Pi says so, nothing
 * queued). */
export const snapshotOf = (facts: PiSessionFacts): Snapshot => {
  const state = {
    ...stateFactsOf(facts.state),
    dispatchedFrom: dispatchedFromOf(facts.entries),
  };
  return {
    state:
      facts.source === "live"
        ? {
            ...state,
            isCompacting: facts.state.isCompacting ?? false,
            isRetrying: false,
            queuedMessages: [],
          }
        : state,
    messages: serializeMessages(facts.messages),
    dialogs: [],
  };
};

/** Pi's steering and follow-up queue, from `queue_update` or `clear_queue`. Undefined when malformed. */
const queuedMessagesOf = (value: unknown): ReadonlyArray<QueuedMessage> | undefined => {
  if (!value || typeof value !== "object") return;
  const { steering, followUp } = value as { steering?: unknown; followUp?: unknown };
  if (
    !Array.isArray(steering) ||
    !Array.isArray(followUp) ||
    ![...steering, ...followUp].every((text) => typeof text === "string")
  )
    return;
  return [
    ...steering.map((text: string) => ({ kind: "steering" as const, text })),
    ...followUp.map((text: string) => ({ kind: "follow-up" as const, text })),
  ];
};

/** Keep Pi's execution precedence, exposing only browser-useful catalog fields. Undefined when malformed. */
const commandsOf = (data: unknown): ReadonlyArray<SlashCommand> | undefined => {
  const commands = (data as { commands?: unknown } | undefined)?.commands;
  if (!Schema.is(Schema.Array(SlashCommand))(commands)) return;
  const unique = new Map<string, SlashCommand>();
  // Extensions execute before skills and templates; skills expand before templates.
  for (const source of ["extension", "skill", "prompt"] as const)
    for (const command of commands) {
      if (command.source === source && !unique.has(command.name))
        unique.set(command.name, {
          name: command.name,
          description: command.description,
          source,
        });
    }
  return [...unique.values()];
};

/** One entry of Pi's `get_available_models` reply; other fields stay in Pi. */
const RawModel = Schema.Struct({
  provider: Schema.String,
  id: Schema.String,
  name: Schema.optional(Schema.String),
  reasoning: Schema.optional(Schema.Boolean),
  contextWindow: Schema.Number,
  /** Pi's per-model effort table: null disables a level, a value enables xhigh or max. */
  thinkingLevelMap: Schema.optional(Schema.Record(Schema.String, Schema.NullOr(Schema.String))),
});
type RawModel = typeof RawModel.Type;

const LEVELS: ReadonlyArray<ThinkingLevel> = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

/** The rule Pi applies (pi-ai getSupportedThinkingLevels): a non-reasoning model only has off; a level mapped to null is out; xhigh and max need an explicit mapping. */
const thinkingLevelsOf = (m: RawModel): ThinkingLevel[] =>
  !m.reasoning
    ? ["off"]
    : LEVELS.filter((level) => {
        const mapped = m.thinkingLevelMap?.[level];
        if (mapped === null) return false;
        if (level === "xhigh" || level === "max") return mapped !== undefined;
        return true;
      });

/**
 * Pi's `get_available_models` reply as the browser's model choices, in Pi's order, with the efforts
 * each model accepts. Undefined when malformed.
 */
export const modelChoicesOf = (data: unknown): ReadonlyArray<ModelChoice> | undefined => {
  const models = Schema.decodeUnknownOption(Schema.Struct({ models: Schema.Array(RawModel) }))(
    data,
  );
  if (models._tag === "None") return;
  return models.value.models.map((m): ModelChoice => {
    const ref = `${m.provider}/${m.id}`;
    return {
      ref,
      provider: m.provider,
      id: m.id,
      name: m.name,
      reasoning: !!m.reasoning,
      contextWindow: m.contextWindow,
      thinkingLevels: thinkingLevelsOf(m),
    };
  });
};

/** Every Pi readback Piano sends: the query, and how its reply decodes. */
export const piReadbacks = {
  /** Live state; also a session's ready check. */
  state: {
    command: { type: "get_state" },
    decode: (data) => Option.getOrUndefined(Schema.decodeUnknownOption(RawState)(data)),
    invalid: "Pi returned an invalid session state.",
  } satisfies PiReadback<RawState>,
  /** Authoritative current context, replacing any projected history. */
  messages: {
    command: { type: "get_messages" },
    decode: (data) => {
      const messages = fieldOf(data, "messages");
      return Array.isArray(messages) && messages.every(isRawMessage) ? messages : undefined;
    },
    invalid: "Pi returned an invalid message history.",
  } satisfies PiReadback<ReadonlyArray<RawMessage>>,
  /** Context use, billed cost and token totals. */
  stats: {
    command: { type: "get_session_stats" },
    decode: (data) =>
      Option.getOrUndefined(
        Option.map(Schema.decodeUnknownOption(RawStats)(data), (raw) => ({
          context: raw.contextUsage,
          cost: raw.cost,
          tokens: raw.tokens,
        })),
      ),
    invalid: "Pi returned invalid session statistics.",
  } satisfies PiReadback<Pick<SessionState, "context" | "cost" | "tokens">>,
  /** Every session entry; readers check each entry defensively. */
  entries: (): PiReadback<ReadonlyArray<unknown>> => ({
    command: { type: "get_entries" },
    decode: (data) => {
      const entries = fieldOf(data, "entries");
      return Array.isArray(entries) ? entries : undefined;
    },
    invalid: "Pi returned invalid session entries.",
  }),
  /** Slash commands in invocation precedence. */
  commands: {
    command: { type: "get_commands" },
    decode: commandsOf,
    invalid: "Pi returned an invalid command catalog.",
  } satisfies PiReadback<ReadonlyArray<SlashCommand>>,
  /** Model choices, in Pi's order. */
  models: {
    command: { type: "get_available_models" },
    decode: modelChoicesOf,
    invalid: "Pi returned an invalid model catalog.",
  } satisfies PiReadback<ReadonlyArray<ModelChoice>>,
};

// ── Outbound commands ────────────────────────────────────────────────────────

/** Pi's CLI arguments for opening a session after `--mode rpc`. */
export const sessionArgs = (spec: {
  sessionId: string;
  sessionFile?: string;
  model?: string;
  thinkingLevel?: string;
  name?: string;
  dispatchedFrom?: string;
}): string[] => [
  ...(spec.sessionFile ? ["--session", spec.sessionFile] : ["--session-id", spec.sessionId]),
  ...(spec.model ? ["--model", spec.model] : []),
  ...(spec.thinkingLevel ? ["--thinking", spec.thinkingLevel] : []),
  // --name names a new session; existing history keeps the name Pi saved in it.
  ...(spec.name && !spec.sessionFile ? ["--name", spec.name] : []),
  // Piano's extension records it once in a new session; saved history already holds it.
  ...(spec.dispatchedFrom && !spec.sessionFile
    ? [`--${DISPATCHED_FROM_FLAG}`, spec.dispatchedFrom]
    : []),
];

/** One RPC record for Pi's stdin; the transport adds the request id. */
export type PiCommand = { readonly type: string; readonly [key: string]: unknown };

/** Why a browser action cannot be sent to Pi. */
export type PiRejection = { readonly rejected: string };

const imagesValid = (attachments: unknown) =>
  Schema.is(Attachments)(attachments) &&
  !attachments.some((a) => {
    const bytes = Buffer.from(a.data, "base64");
    return bytes.toString("base64") !== a.data || imageType(bytes) !== a.mimeType;
  });

/** Cancels an open dialog; Pi sends no acknowledgement. */
export const dialogCancellation = (id: string): PiCommand => ({
  type: "extension_ui_response",
  id,
  cancelled: true,
});

/** How Pi took a prompt (INV-03), from its acknowledgement. */
export type PiDisposition = "started" | "queued" | "handled";

/** The decoded reply to each exchanged action's command. Null: Pi's acknowledgement is all. */
interface PiReplies {
  readonly prompt: PiDisposition;
  readonly steer: PiDisposition;
  readonly restore_queue: ReadonlyArray<QueuedMessage>;
  readonly abort: null;
  readonly set_model: null;
  readonly set_thinking_level: null;
  readonly set_name: null;
}

/** A browser action Piano sends as one Pi command with a reply. */
export type PiExchangedAction = Extract<SessionAction, { _tag: keyof PiReplies }>;

const acknowledged = (command: PiCommand): PiExchange<null> => ({
  command,
  decode: () => null,
  invalid: "",
});

/**
 * A browser action as Pi's command and how its reply decodes, or why it cannot be sent. Stop has
 * no single Pi command, listing commands is a readback, and an answer gets no reply.
 */
export function piExchangeFor<A extends PiExchangedAction>(
  action: A,
): PiExchange<PiReplies[A["_tag"]]> | PiRejection;
export function piExchangeFor(
  action: PiExchangedAction,
): PiExchange<PiReplies[keyof PiReplies]> | PiRejection {
  switch (action._tag) {
    case "abort":
      return acknowledged({ type: "abort" });
    case "restore_queue":
      return {
        command: { type: "clear_queue" },
        decode: queuedMessagesOf,
        invalid: "Pi returned an invalid cleared queue.",
      };
    case "set_thinking_level":
      return acknowledged({ type: "set_thinking_level", level: action.level });
    case "prompt":
    case "steer": {
      const { attachments } = action;
      if (attachments?.length && !imagesValid(attachments))
        return {
          rejected:
            "Invalid image attachments. Use PNG, JPEG, GIF or WebP, up to 10 MiB each and 20 MiB total (4 images).",
        };
      return {
        command: {
          type: "prompt",
          message: skillCommandForPi(action.text),
          ...(attachments && {
            images: attachments.map((a) => ({ type: "image", data: a.data, mimeType: a.mimeType })),
          }),
          streamingBehavior: action._tag === "steer" ? "steer" : "followUp",
        },
        decode: (data) => {
          const disposition = fieldOf(data, "disposition");
          return disposition === "started" || disposition === "queued" || disposition === "handled"
            ? disposition
            : undefined;
        },
        invalid:
          "Pi acknowledged the input without a recognized disposition. Inspect the session before sending again.",
      };
    }
    case "set_model": {
      const slash = action.model.indexOf("/");
      if (slash <= 0) return { rejected: `Model must be provider/id, got "${action.model}"` };
      return acknowledged({
        type: "set_model",
        provider: action.model.slice(0, slash),
        modelId: action.model.slice(slash + 1),
      });
    }
    case "set_name": {
      const name = action.name.replace(/[\r\n]+/g, " ").trim();
      if (!name) return { rejected: "A session name cannot be empty." };
      return acknowledged({ type: "set_session_name", name });
    }
  }
}

/** A dialog answer as the record Pi takes for the open dialog it targets; Pi sends no reply. */
export const dialogAnswerFor = (
  action: Extract<SessionAction, { _tag: "answer" }>,
  dialog: Dialog,
): { readonly command: PiCommand } | PiRejection => {
  if (action.cancelled) return { command: dialogCancellation(dialog.id) };
  let value = action.value ?? "";
  if (dialog.method === "select") {
    // Keep protocol values private. Redacted labels must not change
    // what Pi receives, nor silently choose between colliding labels.
    const redaction = compileRedaction();
    const options = dialog.options?.filter((option) => redaction.text(option) === value) ?? [];
    if (options.length !== 1)
      return {
        rejected:
          "This option is unavailable or ambiguous after redaction. Cancel the dialog instead.",
      };
    value = options[0];
  }
  return {
    command: {
      type: "extension_ui_response",
      id: dialog.id,
      ...(action.confirmed !== undefined ? { confirmed: action.confirmed } : { value }),
    },
  };
};

// ── Live records ─────────────────────────────────────────────────────────────

/** A Pi readback a record makes due. */
export type RefreshKind = "stats" | "context" | "state";

/** What one Pi record means for the session, to publish atomically in this order. */
export interface RecordProjection {
  /** State fields the record establishes, merged into current state before `events`. */
  readonly state?: Partial<SessionState>;
  readonly events: ReadonlyArray<SessionEvent>;
  /** Readbacks to schedule after publishing; never awaited by the record consumer. */
  readonly refresh: ReadonlyArray<RefreshKind>;
  /** A dialog Pi just requested, not among `events`: the caller sets its deadline, publishes it
   * and owns its resolution. */
  readonly dialog?: DialogRequest;
}

/** Pi's facts about a requested dialog: a wire `Dialog` before Piano sets its deadline.
 * `timeoutMs` is Pi's advertised timeout, if it gave a usable one. */
export type DialogRequest = Omit<Dialog, "deadlineAt" | "deadlineKind">;

const DIALOG_METHODS = new Set(["select", "confirm", "input", "editor"]);
const EXTENSION_STATE_METHODS = new Set(["setStatus", "setWidget", "setTitle", "set_editor_text"]);
const project = (
  events: ReadonlyArray<SessionEvent> = [],
  state?: Partial<SessionState>,
  refresh: ReadonlyArray<RefreshKind> = [],
): RecordProjection => ({ events, refresh, ...(state ? { state } : {}) });
const notice = (level: "info" | "warning" | "error", message: string): SessionEvent => ({
  _tag: "notice",
  level,
  message,
});

/**
 * One Pi child's records in the browser's vocabulary. Owns everything a record sequence
 * implies: the streaming partial, tool executions, retry flags,
 * extension status/widgets and dialog requests. Pure and synchronous; callers serialize
 * `record`, `history` and `closed` under their snapshot lock.
 */
export class PiProjector {
  /** The assistant message being streamed. Its id is the one its final message will carry, so
   * the browser keeps one row from first delta to end. */
  private partial: RenderMsg | undefined;
  private blocks = new Map<number, Block>();
  private tools = new Map<string, ToolExecution>();
  /** Pi's message count as last read back plus the messages ended since: the next one's position. */
  private messages = 0;
  private turnRetry = false;
  private summaryRetry = false;
  private extension: NonNullable<SessionState["extension"]> = { statuses: [], widgets: [] };
  private seenDialogs = new Set<string>();
  private liveRun = false;
  private responseSucceeded = false;
  private cancelled = false;

  /** An admitted abort cannot be announced as a successful response. */
  abort(): void {
    this.cancelled = true;
  }

  /** `generation` names this child in dialog and editor request IDs. */
  private readonly options: { readonly generation: string };
  constructor(options: { readonly generation: string }) {
    this.options = options;
  }

  /** The opening Snapshot from Pi's facts, before any record arrives. Retains its message count
   * for subsequent live records. */
  snapshot(facts: PiSessionFacts): Snapshot {
    this.messages = facts.messages.length;
    return snapshotOf(facts);
  }

  /** Seed or replace authoritative history (`get_messages`) and retain its message count
   * for subsequent live records. The messages themselves remain owned by Pi. */
  history(msgs: ReadonlyArray<RawMessage>): RenderMsg[] {
    this.messages = msgs.length;
    return serializeMessages(msgs);
  }

  record(raw: PiRecord, receivedAt: number): RecordProjection {
    switch (raw.type) {
      case "agent_start":
        this.liveRun = true;
        this.responseSucceeded = false;
        this.cancelled = false;
        return project([], { isStreaming: true });
      case "queue_update": {
        const messages = queuedMessagesOf(raw);
        return project([
          messages
            ? { _tag: "queue_update", messages }
            : notice("warning", "Pi sent an invalid queue update."),
        ]);
      }
      case "agent_settled": {
        const completed = this.liveRun && this.responseSucceeded && !this.cancelled;
        this.liveRun = false;
        this.turnRetry = false;
        this.summaryRetry = false;
        return project(
          [...this.settle(), ...(completed ? [{ _tag: "response_completed" as const }] : [])],
          { isStreaming: false, isCompacting: false, isRetrying: false },
          ["context", "state", "stats"],
        );
      }
      case "message_start":
        return project(this.stream(raw), { contextIsLastKnown: true });
      case "message_end":
        return project(this.stream(raw), { contextIsLastKnown: true }, ["stats"]);
      case "compaction_start":
        return project([notice("info", `Compacting context (${raw.reason})`)], {
          isCompacting: true,
        });
      case "compaction_end":
        // Pi reports null tokens/percent until fresh post-compaction usage exists.
        return project([], { isCompacting: false }, ["context", "stats"]);
      case "session_info_changed":
        return project([], { sessionName: raw.name as string | undefined });
      case "thinking_level_changed":
        return project([], { thinkingLevel: raw.level as string | undefined });
      case "auto_retry_start":
        this.turnRetry = true;
        return project(
          [notice("warning", `Retrying (${raw.attempt}/${raw.maxAttempts}): ${raw.errorMessage}`)],
          { isStreaming: true, isRetrying: true },
        );
      case "auto_retry_end":
        this.turnRetry = false;
        return project([], { isRetrying: this.summaryRetry });
      case "summarization_retry_scheduled":
        this.summaryRetry = true;
        return project(
          [
            notice(
              "warning",
              `Retrying summary (${raw.attempt}/${raw.maxAttempts}): ${raw.errorMessage}`,
            ),
          ],
          { isRetrying: true },
        );
      case "summarization_retry_finished":
        this.summaryRetry = false;
        return project([], { isRetrying: this.turnRetry });
      case "extension_error":
        return project([notice("error", `Extension error: ${raw.error}`)]);
      case "extension_ui_request":
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
    if (method === "notify") {
      return project([
        notice(
          raw.notifyType === "error" ? "error" : raw.notifyType === "warning" ? "warning" : "info",
          String(raw.message ?? ""),
        ),
      ]);
    }
    if (EXTENSION_STATE_METHODS.has(method)) {
      const current = this.extension;
      const extension = { ...current };
      if (method === "setStatus")
        extension.statuses = [
          ...current.statuses.filter((s) => s.key !== raw.statusKey),
          ...(typeof raw.statusText === "string"
            ? [{ key: String(raw.statusKey), text: raw.statusText }]
            : []),
        ];
      if (method === "setWidget")
        extension.widgets = [
          ...current.widgets.filter((w) => w.key !== raw.widgetKey),
          ...(Array.isArray(raw.widgetLines)
            ? [
                {
                  key: String(raw.widgetKey),
                  lines: raw.widgetLines.map(String),
                  placement:
                    raw.widgetPlacement === "belowEditor"
                      ? ("belowEditor" as const)
                      : ("aboveEditor" as const),
                },
              ]
            : []),
        ];
      if (method === "setTitle") extension.title = String(raw.title ?? "");
      if (method === "set_editor_text")
        extension.editorRequest = {
          id: `${this.options.generation}:${raw.id}`,
          text: String(raw.text ?? ""),
        };
      this.extension = extension;
      return project([], { extension });
    }
    const id = String(raw.id);
    if (!DIALOG_METHODS.has(method) || this.seenDialogs.has(id)) return project();
    this.seenDialogs.add(id);
    const dialog: DialogRequest = {
      id,
      generation: this.options.generation,
      receivedAt,
      timeoutMs:
        typeof raw.timeout === "number" && Number.isFinite(raw.timeout) && raw.timeout > 0
          ? raw.timeout
          : undefined,
      method: method as Dialog["method"],
      title: raw.title as string | undefined,
      message: raw.message as string | undefined,
      options: raw.options as string[] | undefined,
      placeholder: raw.placeholder as string | undefined,
      prefill: raw.prefill as string | undefined,
    };
    return { events: [], refresh: [], dialog };
  }

  /** Streaming output: the partial reply, final messages and tool executions. */
  private stream(raw: PiRecord): SessionEvent[] {
    const event = raw as MessageEventRecord;
    switch (event.type) {
      case "message_start": {
        if (event.message?.role !== "assistant") return [];
        this.blocks.clear();
        if (Array.isArray(event.message.content))
          event.message.content.forEach((b, i) => {
            if (b.type === "text") this.blocks.set(i, { type: "text", text: b.text ?? "" });
            if (b.type === "toolCall")
              this.blocks.set(i, {
                type: "tool",
                id: b.id ?? "",
                name: b.name ?? "",
                args: argsOf(b.arguments),
                writtenPath: writtenPath(b.name, b.arguments),
              });
          });
        this.partial = serializeMessage(this.nextId(), event.message) ?? undefined;
        return this.update();
      }
      case "message_update": {
        const ev = event.assistantMessageEvent;
        if (!ev) return [];
        if (!this.partial) this.partial = { id: this.nextId(), role: "assistant", text: "" };
        if (event.usage) this.partial = { ...this.partial, usage: usageOf(event.usage) };
        const index = ev.contentIndex ?? 0;
        const block = this.blocks.get(index);
        switch (ev.type) {
          case "text_start":
            this.blocks.set(index, { type: "text", text: "" });
            break;
          case "text_delta":
            this.blocks.set(index, {
              type: "text",
              text: (block?.type === "text" ? block.text : "") + (ev.delta ?? ""),
            });
            break;
          case "text_end":
            this.blocks.set(index, { type: "text", text: ev.content ?? "" });
            break;
          case "toolcall_start":
            this.blocks.set(index, {
              type: "tool",
              id: ev.id ?? "",
              name: ev.toolName ?? "",
              args: "",
            });
            break;
          case "toolcall_delta":
            if (block?.type === "tool")
              this.blocks.set(index, { ...block, args: block.args + (ev.delta ?? "") });
            break;
          case "toolcall_end":
            if (ev.toolCall)
              this.blocks.set(index, {
                type: "tool",
                id: ev.toolCall.id,
                name: ev.toolCall.name,
                args: argsOf(ev.toolCall.arguments),
                writtenPath: writtenPath(ev.toolCall.name, ev.toolCall.arguments),
              });
            break;
        }
        return this.update();
      }
      case "message_end": {
        // An assistant message ends its partial and takes the id the partial was shown under.
        const reserved = event.message?.role === "assistant" ? this.partial?.id : undefined;
        if (event.message?.role === "assistant") {
          this.responseSucceeded = turnEnding(event.message.stopReason) === "completed";
          this.partial = undefined;
          this.blocks.clear();
        }
        if (!event.message) return [];
        const message = serializeMessage(reserved ?? this.nextId(), event.message);
        return message ? [{ _tag: "message_end", message }] : [];
      }
      case "tool_execution_start":
      case "tool_execution_update":
      case "tool_execution_end": {
        const id = event.toolCallId ?? "";
        const old = this.tools.get(id);
        const ended = event.type === "tool_execution_end";
        const result = ended ? event.result : event.partialResult;
        const redaction = compileRedaction();
        const tool: ToolExecution = redaction.wire({
          id,
          parentId: event.parentToolCallId ?? old?.parentId,
          name: event.toolName ?? old?.name ?? "",
          writtenPath:
            event.args === undefined
              ? old?.writtenPath
              : writtenPath(event.toolName ?? old?.name, event.args),
          args:
            event.args === undefined
              ? (old?.args ?? "")
              : redaction.text(argsOf(event.args), !ended),
          // RPC does not define arbitrary tool updates as append-only. Show the
          // latest update explicitly; only execution_end claims complete output.
          text: result ? redaction.text(textOf(result.content), !ended) : (old?.text ?? ""),
          status: ended ? (event.isError ? "error" : "success") : "running",
          outputKind: ended ? "final" : "latest-update",
        });
        // Only unfinished executions need correlation for later updates/settlement. Publication
        // owns completed previews; retaining them here keeps obsolete output after compaction.
        if (ended) this.tools.delete(id);
        else this.tools.set(id, tool);
        return [{ _tag: "tool_update", tool }];
      }
      default:
        return [];
    }
  }

  private nextId(): string {
    return messageId(this.messages++);
  }

  /** Pi will not continue this run: drop the partial and mark unfinished tools incomplete. */
  private settle(): SessionEvent[] {
    this.partial = undefined;
    this.blocks.clear();
    const events = [...this.tools.values()].map((tool) => ({
      _tag: "tool_update" as const,
      tool: { ...tool, status: "incomplete" as const },
    }));
    this.tools.clear();
    return events;
  }

  private update(): SessionEvent[] {
    if (!this.partial) return [];
    const blocks = [...this.blocks.entries()].sort(([a], [b]) => a - b).map(([, b]) => b);
    const redaction = compileRedaction();
    this.partial = redaction.wire({
      ...this.partial,
      text: redaction.text(
        blocks
          .filter((b) => b.type === "text")
          .map((b) => b.text)
          .join(""),
        true,
      ),
      toolCalls: blocks.flatMap((b) =>
        b.type === "tool"
          ? [
              {
                id: b.id,
                name: b.name,
                args: redaction.text(b.args, true),
                writtenPath: b.writtenPath,
              },
            ]
          : [],
      ),
    });
    return [{ _tag: "message_update", message: this.partial }];
  }
}
