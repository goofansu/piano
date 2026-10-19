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
  /** Its name in the workspace, relative to the root, once Git's answer has placed the path. */
  placed?: string;
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
    const found: SessionFile[] = [];
    if (message.role === "assistant")
      for (const call of message.toolCalls ?? []) {
        if (!settled.has(call.id) || failed.has(call.id)) continue;
        if (call.writtenPath) found.push({ path: call.writtenPath, messageId: message.id });
      }
    if (message.role === "tool_result")
      for (const call of message.nestedCalls ?? []) {
        if (call.status === "success" && call.writtenPath)
          found.push({ path: call.writtenPath, messageId: message.id });
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
 * latest observation for this workspace says (INV-07), each file once at its latest touch. The
 * answer names the file each path places to, so spellings of one file (relative, absolute,
 * through a symlink) are one entry; a path it does not cover stays as `sessionFiles` spelled it.
 * Without an answer, or after a failed read, every path shows: the facts in hand beat an empty list.
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
  const { ignored, outside, inside, placed } = observation.result;
  const hidden = new Set([...ignored, ...outside]);
  const names = new Map(inside.map((path, i) => [path, placed[i]]));
  // Files come in conversation order, so moving a file to the end keeps it at its latest touch.
  const byName = new Map<string, SessionFile>();
  const shown: SessionFile[] = [];
  for (const file of files) {
    if (hidden.has(file.path)) continue;
    const name = names.get(file.path);
    if (name === undefined) {
      shown.push(file);
      continue;
    }
    const entry = { ...file, placed: name };
    const earlier = byName.get(name);
    if (earlier) shown.splice(shown.indexOf(earlier), 1);
    byName.set(name, entry);
    shown.push(entry);
  }
  return shown;
}

/** The path as the list shows it: its placed name once Git's answer covers it, else relative to
 * the session's directory when inside it, else with the home directory abbreviated. Opening
 * still uses the path as the call named it. */
export function displayPath(
  { path, placed }: Pick<SessionFile, "path" | "placed">,
  cwd: string | undefined,
  abbrev: (p: string) => string,
) {
  if (placed !== undefined) return placed;
  const root = cwd?.replace(/\/+$/, "");
  if (root && path.startsWith(`${root}/`)) return path.slice(root.length + 1);
  return abbrev(path);
}
