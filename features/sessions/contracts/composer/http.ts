import { Schema } from "effect";
import { endpoint } from "../../../../shared/endpoint.ts";
import { SlashCommand } from "../../../../shared/wire.ts";

export const composerEndpoints = {
  slashCommands: endpoint({
    method: "POST",
    path: "/api/commands",
    body: Schema.Struct({ cwd: Schema.NonEmptyString }),
    invalid: "Directory is required.",
    response: Schema.Struct({ commands: Schema.Array(SlashCommand) }),
    refused: 502,
    fallback: "Could not load commands.",
  }),
  sessionCommands: endpoint({
    method: "GET",
    path: "/api/session/commands",
    query: ["workspaceId", "sessionId"],
    response: Schema.Struct({ commands: Schema.Array(SlashCommand) }),
    noStore: true,
    refused: 409,
    fallback: "Could not load commands.",
  }),
} as const;
