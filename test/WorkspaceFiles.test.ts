import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Effect } from "effect";
import { readWorkspaceFile } from "../server/WorkspaceFiles.ts";

test("workspace file reads are bounded text-only and never fall back to a neighboring workspace", async () => {
  const root = await mkdtemp(join(tmpdir(), "piano-files-"));
  try {
    const a = join(root, "a"),
      b = join(root, "b");
    await mkdir(a);
    await mkdir(b);
    const workspace = { id: "a", folder: a, path: a };
    await writeFile(join(a, "readme.txt"), "workspace A\n");
    await writeFile(join(b, "readme.txt"), "workspace B\n");
    await writeFile(join(a, "empty"), "");
    await writeFile(join(a, "binary"), Buffer.from([0, 1, 2]));
    await writeFile(join(a, "invalid-utf8"), Buffer.from([255]));
    await writeFile(join(a, "large"), "a".repeat(1024 * 1024 + 1));
    await symlink(join(b, "readme.txt"), join(a, "outside"));
    await symlink(join(a, "readme.txt"), join(a, "inside"));
    const read = (path: string) =>
      Effect.runPromise(
        readWorkspaceFile(workspace, path).pipe(
          Effect.mapError((error) => new Error(error.detail)),
        ),
      );
    assert.deepEqual(await read("readme.txt"), { path: "readme.txt", content: "workspace A\n" });
    assert.equal((await read(join(a, "readme.txt"))).content, "workspace A\n");
    assert.equal((await read("inside")).content, "workspace A\n");
    assert.equal((await read("empty")).content, "");
    for (const path of ["../b/readme.txt", join(b, "readme.txt"), "outside"])
      await assert.rejects(read(path), /inside this workspace/);
    for (const path of ["binary", "invalid-utf8"]) await assert.rejects(read(path), /UTF-8 text/);
    await assert.rejects(read("large"), /too large/);
    await assert.rejects(read("."), /regular text file/);
    await assert.rejects(read("missing"), /Check the path and read permissions/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
