import { stripVTControlCharacters } from "node:util";
import { readProposal } from "../shared/library.ts";
import type { Dialog, Project, ServerMessage, SessionEvent, Snapshot } from "../shared/wire.ts";

const marker = "[REDACTED]";
const prefixes = ["sk-", "ghp_", "github_pat_", "xoxb-", "xoxp-"];

export const isSecretName = (key: string) =>
  /(?:TOKEN|SECRET|PASSWORD|API_?KEY|CREDENTIAL)/i.test(key);

export interface DisplayRedaction {
  readonly text: (text: string, streaming?: boolean) => string;
  readonly value: <T>(value: T) => T;
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

export const KNOWN_SECRET_MIN = 8;

export function compileRedaction({ secrets: redactSecrets = true } = {}): DisplayRedaction {
  const secrets = redactSecrets
    ? Object.entries(process.env)
        .filter(([key, value]) => isSecretName(key) && value && value.length >= KNOWN_SECRET_MIN)
        .map(([, value]) => value!)
        .sort((a, b) => b.length - a.length)
    : [];
  const known = new Set(secrets);
  const partials = [...secrets, ...prefixes, "Bearer ", "-----BEGIN "];
  const text = (input: string, streaming = false): string => {
    if (!redactSecrets) return stripVTControlCharacters(input);
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
    if (streaming) {
      for (const secret of partials) {
        const minimum = known.has(secret) ? 1 : 3;
        for (let n = Math.min(safe.length, secret.length - 1); n >= minimum; n--) {
          if (safe.endsWith(secret.slice(0, n))) {
            safe = safe.slice(0, -n) + marker;
            break;
          }
        }
      }
    }
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
  const value = <T>(item: T): T => {
    if (typeof item === "string") return text(item) as T;
    if (Array.isArray(item)) return item.map(value) as T;
    if (item && typeof item === "object")
      return Object.fromEntries(
        Object.entries(item).map(([key, field]) => [key, value(field)]),
      ) as T;
    return item;
  };
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
  return { text, value, wire };
}

export const compileTranscriptDisplay = () => compileRedaction({ secrets: false });

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

export function projectSnapshot(snapshot: Snapshot): Snapshot {
  const { messages, pending, tools, ...rest } = snapshot;
  const redaction = compileRedaction();
  const shown = redaction.wire(rest);
  return {
    ...shown,
    dialogs: rest.dialogs.map((dialog) => projectDialog(dialog, redaction)),
    messages,
    ...("pending" in snapshot ? { pending } : {}),
    ...("tools" in snapshot ? { tools } : {}),
  };
}

export function projectSessionEvent(event: SessionEvent): SessionEvent {
  if (TRANSCRIPT_EVENTS.has(event._tag)) return event;
  if (event._tag === "snapshot") return { ...event, snapshot: projectSnapshot(event.snapshot) };
  if (event._tag === "dialog")
    return { ...event, dialog: projectDialog(event.dialog, compileRedaction()) };
  return projectDisplay(event);
}

const AUTHORED_PROJECT_FIELDS = ["name", "instructions"] as const;

const projectProject = (project: Project): Project => {
  const shown: Record<string, unknown> = { ...projectDisplay(project) };
  for (const key of AUTHORED_PROJECT_FIELDS) if (key in project) shown[key] = project[key];
  return shown as Project;
};

export function projectServerMessage(message: ServerMessage): ServerMessage {
  if (message._tag === "registry") {
    const { projects, ...rest } = message;
    const shown = projectDisplay(rest);
    return projects === undefined ? shown : { ...shown, projects: projects.map(projectProject) };
  }
  if (message._tag === "session") {
    const { event, ...envelope } = message;
    return { ...projectDisplay(envelope), event };
  }
  if (message._tag === "selected") {
    const { snapshot, ...envelope } = message;
    return { ...projectDisplay(envelope), snapshot: projectSnapshot(snapshot) };
  }
  return projectDisplay(message);
}
