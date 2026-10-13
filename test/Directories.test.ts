import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { Effect } from "effect";
import { Directories } from "../server/Directories.ts";

const root = realpathSync(mkdtempSync(join(tmpdir(), "piano-directories-")));
after(() => rmSync(root, { recursive: true, force: true }));

const detail = (raw: string) =>
  Effect.runPromise(
    Directories.list(raw).pipe(
      Effect.flip,
      Effect.map((error) => error.detail),
    ),
  );

test("folder listing follows directory links, skips hidden/files/broken links, sorts names and preserves errors", async () => {
  const path = join(root, "listing");
  mkdirSync(path);
  for (const name of ["zebra", "Alpha", ".hidden"]) mkdirSync(join(path, name));
  writeFileSync(join(path, "file"), "text");
  symlinkSync(join(path, "Alpha"), join(path, "link"));
  symlinkSync(join(path, "missing"), join(path, "broken"));
  const listing = await Effect.runPromise(Directories.list(path));
  assert.equal(listing.path, path);
  assert.equal(listing.parent, root);
  assert.deepEqual(
    listing.entries.map((entry) => entry.name),
    ["Alpha", "link", "zebra"],
  );
  assert.equal(await detail(join(path, "missing")), `No such directory: ${path}/missing`);
  assert.equal(await detail(join(path, "file")), `${path}/file is a file, not a directory`);
});
