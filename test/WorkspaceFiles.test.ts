import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Effect } from "effect";
import { readWorkspaceFile } from "../server/WorkspaceFiles.ts";

test("workspace file reads are bounded and never fall back to a neighboring workspace", async () => {
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
    assert.deepEqual(await read("readme.txt"), {
      workspaceId: "a",
      path: "readme.txt",
      kind: "text",
      language: "",
      content: "workspace A\n",
    });
    assert.equal(
      ((await read(join(a, "readme.txt"))) as { content: string }).content,
      "workspace A\n",
    );
    assert.equal(((await read("inside")) as { content: string }).content, "workspace A\n");
    assert.equal(((await read("empty")) as { content: string }).content, "");
    for (const path of ["../b/readme.txt", join(b, "readme.txt"), "outside"])
      await assert.rejects(read(path), /inside this workspace/);
    for (const path of ["binary", "invalid-utf8"]) await assert.rejects(read(path), /UTF-8 text/);
    await assert.rejects(read("large"), /too large/);
    await assert.rejects(read("."), /regular file/);
    await assert.rejects(read("missing"), /Check the path and read permissions/);

    for (const [name, kind, language] of [
      ["guide.MD", "markdown", "markdown"],
      ["main.tsx", "text", "tsx"],
      ["Dockerfile", "text", "dockerfile"],
      ["settings.yml", "text", "yaml"],
      ["data.json", "text", "json"],
      ["output.log", "text", ""],
      ["image.svg", "text", "xml"],
      ["index.html", "text", "html"],
    ]) {
      const content = name.endsWith("svg") ? "<svg><script>alert(1)</script></svg>" : "source\n";
      await writeFile(join(a, name), content);
      assert.deepEqual(await read(name), { workspaceId: "a", path: name, kind, language, content });
    }
    await writeFile(join(a, "fake.png"), "not an image");
    await assert.rejects(read("fake.png"), /malformed/);
    // PNG bytes, not the extension, establish the binary type. The binary payload is lossless.
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
      "base64",
    );
    await writeFile(join(a, "image.txt"), png);
    const image = await read("image.txt");
    assert.equal(image.kind, "image");
    assert.ok("bytes" in image);
    assert.equal(image.mime, "image/png");
    assert.deepEqual(image.bytes, png);
    await symlink(join(b, "readme.txt"), join(a, "escaped.png"));
    await assert.rejects(read("escaped.png"), /inside this workspace/);
    await truncate(join(a, "image.txt"), 10 * 1024 * 1024 + 1);
    await assert.rejects(read("image.txt"), /image file up to 10 MiB/);
    await writeFile(join(a, "large.pdf"), "%PDF-1.7\n");
    await truncate(join(a, "large.pdf"), 20 * 1024 * 1024 + 1);
    await assert.rejects(read("large.pdf"), /pdf file up to 20 MiB/);
    await writeFile(
      join(a, "program.md"),
      Buffer.from([0x7f, 0x45, 0x4c, 0x46, ...new Array(100).fill(0)]),
    );
    await assert.rejects(read("program.md"), /not supported/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
