/** Browser/export projection only. Never mutate Pi records or load its credentials.
 * Heuristic protection: known secret-valued environment variables and common token
 * shapes. Encoded, unknown and tool-specific credentials are not contained by this.
 *
 * Each value is projected once, at the seam where it enters display (INV-11): PiRecords projects
 * the transcript as Pi content becomes wire messages, live or saved, PiSessions projects the rest
 * of what a session publishes or a saved peek returns (state, notices, dialogs), and socket egress projects
 * messages that never passed through a session.
 *
 * Two kinds of wire text leave verbatim: identities (paths and correlation keys, below), and text
 * the person wrote in Piano and saves back from what they are shown (a project's name and
 * instructions, see `AUTHORED_PROJECT_FIELDS`). Redacting either would overwrite what it names.
 */
import { stripVTControlCharacters } from "node:util";
import type { Project, ServerMessage, SessionEvent, Snapshot } from "../shared/wire.ts";

const marker = "[REDACTED]";
const prefixes = ["sk-", "ghp_", "github_pat_", "xoxb-", "xoxp-"];

/** Environment variables whose values are treated as known secrets. */
export const isSecretName = (key: string) =>
  /(?:TOKEN|SECRET|PASSWORD|API_?KEY|CREDENTIAL)/i.test(key);

/** One redaction pass's rule: the environment's known secrets are read once per pass, not per
 * string, so a projected object costs one environment scan however many strings it holds. */
export interface DisplayRedaction {
  readonly text: (text: string, streaming?: boolean) => string;
  /** Every string in raw Pi content (for example an export), whatever its key. */
  readonly value: <T>(value: T) => T;
  /** A wire value (shared/wire.ts, shared/http.ts): every string except the identities below. */
  readonly wire: <T>(value: T) => T;
}

/**
 * The wire fields that name a directory or file, or carry opaque correlation evidence. The browser matches them against each other and
 * sends them back (`select`, `/api/ls`, the registry's folders and sessions), so they leave
 * verbatim: a redacted path names nothing. Within the wire vocabulary these keys never hold
 * display text; raw Pi content uses `value`, while PiRecords' typed wire output uses `wire`. A path is not a secret
 * store: one spelled like a token is shown as spelled. Authored text is not an identity: it is
 * exempted by its place in a message (`projectServerMessage`), never by a key name alone.
 */
const IDENTITY_FIELDS: ReadonlySet<string> = new Set([
  "inputFingerprint", // Opaque, process-keyed input equality evidence, never display content
  "writtenPath", // Supported write/edit targets extracted by PiRecords before redaction
  "path", // DirListing, DirEntry, FolderView, Workspace, WorktreeView/Facts, ChangeFile, FilePreview, WrittenFile
  "cwd", // SessionReference, SessionCursor, HostInfo, ModelCatalog, the socket's cwd envelopes
  "folder", // Workspace, the socket's worktree messages
  "parent", // DirListing
  "home", // DirListing
  "gitRoot", // DirListing
  "currentPath", // WorktreeDiscovery
  "sessionFile", // SessionState
  "placed", // WrittenFile: the name a path inside the workspace places to
  "instanceId", // SessionPreview and its results: a stop must name the exact instance
]);

const isIdentity = (field: unknown) =>
  typeof field === "string" ||
  (Array.isArray(field) && field.every((item) => typeof item === "string"));

/** A `name` that is its object's `path`'s last segment (a folder's, a listed directory's) says
 * nothing the path does not, so it keeps the path's spelling too. */
const namesPath = (item: Record<string, unknown>) =>
  typeof item.name === "string" &&
  typeof item.path === "string" &&
  item.name === (item.path.split("/").filter(Boolean).pop() ?? item.path);

export function compileRedaction(): DisplayRedaction {
  const secrets = Object.entries(process.env)
    .filter(([key, value]) => isSecretName(key) && value && value.length >= 8)
    .map(([, value]) => value!)
    .sort((a, b) => b.length - a.length);
  const known = new Set(secrets);
  const partials = [...secrets, ...prefixes, "Bearer ", "-----BEGIN "];
  const text = (input: string, streaming = false): string => {
    let safe = stripVTControlCharacters(input);
    for (const secret of secrets) safe = safe.split(secret).join(marker);
    safe = safe
      .replace(/\b(?:sk-|ghp_|github_pat_|xox[bp]-)[\w-]+/g, marker)
      .replace(/(\bBearer\s+)[A-Za-z0-9._~+/-]+=*/gi, "$1" + marker)
      .replace(
        /((?:api[_-]?key|token|password|secret)\s*[=:]\s*["']?)([^\s"',;\]}]+)/gi,
        (_, lead: string, value: string) => lead + (value.startsWith("[REDACTED") ? value : marker),
      )
      .replace(
        /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-]*PRIVATE KEY-----|$)/g,
        marker,
      );
    if (streaming) {
      // A full cumulative partial is projected on every update. Hide any suffix
      // which could become a known secret on the next chunk, including one byte.
      for (const secret of partials) {
        // Generic token prefixes need an identifiable prefix, not every word
        // ending in “s” or “g”. Known environment values use the full suffix rule.
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

/** One rule for all outbound wire values, including notices, errors and snapshots: display text
 * is redacted, directory and file identities are not. */
export function projectDisplay<T>(value: T): T {
  return compileRedaction().wire(value);
}

/** Session events whose payload PiRecords projected where Pi content entered: rendered messages
 * and tool executions (INV-11). A session projects every other event as it publishes it. */
const TRANSCRIPT_EVENTS: ReadonlySet<SessionEvent["_tag"]> = new Set([
  "message_update",
  "message_end",
  "context",
  "tool_update",
]);

/** A snapshot for display. Its transcript (messages, partial reply, tool executions) only ever
 * holds what PiRecords projected; its state and dialogs hold readbacks and raw dialog options. */
export function projectSnapshot(snapshot: Snapshot): Snapshot {
  const { messages, pending, tools, ...rest } = snapshot;
  return {
    ...projectDisplay(rest),
    messages,
    ...("pending" in snapshot ? { pending } : {}),
    ...("tools" in snapshot ? { tools } : {}),
  };
}

/** A session event for display, projecting only what PiRecords has not already projected. */
export function projectSessionEvent(event: SessionEvent): SessionEvent {
  if (TRANSCRIPT_EVENTS.has(event._tag)) return event;
  if (event._tag === "snapshot") return { ...event, snapshot: projectSnapshot(event.snapshot) };
  return projectDisplay(event);
}

/**
 * A project's fields the person wrote in Piano: Project settings shows them and saves them back,
 * so a redacted copy would be written over the stored text (as webhook receiver URLs are sent
 * unredacted, shared/http.ts). They are the person's own words, not Pi output, so they leave as
 * stored; the project's other fields get the full pass.
 */
const AUTHORED_PROJECT_FIELDS = ["name", "instructions"] as const;

const projectProject = (project: Project): Project => {
  const shown: Record<string, unknown> = { ...projectDisplay(project) };
  for (const key of AUTHORED_PROJECT_FIELDS) if (key in project) shown[key] = project[key];
  return shown as Project;
};

/**
 * The socket egress pass. A `session` event is a PiSession frame, which the session projected
 * as it published it; only the envelope is projected here. Every other message, including a
 * `selected` snapshot's state and dialogs, gets the full pass. The `registry` message is the only
 * one carrying projects; their authored fields leave as stored.
 */
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
