import { randomUUID } from "node:crypto";
import { type BigIntStats, constants } from "node:fs";
import { type FileHandle, open, realpath } from "node:fs/promises";
import { basename, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { imageType } from "../shared/attachments.ts";
import type { Workspace } from "../shared/wire.ts";

const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_PREVIEW_BYTES = 2 * 1024 * 1024;
const MAX_CACHE_BYTES = 64 * 1024 * 1024;
const MAX_ITEMS = 128;
const APPROVAL_TTL_MS = 5 * 60_000;
const FILE_TTL_MS = 10 * 60_000;

const markdownExtensions = new Set([".md", ".markdown", ".mdown", ".mkd"]);
const textExtensions = new Set([
  "", ".txt", ".log", ".json", ".jsonl", ".yaml", ".yml", ".toml", ".xml", ".csv",
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".css", ".html", ".htm", ".sh", ".bash",
  ".zsh", ".fish", ".py", ".rb", ".rs", ".go", ".java", ".c", ".h", ".cpp", ".hpp",
  ".sql", ".diff", ".patch", ".env", ".gitignore", ".dockerignore", ".ini", ".conf",
]);

export type FileLinkReady = {
  status: "ready";
  name: string;
  kind: "text" | "markdown" | "image" | "download";
  mimeType: string;
  bytes: number;
  previewUrl?: string;
  downloadUrl: string;
};
export type FileLinkResult = FileLinkReady | { status: "approval-required"; approvalId: string; path: string };

type Approval = { workspaceId: string; path: string; expiresAt: number };
type CachedFile = { bytes: Buffer; mimeType: string; name: string; kind: FileLinkReady["kind"]; expiresAt: number };

export class FileLinkError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

function requestedPath(href: string): string {
  let url: URL;
  try { url = new URL(href); } catch { throw new FileLinkError(400, "This is not a valid file link."); }
  if (url.protocol !== "file:" || (url.hostname && url.hostname !== "localhost")) {
    throw new FileLinkError(400, "Only local file:// links are supported.");
  }
  let path: string;
  try { path = fileURLToPath(url); } catch { throw new FileLinkError(400, "This file link contains an invalid path."); }
  if (!isAbsolute(path)) throw new FileLinkError(400, "The file link must use an absolute path.");
  return resolve(path);
}

function within(root: string, path: string): boolean {
  const child = relative(root, path);
  return child === "" || (child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child));
}

function contentType(kind: FileLinkReady["kind"], imageMime?: string): string {
  if (kind === "image") return imageMime!;
  if (kind === "markdown") return "text/markdown; charset=utf-8";
  if (kind === "text") return "text/plain; charset=utf-8";
  return "application/octet-stream";
}

/** Disposable, bounded capability store for browser file previews/downloads. Paths never enter GET URLs. */
export class FileLinks {
  private approvals = new Map<string, Approval>();
  private files = new Map<string, CachedFile>();
  private cacheBytes = 0;
  private readonly now: () => number;

  constructor(now: () => number = Date.now) { this.now = now; }

  async request(workspace: Workspace, href: string): Promise<FileLinkResult> {
    const path = requestedPath(href);
    let root: string;
    try { root = await realpath(workspace.path); }
    catch { throw new FileLinkError(409, "The session workspace is unavailable. Restore it and reload before opening files."); }

    // Lexically external paths require approval before Piano probes or reads them. A symlink
    // that starts inside the workspace is resolved below and also requires approval if it escapes.
    if (!within(resolve(workspace.path), path)) return this.challenge(workspace.id, path);
    let physical: string;
    try { physical = await realpath(path); }
    catch (error) { throw this.readError(path, error); }
    if (!within(root, physical)) return this.challenge(workspace.id, path);
    return this.cache(path, physical);
  }

  async approve(workspace: Workspace, approvalId: string, path: string): Promise<FileLinkReady> {
    this.prune();
    const approval = this.approvals.get(approvalId);
    // Consume first: one deliberate confirmation creates one immutable browser copy, never a grant.
    this.approvals.delete(approvalId);
    if (!approval || approval.expiresAt <= this.now()) throw new FileLinkError(409, "This file approval expired. Open the link again to review the path.");
    if (approval.workspaceId !== workspace.id || approval.path !== path) throw new FileLinkError(403, "The approval does not match this workspace and exact file path.");
    let physical: string;
    try { physical = await realpath(path); }
    catch (error) { throw this.readError(path, error); }
    return this.cache(path, physical);
  }

  preview(id: string): CachedFile | undefined {
    const file = this.get(id);
    return file?.kind === "download" ? undefined : file;
  }

  download(id: string): CachedFile | undefined { return this.get(id); }

  private challenge(workspaceId: string, path: string): FileLinkResult {
    this.prune();
    while (this.approvals.size >= MAX_ITEMS) this.approvals.delete(this.approvals.keys().next().value!);
    const approvalId = randomUUID();
    this.approvals.set(approvalId, { workspaceId, path, expiresAt: this.now() + APPROVAL_TTL_MS });
    return { status: "approval-required", approvalId, path };
  }

