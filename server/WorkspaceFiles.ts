import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import { basename, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { Data, Effect } from "effect";
import { fileTypeFromBuffer } from "file-type";
import type { FileDownload, FilePreview } from "../shared/files.ts";
import type { Workspace } from "../shared/wire.ts";

class FileRefusal extends Data.TaggedError("FileRefusal")<{ readonly detail: string }> {}
const refuse = (detail: string): never => {
  throw new FileRefusal({ detail });
};
const MiB = 1024 * 1024;
const binaryTypes: Record<string, { kind: "image" | "audio" | "video" | "pdf"; limit: number }> = {
  "image/png": { kind: "image", limit: 10 * MiB },
  "image/jpeg": { kind: "image", limit: 10 * MiB },
  "image/gif": { kind: "image", limit: 10 * MiB },
  "image/webp": { kind: "image", limit: 10 * MiB },
  "audio/mpeg": { kind: "audio", limit: 20 * MiB },
  "audio/wav": { kind: "audio", limit: 20 * MiB },
  "audio/ogg": { kind: "audio", limit: 20 * MiB },
  "audio/flac": { kind: "audio", limit: 20 * MiB },
  "audio/mp4": { kind: "audio", limit: 20 * MiB },
  "video/mp4": { kind: "video", limit: 32 * MiB },
  "video/webm": { kind: "video", limit: 32 * MiB },
  "application/pdf": { kind: "pdf", limit: 20 * MiB },
};
// The acquisition module owns filename policy; renderers never infer formats themselves.
const languages: Record<string, string> = {
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "jsx",
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "tsx",
  json: "json",
  jsonc: "jsonc",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  py: "python",
  rb: "ruby",
  rs: "rust",
  go: "go",
  java: "java",
  c: "c",
  h: "c",
  cpp: "cpp",
  cs: "csharp",
  css: "css",
  scss: "scss",
  html: "html",
  xml: "xml",
  svg: "xml",
  sh: "shellscript",
  bash: "shellscript",
  sql: "sql",
  diff: "diff",
  patch: "diff",
  md: "markdown",
  markdown: "markdown",
};
const specialLanguages: Record<string, string> = {
  dockerfile: "dockerfile",
  makefile: "make",
  gnumakefile: "make",
  ".gitignore": "gitignore",
  ".bashrc": "shellscript",
  ".zshrc": "shellscript",
};
const within = (root: string, path: string) => {
  const name = relative(root, path);
  return name !== ".." && !name.startsWith(`..${sep}`) && !isAbsolute(name);
};

/** One accepted file: what the preview shows, and the bytes it was read from. */
interface Acquired {
  preview: FilePreview;
  name: string;
  mime: string;
  data: Uint8Array;
}

/**
 * Explicit workspace-only reads; no directory traversal, listing, or fallback to another cwd.
 * Preview and download share this, so a file downloads exactly when it previews.
 */
async function acquire(workspace: Workspace, path: string, signal: AbortSignal): Promise<Acquired> {
  const root = await realpath(workspace.path);
  const requested = resolve(workspace.path, path);
  if (!path.trim() || path.includes("\0") || !within(resolve(workspace.path), requested))
    refuse("Choose a file inside this workspace.");
  const target = await realpath(requested);
  if (!within(root, target))
    refuse("Choose a file inside this workspace; this link points outside it.");
  // Nonblocking prevents special files (notably FIFOs) from hanging the request.
  const file = await open(target, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (!stat.isFile()) refuse("Choose a regular file, not a directory or device.");
    const header = Buffer.alloc(8192);
    const initial = await file.read(header, 0, header.length, 0);
    const detected = await fileTypeFromBuffer(header.subarray(0, initial.bytesRead)).catch(
      () => undefined,
    );
    const binary = detected && binaryTypes[detected.mime];
    if (detected && !binary && !["application/xml", "image/svg+xml"].includes(detected.mime))
      refuse("This file type is not supported. Convert it to UTF-8 text, PNG, MP3, MP4 or PDF.");
    if (!binary && /\.(png|jpe?g|gif|webp|mp3|wav|ogg|flac|m4a|mp4|webm|pdf)$/i.test(requested))
      refuse(
        "This file is malformed or its content does not match a supported format. Check or convert the original file.",
      );
    const limit = binary?.limit ?? MiB;
    const tooLarge = () =>
      refuse(
        "This file is too large. Choose a " +
          (binary?.kind ?? "text") +
          " file up to " +
          limit / MiB +
          " MiB.",
      );
    if (stat.size > limit) tooLarge();
    const bytes = Buffer.alloc(stat.size + 1);
    let length = 0;
    while (length < bytes.length) {
      signal.throwIfAborted();
      const result = await file.read(bytes, length, bytes.length - length, length);
      if (!result.bytesRead) break;
      length += result.bytesRead;
    }
    if (length > limit) tooLarge();
    if (length !== stat.size) refuse("This file changed while reading. Try the link again.");
    const data = bytes.subarray(0, length);
    const identity = {
      workspaceId: workspace.id,
      path: relative(resolve(workspace.path), requested),
    };
    if (binary && detected) {
      const actual = await fileTypeFromBuffer(data).catch(() => undefined);
      if (actual?.mime !== detected.mime)
        refuse("This file changed while reading. Try the link again.");
      return {
        preview: { ...identity, kind: binary.kind, mime: detected.mime, bytes: data },
        name: basename(requested),
        mime: detected.mime,
        data,
      };
    }
    if (data.includes(0)) refuse("This file is not supported. Choose a UTF-8 text file.");
    let content: string;
    try {
      content = new TextDecoder("utf-8", { fatal: true }).decode(data);
    } catch {
      return refuse("This file is not supported. Choose a UTF-8 text file.");
    }
    const markdown = /\.(md|markdown)$/i.test(extname(requested));
    return {
      preview: {
        ...identity,
        kind: markdown ? ("markdown" as const) : ("text" as const),
        language:
          specialLanguages[basename(requested).toLowerCase()] ??
          languages[extname(requested).slice(1).toLowerCase()] ??
          "",
        content,
      },
      name: basename(requested),
      mime: markdown ? "text/markdown" : "text/plain",
      data,
    };
  } finally {
    await file.close();
  }
}

const attempt = <A>(read: (signal: AbortSignal) => Promise<A>) =>
  Effect.tryPromise({
    try: read,
    catch: (error) =>
      error instanceof FileRefusal
        ? error
        : new FileRefusal({
            detail:
              "Could not read this file. Check the path and read permissions in this workspace.",
          }),
  });

export const readWorkspaceFile = Effect.fn("WorkspaceFiles.read")(function* (
  workspace: Workspace,
  path: string,
): Effect.fn.Return<FilePreview, FileRefusal> {
  return yield* attempt(async (signal) => (await acquire(workspace, path, signal)).preview);
});

/** The file as it is on disk. The caller sends it as an attachment, never through the display projection. */
export const downloadWorkspaceFile = Effect.fn("WorkspaceFiles.download")(function* (
  workspace: Workspace,
  path: string,
): Effect.fn.Return<FileDownload, FileRefusal> {
  return yield* attempt(async (signal) => {
    const { name, mime, data } = await acquire(workspace, path, signal);
    return { name, mime, bytes: data };
  });
});
