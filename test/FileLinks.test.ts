import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type TestContext, test } from "node:test";
import { pathToFileURL } from "node:url";
import { FileLinkError, FileLinks, sameOriginFileRequest } from "../server/FileLinks.ts";
import type { Workspace } from "../shared/wire.ts";

function fixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), "piano-file-links-"));
  const workspacePath = join(root, "workspace"), outside = join(root, "Downloads");
  mkdirSync(workspacePath); mkdirSync(outside);
  const workspace: Workspace = { id: "workspace-id", project: workspacePath, path: workspacePath };
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, workspacePath, outside, workspace };
}

async function expectFileError(promise: Promise<unknown>, status: number, message: RegExp) {
  await assert.rejects(promise, error => error instanceof FileLinkError && error.status === status && message.test(error.message));
}

test("workspace files become bounded preview and opaque copied-download capabilities", async t => {
  const f = fixture(t), links = new FileLinks();
  const path = join(f.workspacePath, "sk-report.md");
  writeFileSync(path, "# Before\n");
  const encodedHref = pathToFileURL(path).href.replace("sk-report", "%73%6B-report");
  const result = await links.request(f.workspace, encodedHref);
  assert.equal(result.status, "ready");
  if (result.status !== "ready") return;
  assert.equal(result.kind, "markdown");
  assert.equal(result.name, "sk-report.md", "file identity metadata is not display-redacted");
  assert.match(result.previewUrl!, /^\/api\/file-previews\/[0-9a-f-]{36}$/);
  assert.match(result.downloadUrl, /^\/api\/file-downloads\/[0-9a-f-]{36}$/);
  assert.ok(!result.previewUrl!.includes(path));
  const id = result.downloadUrl.split("/").at(-1)!;
  writeFileSync(path, "# After\n");
  assert.equal(links.download(id)?.bytes.toString(), "# Before\n", "download is the copied snapshot, not a later native file read");
});

test("outside-workspace and escaping symlink files require an exact one-use approval", async t => {
  const f = fixture(t), links = new FileLinks();
  const path = join(f.outside, "example.txt");
  writeFileSync(path, "outside\n");
  symlinkSync(path, join(f.workspacePath, "escape.txt"));

  const direct = await links.request(f.workspace, pathToFileURL(path).href);
  assert.equal(direct.status, "approval-required");
  if (direct.status !== "approval-required") return;
  assert.equal(direct.path, path);
  await expectFileError(links.approve(f.workspace, direct.approvalId, join(f.outside, "other.txt")), 403, /exact file path/);
  await expectFileError(links.approve(f.workspace, direct.approvalId, path), 409, /expired/);

  const retry = await links.request(f.workspace, pathToFileURL(path).href);
  assert.equal(retry.status, "approval-required");
  if (retry.status !== "approval-required") return;
  assert.equal((await links.approve(f.workspace, retry.approvalId, retry.path)).kind, "text");
  assert.equal((await links.request(f.workspace, pathToFileURL(path).href)).status, "approval-required", "approval is not a persistent file or directory grant");

  const symlink = await links.request(f.workspace, pathToFileURL(join(f.workspacePath, "escape.txt")).href);
  assert.equal(symlink.status, "approval-required");
  if (symlink.status === "approval-required") assert.equal(symlink.path, join(f.workspacePath, "escape.txt"));
});

