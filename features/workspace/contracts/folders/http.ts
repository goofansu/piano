import { Schema } from "effect";
import { endpoint } from "../../../../shared/endpoint.ts";
import { FolderView } from "../../../../shared/wire.ts";

const DirEntry = Schema.Struct({
  name: Schema.String,
  path: Schema.String,
  gitSubject: Schema.optional(Schema.String),
});
export const DirListing = Schema.Struct({
  path: Schema.String,
  parent: Schema.NullOr(Schema.String),
  home: Schema.String,
  gitSubject: Schema.optional(Schema.String),
  gitRoot: Schema.optional(Schema.String),
  entries: Schema.Array(DirEntry),
});
export type DirListing = typeof DirListing.Type;

export const folderEndpoints = {
  listDirectory: endpoint({
    method: "POST",
    path: "/api/ls",
    body: Schema.Struct({ path: Schema.optional(Schema.String) }),
    response: DirListing,
    refused: 400,
    fallback: "Could not list this folder.",
  }),
  makeDirectory: endpoint({
    method: "POST",
    path: "/api/mkdir",
    body: Schema.Struct({ path: Schema.NonEmptyString }),
    invalid: "path is required",
    response: Schema.Struct({ path: Schema.String }),
    refused: 400,
    fallback: "Could not create folder",
  }),
  folders: endpoint({
    method: "GET",
    path: "/api/folders",
    response: Schema.Struct({ folders: Schema.Array(FolderView) }),
    fallback: "Could not load folders.",
  }),
} as const;
