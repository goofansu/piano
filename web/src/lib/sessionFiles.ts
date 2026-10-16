/**
 * The files a session's conversation wrote or edited, for the composer's Files popover. Only
 * Pi's own write and edit calls count, and only ones that succeeded: a failed edit changed
 * nothing, and a bash command's effects are unknowable from its text.
 */
import type { RenderMsg, Workspace, WorkspaceIgnoredFiles } from "../../../shared/wire.ts";

export interface SessionFile {
  /** As the tool call named it: absolute, or relative to the session's directory. */
  path: string;
  /** The message that wrote or edited it last. */
  messageId: string;
}

const WRITING_TOOLS = new Set(["write", "edit"]);

function calledPath(args: string): string | undefined {
  try {
    const a = JSON.parse(args) as Record<string, unknown>;
    const path = a.path ?? a.file_path;
    return typeof path === "string" && path.trim() ? path : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Every file a successful write or edit touched, in conversation order, each path once at its
 * latest touch. A call without a result yet, or whose result is an error, is not a touch.
 */
export function sessionFiles(messages: ReadonlyArray<RenderMsg>): SessionFile[] {
  const failed = new Set<string>();
  const settled = new Set<string>();
  for (const m of messages) {
    if (m.role !== "tool_result" || !m.toolCallId) continue;
    settled.add(m.toolCallId);
    if (m.isError) failed.add(m.toolCallId);
  }
  const seen = new Set<string>();
  // Message groups, newest first, so a path is kept where it was touched last.
  const groups: SessionFile[][] = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]!;
    if (message.role !== "assistant" || !message.toolCalls?.length) continue;
    const found: SessionFile[] = [];
    for (const call of message.toolCalls) {
      if (!WRITING_TOOLS.has(call.name)) continue;
      if (!settled.has(call.id) || failed.has(call.id)) continue;
      const path = calledPath(call.args);
      if (path) found.push({ path, messageId: message.id });
    }
    const fresh = found.filter((file) => {
      if (seen.has(file.path)) return false;
      seen.add(file.path);
      return true;
    });
    if (fresh.length) groups.push(fresh);
  }
  // Oldest message first; within a message, the order the calls were made in.
  return groups.reverse().flat();
}

/** The name on its own and the directory beside it, for a two-line row. */
export function splitPath(path: string): { name: string; dir: string } {
  const cut = path.lastIndexOf("/");
  return cut < 0 ? { name: path, dir: "" } : { name: path.slice(cut + 1), dir: path.slice(0, cut) };
}

/**
 * The files worth listing: those Git does not ignore and that lie inside the workspace, as the
 * latest observation for this workspace says (INV-07). Without one, or after a failed read,
 * every file shows: the facts in hand beat an empty list.
 */
export function visibleFiles(
  files: readonly SessionFile[],
  observation: WorkspaceIgnoredFiles | undefined,
  workspace: Workspace | undefined,
): SessionFile[] {
  if (
    !workspace ||
    observation?.workspace.id !== workspace.id ||
    observation.workspace.path !== workspace.path ||
    observation.result.status !== "ready"
  )
    return [...files];
  const hidden = new Set([...observation.result.ignored, ...observation.result.outside]);
  return files.filter((file) => !hidden.has(file.path));
}

/** The path as the list shows it: relative to the session's directory when inside it, else with
 * the home directory abbreviated. Opening still uses the path as the call named it. */
export function displayPath(path: string, cwd: string | undefined, abbrev: (p: string) => string) {
  const root = cwd?.replace(/\/+$/, "");
  if (root && path.startsWith(`${root}/`)) return path.slice(root.length + 1);
  return abbrev(path);
}
