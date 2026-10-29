import { Schema } from "effect";

const identity = { workspaceId: Schema.String, path: Schema.String };
export const FilePreview = Schema.Union([
  Schema.Struct({
    ...identity,
    kind: Schema.Literals(["markdown", "text", "svg"]),
    language: Schema.String,
    content: Schema.String,
  }),
  Schema.Struct({
    ...identity,
    kind: Schema.Literals(["image", "audio", "video", "pdf"]),
    mime: Schema.String,
    bytes: Schema.Uint8Array,
  }),
]);
export type FilePreview = typeof FilePreview.Type;
export type PreviewKind = FilePreview["kind"];

/**
 * The one list of names that claim a preview format; docs/file-previews.md describes it. The
 * server refuses a name claiming a binary kind whose bytes are not a supported binary format, and
 * the browser picks a file's icon from it before the file is read. Other names are text unless
 * their bytes are a supported binary format.
 */
export const previewKindsByExtension: Readonly<Record<string, PreviewKind>> = {
  md: "markdown",
  markdown: "markdown",
  svg: "svg",
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  mp3: "audio",
  wav: "audio",
  ogg: "audio",
  oga: "audio",
  opus: "audio",
  flac: "audio",
  m4a: "audio",
  mp4: "video",
  webm: "video",
  pdf: "pdf",
};

/** The kind `path`'s extension claims, lowercased; a leading dot (`.bashrc`) is not one. */
export function previewKindByName(path: string): PreviewKind | undefined {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  const extension = name.slice(dot + 1).toLowerCase();
  return dot > 0 && Object.hasOwn(previewKindsByExtension, extension)
    ? previewKindsByExtension[extension]
    : undefined;
}

/** A workspace file as it is on disk, for saving: the browser's name for it, its type, every byte. */
export const FileDownload = Schema.Struct({
  name: Schema.String,
  mime: Schema.String,
  bytes: Schema.Uint8Array,
});
export type FileDownload = typeof FileDownload.Type;
