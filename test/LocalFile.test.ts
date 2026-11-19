import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFile, mkdtemp, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { LocalFileRefusal, openLocalFile, readLocalFile } from "../server/LocalFile.ts";

const refusal = (reason: string) => (error: unknown) =>
  error instanceof LocalFileRefusal && error.reason === reason;

test(
  "a whole local file is read only while it is a regular file, within the limit and unchanged",
  { timeout: 10000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "piano-local-file-"));
    try {
      const path = join(root, "file.txt");
      await writeFile(path, "12345");
      assert.equal((await readLocalFile(path, { limit: 5 })).toString(), "12345");
      await assert.rejects(readLocalFile(path, { limit: 4 }), refusal("too-large"));
      await assert.rejects(
        readLocalFile(path, { limit: 5, signal: AbortSignal.abort() }),
        refusal("aborted"),
      );

      for (const [change, limit, reason] of [
        [() => appendFile(path, "6"), 10, "changed"],
        [() => appendFile(path, "6"), 5, "too-large"],
        [() => truncate(path, 3), 10, "changed"],
      ] as const) {
        await writeFile(path, "12345");
        const file = await openLocalFile(path);
        try {
          await change();
          await assert.rejects(file.whole(limit), refusal(reason));
        } finally {
          await file.close();
        }
      }

      const fifo = join(root, "pipe");
      execFileSync("mkfifo", [fifo]);
      await assert.rejects(readLocalFile(fifo, { limit: 5 }), refusal("not-file"));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
