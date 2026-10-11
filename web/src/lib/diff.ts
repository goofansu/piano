/** Parse no-renames Git unified patches with a/ and b/ path prefixes.
 * Live previews can be truncated: parsed counts describe only the supplied patch;
 * callers use numstat metadata for full-file totals and track truncation separately.
 * Unknown header lines are kept as notes.
 */

export type DiffLineKind = "context" | "add" | "del" | "meta";
export interface DiffLine { kind: DiffLineKind; text: string; old?: number; new?: number }
export interface DiffHunk { header: string; lines: DiffLine[] }
export interface DiffFile {
  path: string;
  status: "added" | "deleted" | "modified";
  binary: boolean;
  /** Mode changes and other header facts worth a glance, e.g. "100644 → 100755". */
  notes: string[];
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
  /** The supplied diff text for this file, possibly partial; not a completeness guarantee. */
  raw: string;
}

/** Git quotes paths with control or non-ASCII bytes as C strings (core.quotePath). */
export function unquotePath(value: string): string {
  if (!value.startsWith('"') || !value.endsWith('"')) return value;
  const bytes: number[] = [];
  const inner = value.slice(1, -1);
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (c !== "\\") { bytes.push(...new TextEncoder().encode(c)); continue; }
    const next = inner[++i];
    const simple: Record<string, number> = { n: 10, t: 9, r: 13, b: 8, f: 12, v: 11, a: 7, "\\": 92, '"': 34 };
    if (next in simple) bytes.push(simple[next]);
    else if (/[0-7]/.test(next)) {
      let octal = next;
      while (octal.length < 3 && /[0-7]/.test(inner[i + 1] ?? "")) octal += inner[++i];
      bytes.push(parseInt(octal, 8));
    } else bytes.push(...new TextEncoder().encode(next));
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

/** Headers use `a/P b/P`; no-index directory diffs can repeat a side (`b/P b/P`).
 * Strip exactly one prefix, preserving repository paths that themselves start with `a/`.
 */
function pathFromHeader(rest: string): string {
  let left: string, right: string;
  if (rest.startsWith('"')) {
    let end = 1;
    while (end < rest.length && rest[end] !== '"') end += rest[end] === "\\" ? 2 : 1;
    left = unquotePath(rest.slice(0, end + 1)); right = unquotePath(rest.slice(end + 2));
  } else {
    const width = (rest.length - 1) / 2;
    left = rest.slice(0, width); right = rest.slice(width + 1);
  }
  return (right.length === left.length ? right : left).slice(2);
}

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;

export function parseUnifiedDiff(text: string): DiffFile[] {
  const files: DiffFile[] = [];
  if (!text.trim()) return files;
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  let file: DiffFile | undefined, hunk: DiffHunk | undefined, oldLine = 0, newLine = 0, start = 0;
  const finish = (end: number) => { if (file) { file.raw = lines.slice(start, end).join("\n") + "\n"; files.push(file); } };
  lines.forEach((line, index) => {
    if (line.startsWith("diff --git ")) {
      finish(index); start = index; hunk = undefined;
      file = { path: pathFromHeader(line.slice("diff --git ".length)), status: "modified", binary: false, notes: [], hunks: [], additions: 0, deletions: 0, raw: "" };
      return;
    }
    if (!file) return;
    const match = HUNK.exec(line);
    if (match) {
      oldLine = Number(match[1]); newLine = Number(match[3]);
      hunk = { header: line, lines: [] };
      file.hunks.push(hunk);
      return;
    }
    if (hunk) {
      const mark = line[0], text = line.slice(1);
      if (mark === " ") hunk.lines.push({ kind: "context", text, old: oldLine++, new: newLine++ });
      else if (mark === "+") { hunk.lines.push({ kind: "add", text, new: newLine++ }); file.additions++; }
      else if (mark === "-") { hunk.lines.push({ kind: "del", text, old: oldLine++ }); file.deletions++; }
      else if (mark === "\\") hunk.lines.push({ kind: "meta", text: line.slice(2) });
      else hunk = undefined; // Header of the next section within the same file (not expected without renames).
      if (hunk) return;
    }
    if (line.startsWith("new file mode")) file.status = "added";
    else if (line.startsWith("deleted file mode")) file.status = "deleted";
    else if (line.startsWith("Binary files")) file.binary = true;
    else if (line.startsWith("old mode ")) file.notes.push(`${line.slice("old mode ".length)} →`);
    else if (line.startsWith("new mode ") && file.notes.at(-1)?.endsWith("→")) file.notes[file.notes.length - 1] += ` ${line.slice("new mode ".length)}`;
    else if (line.startsWith("--- ") || line.startsWith("+++ ") || line.startsWith("index ")) return;
  });
  finish(lines.length);
  return files;
}

/** Rendered rows across a file's hunks: context, additions, deletions and "\ No newline" marks. */
export const lineCount = (file: DiffFile) => file.hunks.reduce((n, h) => n + h.lines.length, 0);
