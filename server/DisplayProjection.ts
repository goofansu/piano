import { stripVTControlCharacters } from "node:util";
import { readProposal } from "../shared/library.ts";
import type {
  Dialog,
  ServerMessage,
  SessionActionResult,
  SessionEvent,
  SessionState,
  Snapshot,
} from "../shared/wire.ts";

const marker = "[REDACTED]";

export const isSecretName = (key: string) =>
  /(?:TOKEN|SECRET|PASSWORD|API_?KEY|CREDENTIAL)/i.test(key);

export interface DisplayRedaction {
  readonly text: (text: string) => string;
  readonly wire: <T>(value: T) => T;
}

const IDENTITY_FIELDS: ReadonlySet<string> = new Set([
  "inputFingerprint",
  "writtenPath",
  "path",
  "cwd",
  "folder",
  "parent",
  "home",
  "gitRoot",
  "currentPath",
  "sessionFile",
  "placed",
  "instanceId",
]);

const isIdentity = (field: unknown) =>
  typeof field === "string" ||
  (Array.isArray(field) && field.every((item) => typeof item === "string"));

const namesPath = (item: Record<string, unknown>) =>
  typeof item.name === "string" &&
  typeof item.path === "string" &&
  item.name === (item.path.split("/").filter(Boolean).pop() ?? item.path);

const deep = (text: (input: string) => string) => {
  const wire = <T>(item: T): T => {
    if (typeof item === "string") return text(item) as T;
    if (Array.isArray(item)) return item.map(wire) as T;
    if (item && typeof item === "object") {
      const record = item as Record<string, unknown>;
      const named = namesPath(record);
      return Object.fromEntries(
        Object.entries(record).map(([key, field]) => [
          key,
          (IDENTITY_FIELDS.has(key) && isIdentity(field)) || (named && key === "name")
            ? field
            : wire(field),
        ]),
      ) as T;
    }
    return item;
  };
  return wire;
};

export const stripControls = deep(function strip(input: string): string {
  const next = stripVTControlCharacters(input);
  return next === input ? input : strip(next);
});

export const KNOWN_SECRET_MIN = 8;

