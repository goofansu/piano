/** The Changes sheet's policy: when to re-read the checkout, which responses to trust, which files
 * start open, and the text the sheet shows or drafts. Pure; the sheet keeps reads and markup.
 */
import type { ChangeFile, RenderMsg, Workspace, WorkspaceChanges } from "@shared/wire";
import { CHANGES_FILE_PATCH_BYTES } from "../../../shared/wire.ts";
import { type DiffFile, lineCount, parseUnifiedDiff } from "./diff.ts";

export type ReadyResult = Extract<WorkspaceChanges["result"], { status: "ready" }>;
export type ReadyChanges = WorkspaceChanges & { result: ReadyResult };

/** A file over this many diff lines starts folded. */
export const LARGE_FILE_LINES = 800;
export const FILE_PATCH_LIMIT = `${CHANGES_FILE_PATCH_BYTES / (1024 * 1024)} MiB`;

/** Tools whose completion can change the checkout; a finished turn is also a refresh point. */
const EDITING_TOOLS = new Set(["edit", "write", "bash"]);

/** The latest checkout-changing tool result plus the streaming flag: when either moves, the checkout may have. */
export function refreshKey(session: { messages: readonly Pick<RenderMsg, "id" | "role" | "toolName">[]; state: { isStreaming: boolean } } | null): string {
  if (!session) return "";
  const streaming = session.state.isStreaming ? 1 : 0;
  for (let i = session.messages.length - 1; i >= 0; i--) {
    const m = session.messages[i];
    if (m.role === "tool_result" && m.toolName && EDITING_TOOLS.has(m.toolName)) return `${m.id}|${streaming}`;
  }
  return `none|${streaming}`;
}

/** A response for another workspace, or a failed read, never shows (INV-07). */
export function checkWorkspaceResponse(expected: Pick<Workspace, "id" | "path">, value: WorkspaceChanges, mismatch = "Changes returned a different workspace. Refresh before inspecting changes."): ReadyChanges {
  if (value.workspace.id !== expected.id || value.workspace.path !== expected.path) throw new Error(mismatch);
  if (value.result.status === "error") throw new Error(value.result.detail);
  return value as ReadyChanges;
}

export interface LoadedFile { file: DiffFile; observedAt: string; truncated: boolean }

/** One file's fresh read, matched to the file the sheet asked for. */
export function changedFile(expected: Pick<Workspace, "id" | "path">, value: WorkspaceChanges, path: string): LoadedFile {
  const { result, observedAt } = checkWorkspaceResponse(expected, value, "File response belongs to another workspace.");
  const file = parseUnifiedDiff(result.diff).find(f => f.path === path);
  const stats = result.files.find(f => f.path === path);
  if (!stats) throw new Error("File metadata is unavailable. Refresh changes.");
  if (!file) throw new Error(result.truncated ? `Patch is too large to display a complete line (${FILE_PATCH_LIMIT} limit).` : "File changed or no longer has a diff. Refresh changes.");
  return { file: { ...file, ...stats }, observedAt, truncated: result.truncated };
}

/** Complete patches from the initial read, by path; a truncated read drops its last, possibly partial, file. */
export function seedFiles(ready: ReadyResult | undefined): ReadonlyMap<string, DiffFile> {
  const parsed = ready ? parseUnifiedDiff(ready.diff) : [];
  if (ready?.truncated) parsed.pop();
  return new Map(parsed.map(file => [file.path, file]));
}

export const isLarge = (file: DiffFile) => lineCount(file) > LARGE_FILE_LINES;

/** Which files the reader has folded or opened. Collapsed paths persist across refreshes so a reader
 * keeps their place; a file without a seeded patch, or a large one, stays closed until opened.
 */
export interface Disclosure { collapsed: ReadonlySet<string>; opened: ReadonlySet<string> }
export const initialDisclosure: Disclosure = { collapsed: new Set(), opened: new Set() };

export function isOpen(state: Disclosure, path: string, seed: ReadonlyMap<string, DiffFile>): boolean {
  if (state.collapsed.has(path)) return false;
  const seeded = seed.get(path);
  return (seeded !== undefined && !isLarge(seeded)) || state.opened.has(path);
}

export function setOpen(state: Disclosure, path: string, open: boolean): Disclosure {
  const collapsed = new Set(state.collapsed);
  if (open) collapsed.delete(path); else collapsed.add(path);
  return { collapsed, opened: open ? new Set(state.opened).add(path) : state.opened };
}

export const allCollapsed = (state: Disclosure, files: readonly ChangeFile[], seed: ReadonlyMap<string, DiffFile>) =>
  files.length > 0 && files.every(f => !isOpen(state, f.path, seed));

/** Expand all when every file is closed (large and unseeded ones included); otherwise collapse all. */
export function toggleAll(state: Disclosure, files: readonly ChangeFile[], seed: ReadonlyMap<string, DiffFile>): Disclosure {
  const paths = files.map(f => f.path);
  return allCollapsed(state, files, seed) ? { collapsed: new Set(), opened: new Set(paths) } : { collapsed: new Set(paths), opened: state.opened };
}

/** The header status: counts for a ready read, otherwise loading or unavailable. */
export function summary(result: WorkspaceChanges["result"] | undefined, failed: boolean): string {
  if (result?.status !== "ready") return failed || result ? "Changes unavailable" : "Loading…";
  const { files } = result;
  if (files.length === 0) return "no changes";
  const additions = files.reduce((n, f) => n + f.additions, 0), deletions = files.reduce((n, f) => n + f.deletions, 0);
  return `${files.length} ${files.length === 1 ? "file" : "files"} · +${additions} −${deletions}`;
}

/** The status line inside an open file, if any: read failure, loading, not yet read, or partial patch. */
export function fileMessage({ error, busy, loaded }: { error?: string; busy: boolean; loaded?: Pick<LoadedFile, "truncated"> }): string | undefined {
  if (error) return error;
  if (!loaded) return busy ? "Loading fresh patch…" : "Expand to load patch";
  return loaded.truncated ? `Partial patch: exceeds the ${FILE_PATCH_LIMIT} per-file limit. Inspect the remainder locally.` : undefined;
}

const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/** Composer text asking about one file's live diff, framed so it is not mistaken for a revision. */
export const askText = ({ file, observedAt, truncated }: LoadedFile) =>
  `About \`${file.path}\` (live working-tree diff inspected at ${clock(observedAt)}; ${truncated ? "partial patch, not the complete file" : "not an immutable revision"}):\n\n\`\`\`diff\n${file.raw}\`\`\`\n`;