test("supported images preview; unsupported content downloads; errors give bounded guidance", async t => {
  const f = fixture(t), links = new FileLinks();
  const png = join(f.workspacePath, "pixel.png");
  writeFileSync(png, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"));
  const image = await links.request(f.workspace, pathToFileURL(png).href);
  assert.equal(image.status, "ready");
  if (image.status === "ready") { assert.equal(image.kind, "image"); assert.equal(image.mimeType, "image/png"); }

  const binary = join(f.workspacePath, "document.pdf");
  writeFileSync(binary, Buffer.from("%PDF-1.7\n"));
  const result = await links.request(f.workspace, pathToFileURL(binary).href);
  assert.equal(result.status, "ready");
  if (result.status === "ready") {
    assert.equal(result.kind, "download");
    assert.equal(result.previewUrl, undefined);
    assert.equal(links.preview(result.downloadUrl.split("/").at(-1)!), undefined);
  }
  await expectFileError(links.request(f.workspace, "https://example.test/secret"), 400, /file:\/\//);
  await expectFileError(links.request(f.workspace, pathToFileURL(join(f.workspacePath, "missing.txt")).href), 404, /Check the path/);
  await expectFileError(links.request(f.workspace, pathToFileURL(f.workspacePath).href), 400, /regular file/);
});

test("special files fail without blocking and oversized sparse files fail before copying", async t => {
  const f = fixture(t), fifo = join(f.workspacePath, "pipe.txt");
  execFileSync("mkfifo", [fifo]);
  const module = pathToFileURL(join(process.cwd(), "server/FileLinks.ts")).href;
  const script = `import { FileLinks } from ${JSON.stringify(module)};
    import { pathToFileURL } from "node:url";
    const [workspacePath, path] = process.argv.slice(1);
    const workspace = { id: "workspace-id", project: workspacePath, path: workspacePath };
    try { await new FileLinks().request(workspace, pathToFileURL(path).href); console.log("unexpected-ready"); }
    catch (error) { console.log(JSON.stringify({ status: error.status, message: error.message })); }`;
  const output = execFileSync(process.execPath, ["--input-type=module", "--eval", script, f.workspacePath, fifo], { encoding: "utf8", timeout: 2_000 });
  assert.deepEqual(JSON.parse(output), { status: 400, message: "The link does not point to a regular file." });

  const oversized = join(f.workspacePath, "oversized.bin");
  writeFileSync(oversized, "");
  truncateSync(oversized, 64 * 1024 * 1024 + 1);
  await expectFileError(new FileLinks().request(f.workspace, pathToFileURL(oversized).href), 413, /64 MiB/);
});

test("injected clock expires approvals and copied-file capabilities at their deadlines", async t => {
  const f = fixture(t);
  let now = 10_000;
  const links = new FileLinks(() => now);
  const outsidePath = join(f.outside, "approval.txt");
  writeFileSync(outsidePath, "approval\n");
  const challenge = await links.request(f.workspace, pathToFileURL(outsidePath).href);
  assert.equal(challenge.status, "approval-required");
  if (challenge.status !== "approval-required") return;
  now += 5 * 60_000;
  await expectFileError(links.approve(f.workspace, challenge.approvalId, challenge.path), 409, /approval expired/);

  const workspacePath = join(f.workspacePath, "copy.txt");
  writeFileSync(workspacePath, "copy\n");
  const ready = await links.request(f.workspace, pathToFileURL(workspacePath).href);
  assert.equal(ready.status, "ready");
  if (ready.status !== "ready") return;
  const previewId = ready.previewUrl!.split("/").at(-1)!;
  const downloadId = ready.downloadUrl.split("/").at(-1)!;
  const copiedAt = now;
  now = copiedAt + 10 * 60_000 - 1;
  assert.equal(links.preview(previewId)?.bytes.toString(), "copy\n");
  assert.equal(links.download(downloadId)?.bytes.toString(), "copy\n");
  now++;
  assert.equal(links.preview(previewId), undefined);
  assert.equal(links.download(downloadId), undefined);
});

test("file operations accept only same-origin browser POST metadata", () => {
  assert.equal(sameOriginFileRequest({ origin: "http://127.0.0.1:7172", host: "127.0.0.1:7172", "sec-fetch-site": "same-origin" }), true);
  assert.equal(sameOriginFileRequest({ origin: "https://piano.example", host: "127.0.0.1:8001", "x-forwarded-host": "piano.example", "sec-fetch-site": "same-origin" }), true);
  assert.equal(sameOriginFileRequest({ host: "127.0.0.1:7172" }), false);
  assert.equal(sameOriginFileRequest({ origin: "https://evil.example", host: "piano.example", "sec-fetch-site": "cross-site" }), false);
  assert.equal(sameOriginFileRequest({ origin: "https://evil.example", host: "piano.example" }), false);
});
