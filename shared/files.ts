import { Schema } from "effect";

const MiB = 1024 * 1024;
export const PREVIEW_LIMIT_BYTES = {
  text: MiB,
  image: 10 * MiB,
  audio: 20 * MiB,
  video: 32 * MiB,
  pdf: 20 * MiB,
} as const;

const identity = { workspaceId: Schema.String, path: Schema.String };
export const FilePreview = Schema.Union([
  Schema.Struct({
    ...identity,
    kind: Schema.Literals(["markdown", "html", "text", "svg"]),
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

export const previewKindsByExtension: Readonly<Record<string, PreviewKind>> = {
  md: "markdown",
  markdown: "markdown",
  html: "html",
  htm: "html",
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

export function previewKindByName(path: string): PreviewKind | undefined {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  const extension = name.slice(dot + 1).toLowerCase();
  return dot > 0 && Object.hasOwn(previewKindsByExtension, extension)
    ? previewKindsByExtension[extension]
    : undefined;
}

export const FileDownload = Schema.Struct({
  name: Schema.String,
  mime: Schema.String,
  bytes: Schema.Uint8Array,
});
export type FileDownload = typeof FileDownload.Type;
