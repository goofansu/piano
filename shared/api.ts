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

export const ApiAccepted = Schema.Union([
  Schema.Struct({ workspaceId: Schema.String, sessionId: Schema.String, seq: Schema.Number }),
  Schema.Struct({ seq: Schema.Number }),
]);
export type ApiAccepted = typeof ApiAccepted.Type;
const requestId = Schema.optional(Schema.NonEmptyString.check(Schema.isMaxLength(256)));

export const ApiEndpoints = {
  create: endpoint({
    method: "POST",
    path: "/api/v1/sessions",
    body: Schema.Struct({
      cwd: Schema.NonEmptyString,
      prompt: Schema.NonEmptyString,
      model: Schema.optional(Schema.NonEmptyString),
      requestId,
    }),
    response: ApiAccepted,
    noStore: true,
    refused: 409,
    fallback: "Could not create session.",
  }),
  send: endpoint({
    method: "POST",
    path: "/api/v1/sessions/messages",
    query: ["workspaceId", "sessionId"],
    body: Schema.Struct({
      prompt: Schema.NonEmptyString,
      mode: Schema.optional(Schema.Literals(["prompt", "steer"])),
      requestId,
    }),
    response: ApiAccepted,
    noStore: true,
    refused: 409,
    fallback: "Could not send message.",
  }),
  abort: endpoint({
    method: "POST",
    path: "/api/v1/sessions/abort",
    query: ["workspaceId", "sessionId"],
    body: Schema.Struct({ stop: Schema.optional(Schema.Boolean) }),
    response: Schema.Struct({ ok: Schema.Literal(true) }),
    noStore: true,
    refused: 409,
    fallback: "Could not abort session.",
  }),
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
