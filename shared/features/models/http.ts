import { Schema } from "effect";
import { endpoint } from "../../endpoint.ts";
import { SessionDefaults } from "../../wire.ts";

export const modelEndpoints = {
  saveDefaults: endpoint({
    method: "PUT",
    path: "/api/settings/defaults",
    body: SessionDefaults,
    invalid: "Choose a valid default model and effort.",
    response: Schema.Struct({ ok: Schema.Literal(true) }),
    refused: 400,
    fallback: "Could not save defaults. Try again.",
  }),
} as const;
