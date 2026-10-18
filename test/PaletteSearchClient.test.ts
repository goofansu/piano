import assert from "node:assert/strict";
import { test } from "node:test";
import type { PaletteGroup } from "../web/src/lib/commandPalette.ts";
import {
  createPaletteSearch,
  type PalettePage,
  type PaletteSearchReply,
  type PaletteSearchRequest,
} from "../web/src/lib/paletteSearch.ts";
import {
  createPaletteSearchClient,
  type PaletteSearchWorker,
} from "../web/src/lib/paletteSearchClient.ts";

/** Real ranking and structured copies, with only worker scheduling/failure under test control. */
class ControlledWorker implements PaletteSearchWorker {
  readonly requests: PaletteSearchRequest[] = [];
  readonly replies: PaletteSearchReply[] = [];
  readonly listeners = new Map<string, (event: { data: PaletteSearchReply }) => void>();
  readonly rank = createPaletteSearch();
  terminated = 0;
  throwOnPost = false;
  addEventListener(type: string, listener: (event: { data: PaletteSearchReply }) => void) {
    this.listeners.set(type, listener);
  }
  postMessage(request: PaletteSearchRequest) {
    if (this.throwOnPost) throw new Error("worker unavailable");
    const copy = structuredClone(request);
    this.requests.push(copy);
    this.replies.push(structuredClone(this.rank(copy)));
  }
  deliver(reply = this.replies.shift()!) {
    this.listeners.get("message")!({ data: reply });
  }
  fail(type: "error" | "messageerror") {
    this.listeners.get(type)!({ data: { id: -1, pages: [] } });
  }
  terminate() {
    this.terminated++;
  }
}

const catalog = (prefix: string, count = 1): PaletteGroup[] => [
  {
    id: "files",
    heading: "Files",
    rows: Array.from({ length: count }, (_, i) => ({
      key: `${prefix}-${i}`,
      value: `${prefix}-${i}`,
      keywords: ["!files"],
      name: `${prefix}-${i}`,
      dir: "src",
      file: { path: `src/${prefix}-${i}` },
    })),
  },
];

function fixture() {
  const worker = new ControlledWorker();
  let failures = 0;
  const client = createPaletteSearchClient(
    () => worker,
    () => failures++,
  );
  const received: PalettePage[][] = [];
  const accept = (pages: PalettePage[]) => received.push(pages);
  return { worker, client, received, accept, failures: () => failures };
}

test("search coalesces queued queries and delivers only the latest catalog's original rows", () => {
  const { client, worker, received, accept } = fixture();
  client.search(catalog("old"), "!files", {}, accept);
  for (let i = 0; i < 50; i++) client.search(catalog(`skipped-${i}`), "!files", {}, accept);
  const latest = catalog("latest");
  client.search(latest, "latest", {}, accept);
  assert.equal(worker.requests.length, 1, "only one scan may be in flight");
  worker.deliver();
  assert.equal(received.length, 0, "an obsolete reply never reaches the caller");
  assert.equal(worker.requests.length, 2, "only the latest queued scan is sent");
  assert.equal(worker.requests[1].query, "latest");
  worker.deliver();
  assert.equal(received.length, 1);
  assert.equal(
    received[0][0].group.rows[0],
    latest[0].rows[0],
    "retain action and display metadata",
  );
  client.dispose();
});

test("paging reuses the worker catalog but a refresh replaces it even for the same query", () => {
  const { client, worker, received, accept } = fixture();
  const groups = catalog("file", 51);
  client.search(groups, "!files", {}, accept);
  worker.deliver();
  assert.equal(received[0][0].group.rows.length, 50);
  client.search(groups, "!files", { files: 1 }, accept);
  assert.equal(worker.requests[1].groups, undefined, "paging must not retransmit the catalog");
  worker.deliver();
  assert.equal(received[1][0].group.rows[0], groups[0].rows[50]);
  const refreshed = catalog("replacement");
  client.search(refreshed, "!files", { files: 1 }, accept);
  worker.deliver();
  assert.equal(received[2][0].page, 0, "a shrunken catalog clamps the page");
  assert.equal(received[2][0].total, 1);
  assert.equal(received[2][0].group.rows[0], refreshed[0].rows[0]);
  client.dispose();
});

test("cancel discards queued work without releasing the active scan's backpressure slot", () => {
  const { client, worker, received, accept } = fixture();
  const groups = catalog("file");
  client.search(groups, "file", {}, accept);
  client.search(groups, "discard", {}, accept);
  client.cancel();
  client.search(groups, "!files", {}, accept);
  assert.equal(worker.requests.length, 1);
  worker.deliver();
  assert.deepEqual(received, []);
  assert.equal(worker.requests.length, 2);
  assert.equal(worker.requests[1].query, "!files");
  client.cancel();
  worker.deliver();
  assert.deepEqual(received, []);
  assert.equal(worker.requests.length, 2, "cancel must not leave queued work");
  client.search(groups, "file", {}, accept);
  worker.deliver();
  assert.equal(received.length, 1, "search remains usable after cancellation");
  client.dispose();
});

test("duplicate or unrelated replies cannot release a newer scan or its queued work", () => {
  const { client, worker, received, accept } = fixture();
  const groups = catalog("file");
  client.search(groups, "file", {}, accept);
  const first = worker.replies[0];
  worker.deliver();
  client.search(groups, "!files", {}, accept);
  client.search(groups, "latest", {}, accept);
  worker.deliver(first);
  assert.equal(worker.requests.length, 2);
  assert.equal(received.length, 1);
  worker.deliver();
  assert.equal(worker.requests.length, 3);
  worker.deliver();
  assert.deepEqual(received[1], []);
  client.dispose();
});

for (const ending of ["error", "messageerror", "post", "dispose"] as const) {
  test(`${ending} ends search delivery, queued work and future submissions`, () => {
    const { client, worker, received, accept, failures } = fixture();
    const groups = catalog("file");
    client.search(groups, "file", {}, accept);
    client.search(groups, "!files", {}, accept);
    if (ending === "dispose") client.dispose();
    else if (ending === "post") {
      worker.throwOnPost = true;
      worker.deliver(); // Sending the queued request throws.
    } else worker.fail(ending);
    worker.deliver({ id: 1, pages: [] });
    worker.fail("error");
    worker.fail("messageerror");
    client.search(groups, "later", {}, accept);
    client.dispose();
    assert.deepEqual(received, []);
    assert.equal(worker.requests.length, 1);
    assert.equal(worker.terminated, 1);
    assert.equal(failures(), ending === "dispose" ? 0 : 1);
  });
}

test("worker construction failure is reported once and leaves an inert client", () => {
  let failures = 0;
  const client = createPaletteSearchClient(
    () => {
      throw new Error("blocked worker");
    },
    () => failures++,
  );
  client.search(catalog("file"), "file", {}, () => assert.fail("failed worker delivered"));
  client.cancel();
  client.dispose();
  assert.equal(failures, 1);
});
