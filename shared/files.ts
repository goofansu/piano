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
