import { Schema } from "effect";

const identity = { workspaceId: Schema.String, path: Schema.String };
export const FilePreview = Schema.Union([
  Schema.Struct({
    ...identity,
    kind: Schema.Literals(["markdown", "text"]),
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

/** A workspace file as it is on disk, for saving: the browser's name for it, its type, every byte. */
export const FileDownload = Schema.Struct({
  name: Schema.String,
  mime: Schema.String,
  bytes: Schema.Uint8Array,
});
export type FileDownload = typeof FileDownload.Type;
