import { Schema } from "effect";
import { endpoint } from "../../endpoint.ts";
import { RadiusSetupRequest, RadiusSetupState } from "./radius.ts";

const RadiusReply = Schema.Struct({ state: RadiusSetupState });

export const radiusEndpoints = {
  radiusSetup: endpoint({
    method: "GET",
    path: "/api/settings/radius",
    response: RadiusReply,
    noStore: true,
    redact: false,
    fallback: "Could not load Radius setup.",
  }),
  changeRadiusSetup: endpoint({
    method: "POST",
    path: "/api/settings/radius",
    body: RadiusSetupRequest,
    invalid: "Invalid Radius setup action.",
    response: RadiusReply,
    noStore: true,
    refused: 409,
    redact: false,
    fallback: "Could not load Radius setup.",
  }),
} as const;
