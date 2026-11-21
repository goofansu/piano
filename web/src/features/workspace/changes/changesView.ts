import type {
  ChangeFile,
  ChangesScope,
  Comparison,
  ComparisonTarget,
  LocalWork,
  RenderMsg,
  ScopeAvailability,
  SessionPullRequestLink,
  Workspace,
  WorkspaceChanges,
} from "@shared/wire";
import { pullRequestBranchesKey } from "../../../../../shared/features/workspace/pull-requests/pullRequestBranches.ts";
import { CHANGES_FILE_PATCH_BYTES } from "../../../../../shared/wire.ts";
import { type DiffFile, lineCount, parseUnifiedDiff } from "./diff.ts";

export type ReadyResult = Extract<WorkspaceChanges["result"], { status: "ready" }>;
export type UnavailableResult = Extract<WorkspaceChanges["result"], { status: "unavailable" }>;
export type ReadyChanges = WorkspaceChanges & { result: ReadyResult };
export type ShownChanges = WorkspaceChanges & { result: ReadyResult | UnavailableResult };

const SCOPE_NAMES: Record<ChangesScope, string> = {
  branch: "Base branch",
  uncommitted: "Uncommitted",
};
const SCOPE_ORDER: ChangesScope[] = ["uncommitted", "branch"];

