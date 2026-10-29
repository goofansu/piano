import { constants } from "node:fs";
import { access, open, realpath } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { Data, Effect } from "effect";
import { fileTypeFromBuffer } from "file-type";
import type { FileDownload, FilePreview } from "../shared/files.ts";
import type { Workspace } from "../shared/wire.ts";

class FileRefusal extends Data.TaggedError("FileRefusal")<{ readonly detail: string }> {}
const refuse = (detail: string): never => {
  throw new FileRefusal({ detail });
};
const MiB = 1024 * 1024;
interface BinaryFormat {
  kind: "image" | "audio" | "video" | "pdf";
  limit: number;
  /** Sent to the browser for preview and download. */
  mime: string;
  /** Other MIME bases the detector reports for this format. */
  aliases?: string[];
  /** Names that claim this format; their bytes must then be it. */
  extensions: string[];
}
/** The one list of binary formats Piano previews; docs/file-previews.md describes it. */
const binaryFormats: BinaryFormat[] = [
  {
    kind: "image",
    limit: 10 * MiB,
    mime: "image/png",
    aliases: ["image/apng"],
    extensions: ["png"],
  },
  { kind: "image", limit: 10 * MiB, mime: "image/jpeg", extensions: ["jpg", "jpeg"] },
  { kind: "image", limit: 10 * MiB, mime: "image/gif", extensions: ["gif"] },
  { kind: "image", limit: 10 * MiB, mime: "image/webp", extensions: ["webp"] },
  { kind: "audio", limit: 20 * MiB, mime: "audio/mpeg", extensions: ["mp3"] },
  { kind: "audio", limit: 20 * MiB, mime: "audio/wav", extensions: ["wav"] },
  { kind: "audio", limit: 20 * MiB, mime: "audio/ogg", extensions: ["ogg", "oga", "opus"] },
  { kind: "audio", limit: 20 * MiB, mime: "audio/flac", extensions: ["flac"] },
  {
    kind: "audio",
    limit: 20 * MiB,
    mime: "audio/mp4",
    aliases: ["audio/x-m4a"],
    extensions: ["m4a"],
  },
  { kind: "video", limit: 32 * MiB, mime: "video/mp4", extensions: ["mp4"] },
  { kind: "video", limit: 32 * MiB, mime: "video/webm", extensions: ["webm"] },
  { kind: "pdf", limit: 20 * MiB, mime: "application/pdf", extensions: ["pdf"] },
];
const binaryTypes = new Map(
  binaryFormats.flatMap((format) =>
    [format.mime, ...(format.aliases ?? [])].map((mime) => [mime, format] as const),
  ),
);
const binaryExtensions = new Set(binaryFormats.flatMap((format) => format.extensions));
/** Detected types that are text: they go through the UTF-8 check like undetected files. */
const isTextType = (mime: string) =>
  mime.startsWith("text/") ||
  ["application/xml", "image/svg+xml", "application/rtf"].includes(mime);
/** NUL-free UTF-8, allowing a character cut off at the end of the slice. */
const isUtf8Prefix = (bytes: Uint8Array) => {
  if (bytes.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes, { stream: true });
    return true;
  } catch {
    return false;
  }
};
/** The detector's MIME without parameters, such as `audio/ogg; codecs=opus`. */
const mimeBase = (detected: { mime: string } | undefined) =>
  detected?.mime.split(";")[0]?.trim().toLowerCase();
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
  ".bashrc": "shellscript",
  ".zshrc": "shellscript",
};
/** Whether `path` (absolute) lies inside `root` or is it. */
const within = (root: string, path: string) => {
  const name = relative(root, path);
  return name !== ".." && !name.startsWith(`..${sep}`) && !isAbsolute(name);
};

/** The physical path: the nearest existing ancestor resolved, the rest (a file not written yet,
 * or already removed) reattached. */
async function physical(target: string): Promise<string> {
  let head = target;
  const tail: string[] = [];
  for (;;) {
    try {
      return join(await realpath(head), ...tail);
    } catch {
      const parent = dirname(head);
      if (parent === head) return target;
      tail.unshift(basename(head));
      head = parent;
    }
  }
}

/**
 * Where `path` (as a session's tool calls named it: relative to the workspace, or absolute) sits
 * in the workspace: its name relative to the workspace's real root, or `undefined` outside it.
 * Resolve directory aliases (including the workspace root) before naming the file. Preserve the
 * leaf: Git tracks a leaf symlink itself, not its target. Missing descendants retain their names.
 * Placement is Git identity, not permission to read: previews may also open files outside it.
 */
export async function place(workspace: Workspace, path: string): Promise<string | undefined> {
  const logical = resolve(workspace.path);
  const target = resolve(logical, path);
  const root = await realpath(logical);
  if (target === logical || target === root) return "";
  const real = join(await physical(dirname(target)), basename(target));
  return within(root, real) ? relative(root, real) : undefined;
}

/** One accepted file: what the preview shows, and the bytes it was read from. */
interface Acquired {
  preview: FilePreview;
  name: string;
  mime: string;
  data: Uint8Array;
}

/**
 * Explicit local reads, relative to the workspace or absolute; no listing or fallback search.
 * Preview and download share this, so a file downloads exactly when it previews.
 */
async function acquire(workspace: Workspace, path: string, signal: AbortSignal): Promise<Acquired> {
  if (!path.trim() || path.includes("\0")) refuse("Choose a file path.");
  // The checkout's own absence is the cause, named as the session's other views name it.
  await access(workspace.path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") refuse("Checkout removed");
  });
  const requested = resolve(workspace.path, path);
  // Keep workspace names stable; external files need their full path for nested links.
  const name = (await place(workspace, path)) ?? requested;
  const target = await realpath(requested);
  // Nonblocking prevents special files (notably FIFOs) from hanging the request.
  const file = await open(target, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (!stat.isFile()) refuse("Choose a regular file, not a directory or device.");
    const header = Buffer.alloc(8192);
    const initial = await file.read(header, 0, header.length, 0);
    const head = header.subarray(0, initial.bytesRead);
    const binaryName = binaryExtensions.has(extname(requested).slice(1).toLowerCase());
    // Short signatures such as `BM`, `MZ`, `ID3` and `%PDF` also start ordinary prose, so
    // UTF-8 text under a name that does not claim a binary format is text whatever they suggest.
    const detected =
      !binaryName && isUtf8Prefix(head)
        ? undefined
        : await fileTypeFromBuffer(head).catch(() => undefined);
    const type = mimeBase(detected);
    const binary = type ? binaryTypes.get(type) : undefined;
    if (type && !binary && !isTextType(type))
      refuse("This file type is not supported. Convert it to UTF-8 text, PNG, MP3, MP4 or PDF.");
    if (!binary && binaryName)
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
    const identity = { workspaceId: workspace.id, path: name };
    if (binary) {
      const actual = mimeBase(await fileTypeFromBuffer(data).catch(() => undefined));
      if (!actual || binaryTypes.get(actual) !== binary)
        refuse("This file changed while reading. Try the link again.");
      return {
        preview: { ...identity, kind: binary.kind, mime: binary.mime, bytes: data },
        name: basename(requested),
        mime: binary.mime,
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
    const svg = extname(requested).toLowerCase() === ".svg";
    return {
      preview: {
        ...identity,
        kind: markdown ? ("markdown" as const) : svg ? ("svg" as const) : ("text" as const),
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
            detail: "Could not read this file. Check the path and read permissions.",
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