export function compileRedaction(): DisplayRedaction {
  const secrets = Object.entries(process.env)
    .filter(([key, value]) => isSecretName(key) && value && value.length >= KNOWN_SECRET_MIN)
    .map(([, value]) => value!)
    .sort((a, b) => b.length - a.length);
  const text = (input: string): string => {
    let safe = structured(stripVTControlCharacters(input));
    for (const secret of secrets) safe = safe.split(secret).join(marker);
    safe = safe
      .replace(/\b(?:sk-|ghp_|github_pat_|xox[bp]-)[\w-]+/g, marker)
      .replace(/(\bBearer\s+)[A-Za-z0-9._~+/-]+=*/gi, "$1" + marker)
      .replace(
        /((?:api[_-]?key|token|password|secret)\s*[=:]\s*(?:\\?["'])?)((?:[^\s"',;\]}\\]|\\(?!["']))+)/gi,
        (_, lead: string, value: string) => lead + (value.startsWith("[REDACTED") ? value : marker),
      )
      .replace(
        /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-]*PRIVATE KEY-----|$)/g,
        marker,
      );
    return safe;
  };
  const structured = (input: string): string => {
    if (!/^\s*[[{]/.test(input)) return input;
    let parsed: unknown;
    try {
      parsed = JSON.parse(input);
    } catch {
      return input;
    }
    const before = JSON.stringify(parsed);
    const redacted = leaves(parsed);
    const after = JSON.stringify(redacted);
    return after === before
      ? input
      : JSON.stringify(redacted, null, /^[[{]\n( +)/.exec(input)?.[1]);
  };
  const leaves = (item: unknown): unknown => {
    if (typeof item === "string") return text(item);
    if (typeof item === "number") return text(String(item)) === String(item) ? item : marker;
    if (Array.isArray(item)) return item.map(leaves);
    if (item && typeof item === "object")
      return Object.fromEntries(
        Object.entries(item).map(([key, field]) => [text(key), leaves(field)]),
      );
    return item;
  };
  return { text, wire: deep(text) };
}

export function projectDisplay<T>(value: T): T {
  return compileRedaction().wire(value);
}

const TRANSCRIPT_EVENTS: ReadonlySet<SessionEvent["_tag"]> = new Set([
  "message_update",
  "message_end",
  "context",
  "tool_update",
]);

export function concealsApproval(dialog: Dialog, redaction = compileRedaction()): boolean {
  if (!readProposal(dialog)) return false;
  const changed = (text: string | undefined) => text !== undefined && redaction.text(text) !== text;
  return changed(dialog.title) || changed(dialog.message);
}

function projectDialog(dialog: Dialog, redaction: DisplayRedaction): Dialog {
  const shown = redaction.wire(dialog);
  return concealsApproval(dialog, redaction) ? { ...shown, concealed: true } : shown;
}

const SAVED_BACK_FIELDS = {
  project: ["name", "instructions"],
  sessionReference: ["title"],
  sessionState: ["sessionName"],
} as const;

function keepSavedBack<T extends object>(item: T, shown: T, fields: readonly (keyof T)[]): T {
  const kept = { ...shown };
  for (const key of fields) if (key in item) kept[key] = stripControls(item[key]);
  return kept;
}

export function projectState(state: SessionState, redaction = compileRedaction()): SessionState {
  const { queuedMessages, ...rest } = state;
  const shown = keepSavedBack(rest, redaction.wire(rest), SAVED_BACK_FIELDS.sessionState);
  return queuedMessages === undefined
    ? shown
    : { ...shown, queuedMessages: stripControls(queuedMessages) };
}

function projectActionResult(result: SessionActionResult): SessionActionResult {
  if (result._tag !== "queue_restored") return projectDisplay(result);
  const { messages, ...rest } = result;
  return { ...projectDisplay(rest), messages: stripControls(messages) };
}

export function projectSnapshot(snapshot: Snapshot): Snapshot {
  const { messages, pending, tools, state, ...rest } = snapshot;
  const redaction = compileRedaction();
  const shown = redaction.wire(rest);
  return {
    ...shown,
    state: projectState(state, redaction),
    dialogs: rest.dialogs.map((dialog) => projectDialog(dialog, redaction)),
    messages,
    ...("pending" in snapshot ? { pending } : {}),
    ...("tools" in snapshot ? { tools } : {}),
  };
}

export function projectSessionEvent(event: SessionEvent): SessionEvent {
  if (TRANSCRIPT_EVENTS.has(event._tag)) return event;
  if (event._tag === "snapshot") return { ...event, snapshot: projectSnapshot(event.snapshot) };
  if (event._tag === "state") return { ...event, state: projectState(event.state) };
  if (event._tag === "queue_update") return { ...event, messages: stripControls(event.messages) };
  if (event._tag === "dialog")
    return { ...event, dialog: projectDialog(event.dialog, compileRedaction()) };
  return projectDisplay(event);
}

export function projectServerMessage(message: ServerMessage): ServerMessage {
  if (message._tag === "registry") {
    const { projects, sessionReferences, ...rest } = message;
    const redaction = compileRedaction();
    const saved = <T extends object>(items: readonly T[], fields: readonly (keyof T)[]) =>
      items.map((item) => keepSavedBack(item, redaction.wire(item), fields));
    return {
      ...redaction.wire(rest),
      ...(projects && { projects: saved(projects, SAVED_BACK_FIELDS.project) }),
      ...(sessionReferences && {
        sessionReferences: saved(sessionReferences, SAVED_BACK_FIELDS.sessionReference),
      }),
    };
  }
  if (message._tag === "session") {
    const { event, ...envelope } = message;
    return { ...projectDisplay(envelope), event };
  }
  if (message._tag === "action_result") {
    const { result, ...envelope } = message;
    return { ...projectDisplay(envelope), result: projectActionResult(result) };
  }
  if (message._tag === "selected") {
    const { snapshot, ...envelope } = message;
    return { ...projectDisplay(envelope), snapshot: projectSnapshot(snapshot) };
  }
  return projectDisplay(message);
}