function scopeLabel({ scope, target }: { scope: ChangesScope; target?: ComparisonTarget }): string {
  if (scope !== "branch" || !target) return SCOPE_NAMES[scope];
  return target.ref.replace(/^refs\/(heads|remotes)\//, "");
}

export interface ScopeOption {
  scope: ChangesScope;
  name: string;
  available: boolean;
}

export interface ScopeView {
  current: ChangesScope;
  label: string;
  options: ScopeOption[];
}

function scopeOption(availability: ScopeAvailability): ScopeOption {
  const { scope, available } = availability;
  return { scope, name: scopeLabel(availability), available };
}

function scopeView(result: ReadyResult | UnavailableResult): ScopeView {
  const current = result.status === "ready" ? result.comparison.scope : result.scope;
  const options = SCOPE_ORDER.map((scope) =>
    scopeOption(
      result.scopes.find((s) => s.scope === scope) ?? {
        scope,
        available: false,
        reason: "Unavailable",
      },
    ),
  );
  return {
    current,
    label:
      result.status === "ready"
        ? scopeLabel(result.comparison)
        : options.find((option) => option.scope === current)!.name,
    options,
  };
}

export const LARGE_FILE_LINES = 800;
export const FILE_PATCH_LIMIT = `${CHANGES_FILE_PATCH_BYTES / (1024 * 1024)} MiB`;

const EDITING_TOOLS = new Set(["edit", "write", "bash"]);

export function refreshKey(
  session: {
    messages: readonly Pick<RenderMsg, "id" | "role" | "toolName">[];
    state: { isStreaming: boolean };
  } | null,
): string {
  if (!session) return "";
  const streaming = session.state.isStreaming ? 1 : 0;
  for (let i = session.messages.length - 1; i >= 0; i--) {
    const m = session.messages[i];
    if (m.role === "tool_result" && m.toolName && EDITING_TOOLS.has(m.toolName))
      return `${m.id}|${streaming}`;
  }
  return `none|${streaming}`;
}

export function pullRequestTrigger(link: SessionPullRequestLink | null | undefined): string {
  return link ? pullRequestBranchesKey(link) : "";
}

export function localWorkFacts(local: LocalWork | undefined): string[] {
  const commits = local?.commitsNotPushed ?? 0;
  return [
    ...(commits > 0 ? [`${commits} ${commits === 1 ? "commit" : "commits"} not pushed`] : []),
    ...(local?.uncommitted ? ["Edits not committed"] : []),
  ];
}

export function checkWorkspaceResponse(
  expected: Pick<Workspace, "id" | "path">,
  value: WorkspaceChanges,
  mismatch = "Changes returned a different workspace. Refresh before inspecting changes.",
): ShownChanges {
  if (value.workspace.id !== expected.id || value.workspace.path !== expected.path)
    throw new Error(mismatch);
  if (value.result.status === "error") throw new Error(value.result.detail);
  return value as ShownChanges;
}

export const CHANGES_MOVED = "Changes moved. Refresh changes.";

export interface LoadedFile {
  file: DiffFile;
  observedAt: string;
  truncated: boolean;
  source: PatchSource;
}

export type PatchSource = "working-tree" | "index";
export const patchSource = (stats: Pick<ChangeFile, "staged">): PatchSource =>
  stats.staged ? "index" : "working-tree";
export const patchNote = ({ source }: Pick<LoadedFile, "source">) =>
  source === "index" ? "Staged changes" : undefined;

export function changedFile(
  expected: Pick<Workspace, "id" | "path">,
  value: WorkspaceChanges,
  path: string,
  comparison?: Pick<Comparison, "scope" | "base">,
): LoadedFile {
  const { result, observedAt } = checkWorkspaceResponse(
    expected,
    value,
    "File response belongs to another workspace.",
  );
  if (result.status !== "ready") throw new Error(CHANGES_MOVED);
  if (
    comparison &&
    (result.comparison.scope !== comparison.scope || result.comparison.base !== comparison.base)
  )
    throw new Error(CHANGES_MOVED);
  const loaded = loadedPatches(result, observedAt, { dropTruncatedLast: false }).get(path);
  if (loaded) return loaded;
  if (!result.files.some((f) => f.path === path))
    throw new Error("File metadata is unavailable. Refresh changes.");
  throw new Error(
    result.truncated
      ? `Patch is too large to display a complete line (${FILE_PATCH_LIMIT} limit).`
      : "File changed or no longer has a diff. Refresh changes.",
  );
}

function loadedPatches(
  ready: ReadyResult,
  observedAt: string,
  { dropTruncatedLast }: { dropTruncatedLast: boolean },
): Map<string, LoadedFile> {
  const parsed = parseUnifiedDiff(ready.diff);
  if (ready.truncated && dropTruncatedLast) parsed.pop();
  const truncated = ready.truncated && !dropTruncatedLast;
  const stats = new Map(ready.files.map((f) => [f.path, f]));
  const loaded = new Map<string, LoadedFile>();
  for (const file of parsed) {
    const metadata = stats.get(file.path);
    if (metadata && !loaded.has(file.path))
      loaded.set(file.path, {
        file: { ...file, ...metadata },
        observedAt,
        truncated,
        source: patchSource(metadata),
      });
  }
  return loaded;
}

const seeds = new WeakMap<ReadyResult, ReadonlyMap<string, LoadedFile>>();
function seedFiles(ready: ReadyResult, observedAt: string): ReadonlyMap<string, LoadedFile> {
  let seed = seeds.get(ready);
  if (!seed) {
    seed = loadedPatches(ready, observedAt, { dropTruncatedLast: true });
    seeds.set(ready, seed);
  }
  return seed;
}

export const isLarge = (file: DiffFile) => lineCount(file) > LARGE_FILE_LINES;

export interface Disclosure {
  collapsed: ReadonlySet<string>;
  opened: ReadonlySet<string>;
}
export const initialDisclosure: Disclosure = { collapsed: new Set(), opened: new Set() };

export interface SheetFile {
  metadata: ChangeFile;
  initial?: LoadedFile;
  open: boolean;
}

export type SheetBody =
  | { kind: "idle" }
  | { kind: "reading" }
  | { kind: "failed"; title?: string; detail: string }
  | { kind: "empty" }
  | { kind: "files"; changes: ReadyChanges; files: SheetFile[] };

export interface ChangesSheetView {
  changes?: ReadyChanges;
  scope?: ScopeView;
  pullRequestFromBranch?: boolean;
  local?: LocalWork;
  refreshing: boolean;
  staleNote?: { text: string; detail: string };
  body: SheetBody;
  everyCollapsed: boolean;
}

const isOpen = (state: Disclosure, path: string, seed: ReadonlyMap<string, LoadedFile>) => {
  if (state.collapsed.has(path)) return false;
  const seeded = seed.get(path);
  return (seeded !== undefined && !isLarge(seeded.file)) || state.opened.has(path);
};

export function changesSheet({
  observation,
  error,
  busy,
  disclosure,
}: {
  observation: WorkspaceChanges | null;
  error?: string;
  busy: boolean;
  disclosure: Disclosure;
}): ChangesSheetView {
  const result = observation?.result;
  if (observation && result?.status === "ready") {
    const seed = seedFiles(result, observation.observedAt);
    const files = result.files.map((metadata) => ({
      metadata,
      initial: seed.get(metadata.path),
      open: isOpen(disclosure, metadata.path, seed),
    }));
    const changes = observation as ReadyChanges;
    return {
      changes,
      scope: scopeView(result),
      pullRequestFromBranch: result.pullRequestFromBranch,
      local: result.local,
      refreshing: busy,
      staleNote: error
        ? { text: "Refresh failed. Showing previous changes.", detail: error }
        : undefined,
      body: files.length > 0 ? { kind: "files", changes, files } : { kind: "empty" },
      everyCollapsed: files.length > 0 && files.every((f) => !f.open),
    };
  }
  if (observation && result?.status === "unavailable") {
    return {
      scope: scopeView(result),
      pullRequestFromBranch: result.pullRequestFromBranch,
      local: result.local,
      refreshing: busy,
      staleNote: error
        ? { text: "Refresh failed. Showing previous changes.", detail: error }
        : undefined,
      body: {
        kind: "failed",
        title: `${SCOPE_NAMES[result.scope]} unavailable`,
        detail: result.detail,
      },
      everyCollapsed: false,
    };
  }
  const detail = error ?? (result?.status === "error" ? result.detail : undefined);
  const body: SheetBody =
    detail !== undefined
      ? { kind: "failed", detail }
      : busy
        ? { kind: "reading" }
        : { kind: "idle" };
  return { refreshing: false, body, everyCollapsed: false };
}

export function toggleFile(state: Disclosure, path: string, open: boolean): Disclosure {
  const collapsed = new Set(state.collapsed);
  if (open) collapsed.delete(path);
  else collapsed.add(path);
  return { collapsed, opened: open ? new Set(state.opened).add(path) : state.opened };
}

export function toggleEvery(state: Disclosure, sheet: ChangesSheetView): Disclosure {
  if (sheet.body.kind !== "files") return state;
  const paths = sheet.body.files.map((f) => f.metadata.path);
  return sheet.everyCollapsed
    ? { collapsed: new Set(), opened: new Set(paths) }
    : { collapsed: new Set(paths), opened: state.opened };
}

export function fileMessage({
  error,
  busy,
  loaded,
}: {
  error?: string;
  busy: boolean;
  loaded?: Pick<LoadedFile, "truncated">;
}): string | undefined {
  if (error) return error;
  if (!loaded) return busy ? "Loading fresh patch…" : "Expand to load patch";
  return loaded.truncated
    ? `Partial patch: exceeds the ${FILE_PATCH_LIMIT} per-file limit. Inspect the remainder locally.`
    : undefined;
}

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

const SOURCE_NAMES: Record<PatchSource, string> = {
  "working-tree": "live working-tree diff",
  index: "staged diff from the index,",
};

export const askText = ({ file, observedAt, truncated, source }: LoadedFile) =>
  `About \`${file.path}\` (${SOURCE_NAMES[source]} inspected at ${clock(observedAt)}; ${truncated ? "partial patch, not the complete file" : "not an immutable revision"}):\n\n\`\`\`diff\n${file.raw}\`\`\`\n`;
