import assert from "node:assert/strict";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { WRITTEN_PATHS_LIMIT } from "../shared/http.ts";
import type { WorkspaceWrittenFiles } from "../shared/wire.ts";
import {
  ApiError,
  listDirectory,
  listWebhooks,
  makeDirectory,
  saveWebhook,
  workspaceChangedFile,
  workspaceChanges,
  workspaceFile,
  workspaceFileDownload,
  workspaceWrittenFiles,
} from "../web/src/lib/api.ts";
import { type RouterFixture, startRouter } from "./fixtures/router.ts";

// The browser adapter against the real router; only the Pi child is faked.
let server: RouterFixture;
let root = "",
  repo = "",
  workspaceId = "";
const realFetch = globalThis.fetch;
before(async () => {
  server = await startRouter("piano-api-");
  ({ root, repo, workspaceId } = server);
  // The browser resolves "/api/…" against its origin; tests resolve it against the handler.
  globalThis.fetch = (input, init) => server.handle(String(input), init);
});
after(async () => {
  globalThis.fetch = realFetch;
  await server.dispose();
});

test("folder picker: listings decode, and a missing path fails with the server's message", async () => {
  const listing = await listDirectory(repo);
  assert.equal(listing.path, repo);
  assert.equal(listing.gitSubject, "initial");
  assert.deepEqual(
    listing.entries.map((e) => e.name),
    ["src"],
  );
  const missing = join(root, "missing");
  await assert.rejects(
    listDirectory(missing),
    (error: unknown) =>
      error instanceof ApiError &&
      error.status === 400 &&
      error.message === `No such directory: ${missing}`,
  );
  const created = await makeDirectory(join(repo, "new"));
  assert.equal(created, join(repo, "new"));
  assert.deepEqual(
    (await listDirectory(repo)).entries.map((e) => e.name),
    ["new", "src"],
  );
});

test("INV-07: changes address the workspace by ID and an unknown ID surfaces the registry's reason", async () => {
  const changes = await workspaceChanges(workspaceId);
  assert.equal(changes.workspace.path, repo);
  assert.ok(changes.result.status === "ready");
  assert.deepEqual(
    changes.result.files.map((f) => [f.path, f.additions]),
    [["README.md", 1]],
  );
  const file = await workspaceChangedFile(workspaceId, "README.md");
  assert.ok(file.result.status === "ready" && file.result.diff.includes("+two"));
  await assert.rejects(
    workspaceChanges("not-a-workspace"),
    (error: unknown) =>
      error instanceof ApiError &&
      error.status === 404 &&
      error.message === "Workspace is not registered. Refresh the folder list.",
  );
});

test("file previews preserve binary bytes over scoped POST and still redact text", async () => {
  await writeFile(join(repo, "secret.txt"), "token=example-secret");
  const text = await workspaceFile(workspaceId, "secret.txt");
  assert.ok("content" in text);
  assert.equal(text.content, "token=[REDACTED]");
  const pdf = Buffer.from("%PDF-1.7\ntoken=example-secret");
  await writeFile(join(repo, "sample.pdf"), pdf);
  const binary = await workspaceFile(workspaceId, "sample.pdf");
  assert.equal(binary.workspaceId, workspaceId);
  assert.equal(binary.path, "sample.pdf");
  assert.equal(binary.kind, "pdf");
  assert.ok("bytes" in binary);
  assert.deepEqual(binary.bytes, new Uint8Array(pdf));
  await assert.rejects(workspaceFile("unknown", "sample.pdf"), /Workspace is not registered/);
  await assert.rejects(workspaceFile(workspaceId, "../outside.pdf"), /inside this workspace/);
});

