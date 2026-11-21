import { Schema } from "effect";
import { endpoint } from "../../../endpoint.ts";
import { WorkspaceWrittenFiles } from "../../../wire.ts";
import { FileDownload, FilePreview } from "./files.ts";

export const WRITTEN_PATHS_LIMIT = 1000;

const WrittenPaths = Schema.Struct({
  paths: Schema.Array(Schema.String.check(Schema.isMaxLength(4096))).check(
    Schema.isMaxLength(WRITTEN_PATHS_LIMIT),
  ),
});

export const fileEndpoints = {
  workspaceFile: endpoint({
    method: "POST",
    path: "/api/workspace/file",
    query: ["workspaceId"],
    body: Schema.Struct({ path: Schema.NonEmptyString.check(Schema.isMaxLength(4096)) }),
    response: FilePreview,
    noStore: true,
    refused: 400,
    fallback: "Could not read this file. Check the path and try again.",
  }),
  workspaceFileDownload: endpoint({
    method: "POST",
    path: "/api/workspace/file/download",
    query: ["workspaceId"],
    body: Schema.Struct({ path: Schema.NonEmptyString.check(Schema.isMaxLength(4096)) }),
    response: FileDownload,
    noStore: true,
    refused: 400,
    fallback: "Could not download this file. Check the path and try again.",
  }),
  workspaceWrittenFiles: endpoint({
    method: "POST",
    path: "/api/workspace/files/written",
    query: ["workspaceId"],
    body: WrittenPaths,
    invalid: "File paths are required in the request body.",
    response: WorkspaceWrittenFiles,
    fallback: (status) => `Files request failed (${status}).`,
  }),
} as const;
