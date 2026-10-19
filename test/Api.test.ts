import assert from "node:assert/strict";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { IGNORED_PATHS_LIMIT } from "../shared/http.ts";
import type { WorkspaceIgnoredFiles } from "../shared/wire.ts";
import {
  ApiError,
  listDirectory,
  makeDirectory,
  slashCommands,
  workspaceChangedFile,
  workspaceChanges,
  workspaceFile,
  workspaceFileDownload,
  workspaceIgnoredFiles,
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

test("slash commands decode from a directory probe", async () => {
  const commands = await slashCommands(repo);
  assert.ok(commands.length > 0);
  assert.ok(
    commands.every(
      (c) => typeof c.name === "string" && ["extension", "prompt", "skill"].includes(c.source),
    ),
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
const filler = (count: number, tag: string) =>
  Array.from({ length: count }, (_, i) => `src/${tag}${i}.ts`);

test("INV-01/07: more paths than one request carries are read in bounded batches and answered as one observation", async (t) => {
  await writeFile(join(repo, ".gitignore"), "scratch/\n*.log\n");
  t.after(() => rm(join(repo, ".gitignore"), { force: true }));
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
    ...filler(IGNORED_PATHS_LIMIT - 4, "a"),
    "./src/app.ts",
    "build.log",
    "../sibling.ts",
    ...filler(7, "b"),
  ];
  const answer = await workspaceIgnoredFiles(workspaceId, paths);
  assert.deepEqual(sent, [IGNORED_PATHS_LIMIT, 10], "bounded batches, in order");
  assert.deepEqual(answer.workspace, { id: workspaceId, folder: repo, path: repo });
  assert.ok(answer.result.status === "ready");
  const { ignored, outside, inside, placed } = answer.result;
  const expectedOutside = ["/elsewhere/x.ts", "../sibling.ts"];
  assert.deepEqual(outside, expectedOutside);
  assert.deepEqual(
    inside,
    paths.filter((p) => !expectedOutside.includes(p)),
    "every path inside the workspace, once, in request order",
  );
  assert.deepEqual(ignored, ["scratch/notes.md", "build.log"]);
  // `placed[i]` still names `inside[i]` after the merge, so spellings of one file are one file.
  const names = new Map(inside.map((path, i) => [path, placed[i]]));
  assert.equal(names.size, inside.length);
  for (const spelling of ["src/app.ts", `${repo}/src/app.ts`, "./src/app.ts"])
    assert.equal(names.get(spelling), "src/app.ts", spelling);
  assert.equal(names.get("scratch/notes.md"), "scratch/notes.md");
  assert.equal(names.get("build.log"), "build.log");
  assert.equal(names.get("src/a0.ts"), "src/a0.ts");
  assert.equal(names.get("src/b6.ts"), "src/b6.ts");
});

test("INV-07: a batched read stops at an abort and refuses a reply naming another workspace", async (t) => {
  const direct = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = direct;
  });
  const paths = filler(IGNORED_PATHS_LIMIT + 1, "c");
  let answered = 0;
  const controller = new AbortController();
  globalThis.fetch = async (input, init) => {
    const response = await direct(input, init);
    if (++answered === 1) controller.abort();
    return response;
  };
  await assert.rejects(
    workspaceIgnoredFiles(workspaceId, paths, { signal: controller.signal }),
    (error: unknown) => error instanceof Error && error.name === "AbortError",
  );
  assert.equal(answered, 1, "no request after the abort");
  // Whatever a later batch replies, the batches before it are never published as one ready answer.
  const second = async (reply: (body: WorkspaceIgnoredFiles) => Response) => {
    answered = 0;
    globalThis.fetch = async (input, init) => {
      const response = await direct(input, init);
      return ++answered < 2 ? response : reply((await response.json()) as WorkspaceIgnoredFiles);
    };
  };
  for (const workspace of [{ id: "another" }, { path: "/elsewhere" }, { folder: "/elsewhere" }]) {
    await second((body) =>
      Response.json({ ...body, workspace: { ...body.workspace, ...workspace } }),
    );
    await assert.rejects(
      workspaceIgnoredFiles(workspaceId, paths),
      (error: unknown) =>
        error instanceof ApiError &&
        error.status === 200 &&
        error.message ===
          "Files answered for more than one workspace. Refresh folders and try again.",
      Object.keys(workspace)[0],
    );
  }
  await second((body) =>
    Response.json({
      ...body,
      result: { status: "error", detail: "Files requires the Git checkout root." },
    }),
  );
  const failed = await workspaceIgnoredFiles(workspaceId, paths);
  assert.deepEqual(failed.result, {
    status: "error",
    detail: "Files requires the Git checkout root.",
  });
  await second(() => new Response("<html>Bad gateway</html>", { status: 502 }));
  await assert.rejects(
    workspaceIgnoredFiles(workspaceId, paths),
    (error: unknown) => error instanceof ApiError && error.status === 502,
  );
});