test("downloads are the file's exact bytes: text unredacted, binary intact, same containment and refusals", async () => {
  await writeFile(join(repo, "secret.txt"), "token=example-secret");
  const text = await workspaceFileDownload(workspaceId, "secret.txt");
  assert.deepEqual(
    [text.name, text.mime, new TextDecoder().decode(text.bytes)],
    ["secret.txt", "text/plain", "token=example-secret"],
  );
  const pdf = Buffer.from("%PDF-1.7\ntoken=example-secret");
  await writeFile(join(repo, "sample.pdf"), pdf);
  const binary = await workspaceFileDownload(workspaceId, "sample.pdf");
  assert.equal(binary.mime, "application/pdf");
  assert.deepEqual(binary.bytes, new Uint8Array(pdf));
  // A ZIP cannot be previewed, so it cannot be downloaded either.
  await writeFile(join(repo, "archive.zip"), Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]));
  await assert.rejects(workspaceFileDownload(workspaceId, "archive.zip"), /not supported/);
  await assert.rejects(
    workspaceFileDownload(workspaceId, "../outside.pdf"),
    /inside this workspace/,
  );
});

test("a response outside the contract is rejected with the endpoint's message, not trusted", async () => {
  const contract = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json({ path: repo, entries: "not a list" });
    await assert.rejects(
      listDirectory(repo),
      (error: unknown) =>
        error instanceof ApiError && error.message === "Could not list this folder.",
    );
    globalThis.fetch = async () => new Response("<html>Bad gateway</html>", { status: 502 });
    await assert.rejects(
      workspaceChanges(workspaceId),
      (error: unknown) =>
        error instanceof ApiError &&
        error.status === 502 &&
        error.message === "Changes request failed (502). Refresh folders or inspect the server.",
    );
  } finally {
    globalThis.fetch = contract;
  }
});

/** `count` filler paths named after `tag`, to push the interesting ones across a request boundary. */
const workspace = () => ({ id: workspaceId, folder: repo, path: repo });
const filler = (count: number, tag: string) =>
  Array.from({ length: count }, (_, i) => `src/${tag}${i}.ts`);

test("INV-01/07: more paths than one request carries are read in bounded batches and answered as one observation", async (t) => {
  await writeFile(join(repo, ".gitignore"), "scratch/\n*.log\n");
  await writeFile(join(repo, "src/app.ts"), "export {};\n");
  t.after(() => rm(join(repo, ".gitignore"), { force: true }));
  t.after(() => rm(join(repo, "src/app.ts"), { force: true }));
  const direct = globalThis.fetch;
  const sent: number[] = [];
  globalThis.fetch = (input, init) => {
    const body =
      typeof init?.body === "string" ? (JSON.parse(init.body) as { paths?: string[] }) : {};
    if (Array.isArray(body.paths)) sent.push(body.paths.length);
    return direct(input, init);
  };
  t.after(() => {
    globalThis.fetch = direct;
  });
  // Aliases of one file, an ignored path and an outside path on each side of the boundary.
  const paths = [
    "src/app.ts",
    `${repo}/src/app.ts`,
    "scratch/notes.md",
    "/elsewhere/x.ts",
    ...filler(WRITTEN_PATHS_LIMIT - 4, "a"),
    "./src/app.ts",
    "build.log",
    "../sibling.ts",
    ...filler(7, "b"),
  ];
  const answer = await workspaceWrittenFiles(workspace(), paths);
  assert.deepEqual(sent, [WRITTEN_PATHS_LIMIT, 10], "bounded batches, in order");
  assert.deepEqual(answer.workspace, { id: workspaceId, folder: repo, path: repo });
  assert.ok(answer.result.status === "ready");
  const { files } = answer.result;
  assert.deepEqual(
    files.map((file) => file.path),
    paths,
    "every path, once, in request order",
  );
  const byVerdict = (verdict: string) =>
    files.filter((file) => file.verdict === verdict).map((file) => file.path);
  assert.deepEqual(byVerdict("outside"), ["/elsewhere/x.ts", "../sibling.ts"]);
  assert.deepEqual(byVerdict("ignored"), ["scratch/notes.md", "build.log"]);
  // Each verdict and placed name stays with its path across the join, so spellings of one file
  // are one file.
  const named = new Map(files.map((file) => [file.path, file]));
  for (const spelling of ["src/app.ts", `${repo}/src/app.ts`, "./src/app.ts"])
    assert.deepEqual(named.get(spelling), {
      path: spelling,
      verdict: "listed",
      placed: "src/app.ts",
    });
  assert.deepEqual(named.get("build.log"), {
    path: "build.log",
    verdict: "ignored",
    placed: "build.log",
  });
  // The fillers were never written: removed, yet each still placed at its own name.
  assert.deepEqual(named.get("src/a0.ts"), {
    path: "src/a0.ts",
    verdict: "missing",
    placed: "src/a0.ts",
  });
  assert.deepEqual(named.get("src/b6.ts"), {
    path: "src/b6.ts",
    verdict: "missing",
    placed: "src/b6.ts",
  });
});

