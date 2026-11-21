import type { RenderMsg, Workspace } from "../../../../shared/wire.ts";
import { sameWorkspace, type WorkspaceWrittenFiles } from "../../contracts/files/http.ts";

export interface SessionFile {
  path: string;
  messageId: string;
  placed?: string;
}

export function sessionFiles(messages: ReadonlyArray<RenderMsg>): SessionFile[] {
  const failed = new Set<string>();
  const settled = new Set<string>();
  for (const m of messages) {
    if (m.role !== "tool_result" || !m.toolCallId) continue;
    settled.add(m.toolCallId);
    if (m.isError) failed.add(m.toolCallId);
  }
  const seen = new Set<string>();
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
  return groups.reverse().flat();
}

export function splitPath(path: string): { name: string; dir: string } {
  const cut = path.lastIndexOf("/");
  return cut < 0 ? { name: path, dir: "" } : { name: path.slice(cut + 1), dir: path.slice(0, cut) };
}

export function visibleFiles(
  files: readonly SessionFile[],
  observation: WorkspaceWrittenFiles | undefined,
  workspace: Workspace | undefined,
): SessionFile[] {
  if (
    !workspace ||
    !observation ||
    !sameWorkspace(observation.workspace, workspace) ||
    observation.result.status !== "ready"
  )
    return [...files];
  const verdicts = new Map(observation.result.files.map((file) => [file.path, file]));
  const byName = new Map<string, SessionFile>();
  const shown: SessionFile[] = [];
  for (const file of files) {
    const verdict = verdicts.get(file.path);
    if (verdict === undefined) {
      shown.push(file);
      continue;
    }
    if (verdict.verdict !== "listed") continue;
    const entry = { ...file, placed: verdict.placed };
    const earlier = byName.get(verdict.placed);
    if (earlier) shown.splice(shown.indexOf(earlier), 1);
    byName.set(verdict.placed, entry);
    shown.push(entry);
  }
  return shown;
}

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
