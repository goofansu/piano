import { Schema } from "effect";
import { endpoint } from "../../../../shared/endpoint.ts";
import { Workspace } from "../../../../shared/wire.ts";
import { FileDownload, FilePreview } from "../../../../shared/workspace/files.ts";

export const WrittenFile = Schema.Union([
  Schema.Struct({ path: Schema.String, verdict: Schema.Literal("outside") }),
  Schema.Struct({
    path: Schema.String,
    verdict: Schema.Literals(["listed", "ignored", "missing"]),
    placed: Schema.String,
  }),
]);
export type WrittenFile = typeof WrittenFile.Type;

export const WorkspaceWrittenFiles = Schema.Struct({
  workspace: Workspace,
  observedAt: Schema.String,
  result: Schema.Union([
    Schema.Struct({ status: Schema.Literal("ready"), files: Schema.Array(WrittenFile) }),
    Schema.Struct({ status: Schema.Literal("error"), detail: Schema.String }),
  ]),
});
export type WorkspaceWrittenFiles = typeof WorkspaceWrittenFiles.Type;

export const sameWorkspace = (a: Workspace, b: Workspace) =>
  a.id === b.id && a.path === b.path && a.folder === b.folder;

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