test("INV-07: a batched read stops at an abort and refuses a reply naming another workspace", async (t) => {
  const direct = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = direct;
  });
  const paths = filler(WRITTEN_PATHS_LIMIT + 1, "c");
  let answered = 0;
  const controller = new AbortController();
  globalThis.fetch = async (input, init) => {
    const response = await direct(input, init);
    if (++answered === 1) controller.abort();
    return response;
  };
  await assert.rejects(
    workspaceWrittenFiles(workspace(), paths, { signal: controller.signal }),
    (error: unknown) => error instanceof Error && error.name === "AbortError",
  );
  assert.equal(answered, 1, "no request after the abort");
  // Whatever a later batch replies, the batches before it are never published as one ready answer.
  const reply = async (batch: number, change: (body: WorkspaceWrittenFiles) => Response) => {
    answered = 0;
    globalThis.fetch = async (input, init) => {
      const response = await direct(input, init);
      return ++answered < batch
        ? response
        : change((await response.json()) as WorkspaceWrittenFiles);
    };
  };
  const second = (change: (body: WorkspaceWrittenFiles) => Response) => reply(2, change);
  // A single batch is held to the asked workspace as much as a later one.
  for (const [batch, asked] of [
    [1, filler(3, "d")],
    [2, paths],
  ] as const)
    for (const other of [{ id: "another" }, { path: "/elsewhere" }, { folder: "/elsewhere" }]) {
      await reply(batch, (body) =>
        Response.json({ ...body, workspace: { ...body.workspace, ...other } }),
      );
      await assert.rejects(
        workspaceWrittenFiles(workspace(), asked),
        (error: unknown) =>
          error instanceof ApiError &&
          error.status === 200 &&
          error.message === "Files answered for another workspace. Refresh folders and try again.",
        `batch ${batch}: ${Object.keys(other)[0]}`,
      );
    }
  await second((body) =>
    Response.json({
      ...body,
      result: { status: "error", detail: "Files requires the Git checkout root." },
    }),
  );
  const failed = await workspaceWrittenFiles(workspace(), paths);
  assert.deepEqual(failed.result, {
    status: "error",
    detail: "Files requires the Git checkout root.",
  });
  await second(() => new Response("<html>Bad gateway</html>", { status: 502 }));
  await assert.rejects(
    workspaceWrittenFiles(workspace(), paths),
    (error: unknown) => error instanceof ApiError && error.status === 502,
  );
});

test("webhooks: a receiver URL with a token reads back as stored, and saving other fields keeps it", async () => {
  const url = "https://localhost/h?token=abc123";
  const saved = await saveWebhook({ url, events: ["session.completed"], active: true });
  assert.equal(saved.url, url);
  assert.equal((await listWebhooks()).find((h) => h.id === saved.id)?.url, url);
  await saveWebhook({ id: saved.id, active: false });
  const after = (await listWebhooks()).find((h) => h.id === saved.id);
  assert.equal(after?.url, url);
  assert.equal(after?.active, false);
});