  private async cache(requestPath: string, physicalPath: string): Promise<FileLinkReady> {
    let handle: FileHandle;
    // O_NONBLOCK prevents a path swapped to a FIFO from hanging before fstat can reject it.
    // O_NOFOLLOW covers the final component; realpath checks below also catch ordinary
    // parent/symlink replacement. This is fail-closed validation, not a filesystem sandbox (INV-11).
    try { handle = await open(physicalPath, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW); }
    catch (error) { throw this.readError(requestPath, error); }
    let bytes: Buffer;
    try {
      const before = await handle.stat({ bigint: true });
      if (!before.isFile()) throw new FileLinkError(400, "The link does not point to a regular file.");
      if (before.size > BigInt(MAX_FILE_BYTES)) throw new FileLinkError(413, "This file is larger than Piano’s 64 MiB download limit.");
      await this.assertSamePath(requestPath, physicalPath);

      // Never let a growing file make allocation or reading exceed the accepted fstat size.
      // Short EOF and any observed identity/size/time change discard the copy.
      bytes = Buffer.alloc(Number(before.size));
      let offset = 0;
      while (offset < bytes.length) {
        const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
        if (!bytesRead) throw new FileLinkError(409, "The file changed while it was copied. Open it again.");
        offset += bytesRead;
      }
      const after = await handle.stat({ bigint: true });
      if (!this.sameStat(before, after)) throw new FileLinkError(409, "The file changed while it was copied. Open it again.");
      await this.assertSamePath(requestPath, physicalPath);
    } finally { await handle.close(); }

    const extension = extname(requestPath).toLowerCase();
    const detectedImage = imageType(bytes);
    let kind: FileLinkReady["kind"] = "download";
    if (detectedImage && bytes.length <= MAX_PREVIEW_BYTES) kind = "image";
    else if (bytes.length <= MAX_PREVIEW_BYTES && (markdownExtensions.has(extension) || textExtensions.has(extension))) {
      try {
        new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        if (!bytes.includes(0)) kind = markdownExtensions.has(extension) ? "markdown" : "text";
      } catch { /* invalid UTF-8 remains download-only */ }
    }
    const mimeType = contentType(kind, detectedImage);
    this.prune();
    while (this.files.size >= MAX_ITEMS || this.cacheBytes + bytes.length > MAX_CACHE_BYTES) {
      const oldest = this.files.keys().next().value as string | undefined;
      if (!oldest) throw new FileLinkError(413, "This file cannot fit in Piano’s bounded download cache.");
      const removed = this.files.get(oldest)!;
      this.cacheBytes -= removed.bytes.length;
      this.files.delete(oldest);
    }
    const id = randomUUID();
    const name = basename(requestPath) || "download";
    this.files.set(id, { bytes, mimeType, name, kind, expiresAt: this.now() + FILE_TTL_MS });
    this.cacheBytes += bytes.length;
    return { status: "ready", name, kind, mimeType, bytes: bytes.length,
      previewUrl: kind === "download" ? undefined : `/api/file-previews/${id}`,
      downloadUrl: `/api/file-downloads/${id}` };
  }

  private async assertSamePath(requestPath: string, physicalPath: string) {
    try {
      if (await realpath(requestPath) !== physicalPath) throw new Error("path changed");
    } catch {
      throw new FileLinkError(409, "The file path changed while it was copied. Open it again.");
    }
  }

  private sameStat(a: BigIntStats, b: BigIntStats) {
    return a.dev === b.dev && a.ino === b.ino && a.mode === b.mode && a.size === b.size
      && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
  }

  private get(id: string): CachedFile | undefined {
    this.prune();
    if (!/^[0-9a-f-]{36}$/.test(id)) return undefined;
    const file = this.files.get(id);
    if (file) { this.files.delete(id); this.files.set(id, file); }
    return file;
  }

  private prune() {
    const now = this.now();
    for (const [id, approval] of this.approvals) if (approval.expiresAt <= now) this.approvals.delete(id);
    for (const [id, file] of this.files) if (file.expiresAt <= now) { this.cacheBytes -= file.bytes.length; this.files.delete(id); }
  }

  private readError(path: string, error: unknown) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") return new FileLinkError(404, `No file exists at ${path}. Check the path in the assistant response.`);
    if (code === "EACCES" || code === "EPERM") return new FileLinkError(403, `Piano cannot read ${path}: permission denied.`);
    return error instanceof FileLinkError ? error : new FileLinkError(400, `Piano could not copy ${path}. ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** File reads require a browser same-origin POST, in addition to opaque GET capabilities. */
export function sameOriginFileRequest(headers: Record<string, string | undefined>): boolean {
  const origin = headers.origin;
  const host = headers["x-forwarded-host"]?.split(",")[0].trim() || headers.host;
  if (!origin || !host || (headers["sec-fetch-site"] && headers["sec-fetch-site"] !== "same-origin")) return false;
  try {
    const url = new URL(origin);
    return (url.protocol === "http:" || url.protocol === "https:") && url.host === host;
  } catch { return false; }
}

export const fileLinks = new FileLinks();
