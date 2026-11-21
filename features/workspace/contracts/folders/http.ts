import { Schema } from "effect";
import { endpoint } from "../../../../shared/endpoint.ts";
import { DirListing, FolderView } from "../../../../shared/wire.ts";

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
