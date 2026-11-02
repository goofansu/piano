/**
 * A line diff of two texts in the Changes view's shape (`DiffFile`), for a proposal that replaces a
 * saved skill or prompt. Both texts are bounded by the draft rule, so a plain LCS over the lines
 * between the common head and tail is cheap; past `CELLS` the middle reads as replaced whole.
 */
import type { DiffFile, DiffHunk, DiffLine } from "./diff.ts";

const CONTEXT = 3;
const CELLS = 4_000_000;

const linesOf = (text: string) => {
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
};

/** Every line of both texts in order, each kept, removed or added, numbered on its side(s). */
function edits(before: string[], after: string[]): DiffLine[] {
  let head = 0;
  while (head < before.length && head < after.length && before[head] === after[head]) head++;
  let tail = 0;
  while (
    tail < before.length - head &&
    tail < after.length - head &&
    before[before.length - 1 - tail] === after[after.length - 1 - tail]
  )
    tail++;
  const a = before.slice(head, before.length - tail);
  const b = after.slice(head, after.length - tail);
  const middle: Array<{ kind: "context" | "add" | "del"; text: string }> = [];
  if (a.length * b.length <= CELLS) {
    // lcs[i][j]: the longest common run of a[i..] and b[j..].
    const width = b.length + 1;
    const lcs = new Uint32Array((a.length + 1) * width);
    for (let i = a.length - 1; i >= 0; i--)
      for (let j = b.length - 1; j >= 0; j--)
        lcs[i * width + j] =
          a[i] === b[j]
            ? lcs[(i + 1) * width + j + 1] + 1
            : Math.max(lcs[(i + 1) * width + j], lcs[i * width + j + 1]);
    let i = 0;
    let j = 0;
    while (i < a.length || j < b.length) {
      if (i < a.length && j < b.length && a[i] === b[j]) {
        middle.push({ kind: "context", text: a[i++] });
        j++;
      } else if (
        j < b.length &&
        (i === a.length || lcs[i * width + j + 1] >= lcs[(i + 1) * width + j])
      )
        middle.push({ kind: "add", text: b[j++] });
      else middle.push({ kind: "del", text: a[i++] });
    }
  } else {
    for (const text of a) middle.push({ kind: "del", text });
    for (const text of b) middle.push({ kind: "add", text });
  }
  const all = [
    ...before.slice(0, head).map((text) => ({ kind: "context" as const, text })),
    ...middle,
    ...before.slice(before.length - tail).map((text) => ({ kind: "context" as const, text })),
  ];
  let old = 1;
  let next = 1;
  return all.map(({ kind, text }) =>
    kind === "context"
      ? { kind, text, old: old++, new: next++ }
      : kind === "del"
        ? { kind, text, old: old++ }
        : { kind, text, new: next++ },
  );
}

/** `previous` → `next` as one file's hunks, `CONTEXT` lines around each change. */
export function lineDiff(path: string, previous: string, next: string): DiffFile {
  const lines = edits(linesOf(previous), linesOf(next));
  const hunks: DiffHunk[] = [];
  let i = 0;
  while (i < lines.length) {
    if (lines[i].kind === "context") {
      i++;
      continue;
    }
    const start = Math.max(0, i - CONTEXT);
    let end = i;
    // Extend over changes separated by at most twice the context.
    while (end < lines.length) {
      let gap = end;
      while (gap < lines.length && lines[gap].kind === "context") gap++;
      if (gap === lines.length || gap - end > 2 * CONTEXT) {
        end = Math.min(lines.length, end + CONTEXT);
        break;
      }
      end = gap + 1;
    }
    const slice = lines.slice(start, end);
    const first = slice[0];
    const oldStart = first.old ?? slice.find((l) => l.old)?.old ?? 0;
    const newStart = first.new ?? slice.find((l) => l.new)?.new ?? 0;
    const oldCount = slice.filter((l) => l.kind !== "add").length;
    const newCount = slice.filter((l) => l.kind !== "del").length;
    hunks.push({ header: `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`, lines: slice });
    i = end;
  }
  const additions = lines.filter((l) => l.kind === "add").length;
  const deletions = lines.filter((l) => l.kind === "del").length;
  return {
    path,
    status: "modified",
    binary: false,
    notes: [],
    hunks,
    additions,
    deletions,
    raw: "",
  };
}
