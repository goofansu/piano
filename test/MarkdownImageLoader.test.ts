import assert from "node:assert/strict";
import { test } from "node:test";
import type { FilePreview } from "../shared/files.ts";
import { markdownImageLoader, relativeToDocument } from "../web/src/lib/markdownImageLoader.ts";

const MiB = 1024 * 1024;

/** A workspace whose files are PNGs of the given sizes; each read waits until the test settles it. */
function workspace(sizes: Record<string, number>) {
  const reads: string[] = [];
  const signals: AbortSignal[] = [];
  const pending: Array<() => void> = [];
  const live = new Set<string>();
  const revoked: string[] = [];
  let next = 0;
  const loader = markdownImageLoader({
    read: (path, signal) => {
      reads.push(path);
      signals.push(signal);
      // Answers late even when aborted, as a reply already on the wire may.
      return new Promise<FilePreview>((resolve, reject) => {
        pending.push(() => {
          const size = sizes[path];
          if (size === undefined) reject(new Error("not found"));
          else
            resolve({
              workspaceId: "w",
              path,
              kind: "image",
              mime: "image/png",
              bytes: new Uint8Array(size),
            });
        });
      });
    },
    createUrl: () => {
      const url = `blob:${next++}`;
      live.add(url);
      return url;
    },
    revokeUrl: (url) => {
      live.delete(url);
      revoked.push(url);
    },
  });
  /** Answers every read until no read is waiting. */
  const settle = async () => {
    for (;;) {
      await new Promise((resolve) => setImmediate(resolve));
      const answer = pending.shift();
      if (!answer) return;
      answer();
    }
  };
  return { loader, reads, signals, live, revoked, settle };
}

test("an image added to growing prose loads alone; earlier images stay without a reread", async () => {
  const { loader, reads, revoked, settle } = workspace({ "a.png": 10, "b.png": 10 });
  const seen: Array<ReadonlyMap<string, string>> = [];
  loader.subscribe((images) => seen.push(images));
  loader.show(["a.png"]);
  await settle();
  const a = loader.images().get("a.png");
  assert.ok(a);
  loader.show(["a.png", "b.png"]);
  await settle();
  assert.deepEqual(reads, ["a.png", "b.png"]);
  assert.deepEqual(revoked, []);
  assert.equal(loader.images().get("a.png"), a);
  assert.ok(loader.images().get("b.png"));
  // a never left the shown images while b loaded.
  assert.ok(seen.every((images) => images.get("a.png") === a));
});

test("images load one after another, at most eight per prose, skipping other formats", async () => {
  const names = Array.from({ length: 10 }, (_, index) => `${index}.png`);
  const { loader, reads, settle } = workspace(Object.fromEntries(names.map((n) => [n, 1])));
  loader.show(["demo.mp4", ...names.slice(0, 5)]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(reads, ["0.png"]);
  loader.show(["demo.mp4", ...names]);
  await settle();
  assert.deepEqual(reads, names.slice(0, 8));
  assert.equal(loader.images().size, 8);
});

test("the read that crosses 20 MiB is dropped and nothing further is read", async () => {
  const { loader, reads, live, settle } = workspace({
    "a.png": 12 * MiB,
    "b.png": 9 * MiB,
    "c.png": 1,
  });
  loader.show(["a.png", "b.png", "c.png"]);
  await settle();
  assert.deepEqual([...loader.images().keys()], ["a.png"]);
  assert.equal(live.size, 1);
  loader.show(["a.png", "b.png", "c.png", "d.png"]);
  await settle();
  assert.deepEqual(reads, ["a.png", "b.png"]);
});

test("an unreadable image keeps its fallback without stopping later images", async () => {
  const { loader, reads, settle } = workspace({ "b.png": 1 });
  loader.show(["missing.png", "b.png"]);
  await settle();
  assert.deepEqual(reads, ["missing.png", "b.png"]);
  assert.deepEqual([...loader.images().keys()], ["b.png"]);
});

test("disposing an owner aborts its read and revokes every Blob URL it made", async () => {
  const first = workspace({ "a.png": 1, "b.png": 1 });
  first.loader.show(["a.png"]);
  await first.settle();
  first.loader.show(["a.png", "b.png"]);
  await new Promise((resolve) => setImmediate(resolve));
  first.loader.dispose();
  assert.ok(first.signals.every((signal) => signal.aborted));
  await first.settle();
  assert.equal(first.live.size, 0);
  assert.deepEqual(first.revoked, ["blob:0"]);
  // The next (workspace, document) owner reads afresh and shares no blob with the old one.
  const second = workspace({ "a.png": 1 });
  second.loader.show(["a.png"]);
  await second.settle();
  assert.deepEqual(second.reads, ["a.png"]);
  first.loader.show(["c.png"]);
  await first.settle();
  assert.deepEqual(first.reads, ["a.png", "b.png"]);
  assert.equal(first.live.size, 0);
});

test("a Markdown file resolves relative images from its own directory", () => {
  assert.equal(relativeToDocument("docs/guide.md", "shots/a.png"), "docs/shots/a.png");
  assert.equal(relativeToDocument("", "a.png"), "a.png");
  assert.equal(relativeToDocument("docs/guide.md", "/tmp/a.png"), "/tmp/a.png");
});
