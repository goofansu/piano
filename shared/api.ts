/** Local orchestration only; never mounted on the browser listener. */
import { Schema } from "effect";
import { endpoint } from "./http.ts";

export const ApiStatus = Schema.Literals(["running", "waiting", "idle", "error"]);
export type ApiStatus = typeof ApiStatus.Type;
export const ApiSession = Schema.Struct({
  status: ApiStatus,
  lastAssistantMessage: Schema.NullOr(Schema.String),
  detail: Schema.NullOr(Schema.String),
  hosted: Schema.Boolean,
  seq: Schema.Number,
  completedSeq: Schema.Number,
});
export const ApiSessionList = Schema.Array(
  Schema.Struct({
    workspaceId: Schema.String,
    sessionId: Schema.String,
    cwd: Schema.String,
    status: ApiStatus,
    hosted: Schema.Boolean,
  }),
);

export const ApiEndpoints = {
  get: endpoint({
    method: "GET",
    path: "/api/v1/sessions",
    query: ["workspaceId", "sessionId"],
    response: ApiSession,
    noStore: true,
    refused: 400,
    fallback: "Could not read session.",
  }),
  list: endpoint({
    method: "GET",
    path: "/api/v1/sessions/list",
    response: ApiSessionList,
    noStore: true,
    refused: 400,
    fallback: "Could not list sessions.",
  }),
};
