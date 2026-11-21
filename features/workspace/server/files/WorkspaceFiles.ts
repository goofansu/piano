import { access, realpath } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { Data, Effect } from "effect";
import { fileTypeFromBuffer } from "file-type";
import { LocalFileRefusal, openLocalFile } from "../../../../server/shared/LocalFile.ts";
import type { Workspace } from "../../../../shared/wire.ts";
import {
  type FileDownload,
  type FilePreview,
  PREVIEW_LIMIT_BYTES,
  previewKindByName,
} from "../../../../shared/workspace/files.ts";

class FileRefusal extends Data.TaggedError("FileRefusal")<{ readonly detail: string }> {}
const refuse = (detail: string): never => {
  throw new FileRefusal({ detail });
};
const MiB = 1024 * 1024;
interface BinaryFormat {
  kind: "image" | "audio" | "video" | "pdf";
  limit: number;
  mime: string;
  aliases?: string[];
}
const binaryFormats: BinaryFormat[] = [
  { kind: "image", limit: PREVIEW_LIMIT_BYTES.image, mime: "image/png", aliases: ["image/apng"] },
  { kind: "image", limit: PREVIEW_LIMIT_BYTES.image, mime: "image/jpeg" },
  { kind: "image", limit: PREVIEW_LIMIT_BYTES.image, mime: "image/gif" },
  { kind: "image", limit: PREVIEW_LIMIT_BYTES.image, mime: "image/webp" },
  { kind: "audio", limit: PREVIEW_LIMIT_BYTES.audio, mime: "audio/mpeg" },
  { kind: "audio", limit: PREVIEW_LIMIT_BYTES.audio, mime: "audio/wav" },
  { kind: "audio", limit: PREVIEW_LIMIT_BYTES.audio, mime: "audio/ogg" },
  { kind: "audio", limit: PREVIEW_LIMIT_BYTES.audio, mime: "audio/flac" },
  { kind: "audio", limit: PREVIEW_LIMIT_BYTES.audio, mime: "audio/mp4", aliases: ["audio/x-m4a"] },
  { kind: "video", limit: PREVIEW_LIMIT_BYTES.video, mime: "video/mp4" },
  { kind: "video", limit: PREVIEW_LIMIT_BYTES.video, mime: "video/webm" },
  { kind: "pdf", limit: PREVIEW_LIMIT_BYTES.pdf, mime: "application/pdf" },
];
const binaryTypes = new Map(
  binaryFormats.flatMap((format) =>
    [format.mime, ...(format.aliases ?? [])].map((mime) => [mime, format] as const),
  ),
);
const binaryKinds = new Set<string>(binaryFormats.map((format) => format.kind));
const isTextType = (mime: string) =>
  mime.startsWith("text/") ||
  ["application/xml", "image/svg+xml", "application/rtf"].includes(mime);
const isUtf8Prefix = (bytes: Uint8Array) => {
  if (bytes.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes, { stream: true });
    return true;
  } catch {
    return false;
  }
};
const mimeBase = (detected: { mime: string } | undefined) =>
  detected?.mime.split(";")[0]?.trim().toLowerCase();
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
  htm: "html",
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
const within = (root: string, path: string) => {
  const name = relative(root, path);
  return name !== ".." && !name.startsWith(`..${sep}`) && !isAbsolute(name);
};

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

export const spell = (workspace: Workspace, path: string): string =>
  isAbsolute(path) ? path : `${resolve(workspace.path)}${sep}${path}`;

async function name(spelled: string): Promise<string> {
  if (!spelled.split(sep).includes("..")) return resolve(spelled);
  return join(await physical(dirname(spelled)), basename(spelled));
}

export async function place(workspace: Workspace, path: string): Promise<string | undefined> {
  const logical = resolve(workspace.path);
  const target = await name(spell(workspace, path));
  const root = await realpath(logical);
  if (target === logical || target === root) return "";
  const real = join(await physical(dirname(target)), basename(target));
  return within(root, real) ? relative(root, real) : undefined;
}

interface Acquired {
  preview: FilePreview;
  name: string;
  mime: string;
  data: Uint8Array;
}

async function acquire(workspace: Workspace, path: string, signal: AbortSignal): Promise<Acquired> {
  if (!path.trim() || path.includes("\0")) refuse("Choose a file path.");
  await access(workspace.path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") refuse("Checkout removed");
  });
  const spelled = spell(workspace, path);
  const requested = await name(spelled);
  const shown = (await place(workspace, path)) ?? requested;
  const target = await realpath(spelled);
  const file = await openLocalFile(target, { noFollow: true }).catch((error: unknown) =>
    error instanceof LocalFileRefusal && error.reason === "not-file"
      ? refuse("Choose a regular file, not a directory or device.")
      : Promise.reject(error),
  );
  try {
    const head = await file.prefix(8192);
    const claimed = previewKindByName(requested);
    const binaryName = claimed !== undefined && binaryKinds.has(claimed);
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
    const limit = binary?.limit ?? PREVIEW_LIMIT_BYTES.text;
    const tooLarge = () =>
      refuse(
        "This file is too large. Choose a " +
          (binary?.kind ?? "text") +
          " file up to " +
          limit / MiB +
          " MiB.",
      );
    const data = await file.whole(limit, signal).catch((error: unknown) => {
      if (!(error instanceof LocalFileRefusal)) throw error;
      if (error.reason === "too-large") return tooLarge();
      if (error.reason === "changed")
        return refuse("This file changed while reading. Try the link again.");
      throw error;
    });
    const identity = { workspaceId: workspace.id, path: shown };
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
    const markdown = claimed === "markdown";
    return {
      preview: {
        ...identity,
        kind:
          claimed === "markdown" || claimed === "svg" || claimed === "html"
            ? claimed
            : ("text" as const),
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

export const downloadWorkspaceFile = Effect.fn("WorkspaceFiles.download")(function* (
  workspace: Workspace,
  path: string,
): Effect.fn.Return<FileDownload, FileRefusal> {
  return yield* attempt(async (signal) => {
    const { name, mime, data } = await acquire(workspace, path, signal);
    return { name, mime, bytes: data };
  });
});
