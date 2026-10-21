import assert from "node:assert/strict";
import { test } from "node:test";
import { projectDisplay } from "../server/DisplayProjection.ts";

test("a written file's path and placed name leave verbatim; display text under any other key is redacted", () => {
  const token = "token=abc12345";
  const projected = projectDisplay({
    files: [{ path: `notes/${token}.md`, verdict: "missing", placed: `notes/${token}.md` }],
    // Key names a Files observation once used for paths are not identities on their own.
    missing: `retry with ${token}`,
    ignored: [`retry with ${token}`],
  });
  assert.deepEqual(projected.files, [
    { path: `notes/${token}.md`, verdict: "missing", placed: `notes/${token}.md` },
  ]);
  assert.doesNotMatch(projected.missing, /abc12345/);
  assert.doesNotMatch(projected.ignored[0]!, /abc12345/);
});
