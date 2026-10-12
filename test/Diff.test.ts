import assert from "node:assert/strict";
import { test } from "node:test";
import { parseUnifiedDiff, unquotePath } from "../web/src/lib/diff.ts";

const sample = [
  "diff --git a/src/app.ts b/src/app.ts",
  "index 1111111..2222222 100644",
  "--- a/src/app.ts",
  "+++ b/src/app.ts",
  "@@ -1,4 +1,5 @@",
  " import a;",
  "-old line",
  "+new line",
  "+another",
  " ",
  " tail",
  "\\ No newline at end of file",
  "diff --git b/added.md b/added.md",
  "new file mode 100644",
  "index 0000000..3333333",
  "--- /dev/null",
  "+++ b/added.md",
  "@@ -0,0 +1 @@",
  "+hello",
  "diff --git a/gone.txt a/gone.txt",
  "deleted file mode 100644",
  "index 4444444..0000000",
  "--- a/gone.txt",
  "+++ /dev/null",
  "@@ -1 +0,0 @@",
  "-bye",
  "diff --git a/logo.png b/logo.png",
  "index 5555555..6666666 100644",
  "Binary files a/logo.png and b/logo.png differ",
  "diff --git a/run.sh b/run.sh",
  "old mode 100644",
  "new mode 100755",
  'diff --git "b/new\\nsource.ts" "b/new\\nsource.ts"',
  "new file mode 100644",
  "index 0000000..7777777",
  "--- /dev/null",
  '+++ "b/new\\nsource.ts"',
  "@@ -0,0 +1 @@",
  "+untracked source",
  "",
].join("\n");

test("files, statuses, counts and numbered lines come from the capture's unified diff", () => {
  const files = parseUnifiedDiff(sample);
  assert.deepEqual(
    files.map((f) => [f.path, f.status, f.binary, f.additions, f.deletions]),
    [
      ["src/app.ts", "modified", false, 2, 1],
      ["added.md", "added", false, 1, 0],
      ["gone.txt", "deleted", false, 0, 1],
      ["logo.png", "modified", true, 0, 0],
      ["run.sh", "modified", false, 0, 0],
      ["new\nsource.ts", "added", false, 1, 0],
    ],
  );
  const [app] = files;
  assert.equal(app.hunks.length, 1);
  assert.equal(app.hunks[0].header, "@@ -1,4 +1,5 @@");
  assert.deepEqual(
    app.hunks[0].lines.map((l) => [l.kind, l.old ?? null, l.new ?? null, l.text]),
    [
      ["context", 1, 1, "import a;"],
      ["del", 2, null, "old line"],
      ["add", null, 2, "new line"],
      ["add", null, 3, "another"],
      ["context", 3, 4, ""],
      ["context", 4, 5, "tail"],
      ["meta", null, null, "No newline at end of file"],
    ],
  );
  assert.deepEqual(files[4].notes, ["100644 → 100755"]);
  assert.ok(
    app.raw.startsWith("diff --git a/src/app.ts") &&
      app.raw.endsWith("No newline at end of file\n"),
  );
  assert.ok(!app.raw.includes("added.md"));
  assert.ok(files[5].raw.endsWith("+untracked source\n"));
  assert.deepEqual(parseUnifiedDiff(""), []);
  assert.deepEqual(parseUnifiedDiff("\n"), []);
});

test("quoted paths decode Git's C escapes, including UTF-8 octal bytes", () => {
  assert.equal(unquotePath('"a/caf\\303\\251.txt"'), "a/café.txt");
  assert.equal(unquotePath('"tab\\there"'), "tab\there");
  assert.equal(unquotePath("plain/path.ts"), "plain/path.ts");
  assert.equal(
    parseUnifiedDiff('diff --git "a/caf\\303\\251.txt" "b/caf\\303\\251.txt"\n')[0].path,
    "café.txt",
  );
  assert.equal(
    parseUnifiedDiff("diff --git a/with space.txt b/with space.txt\n")[0].path,
    "with space.txt",
  );
  assert.equal(parseUnifiedDiff("diff --git a/a/x.ts b/a/x.ts\n")[0].path, "a/x.ts");
  assert.equal(parseUnifiedDiff("diff --git b/b/y.ts b/b/y.ts\n")[0].path, "b/y.ts");
});
