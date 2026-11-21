import { Schema } from "effect";
import { endpoint } from "../../../shared/endpoint.ts";
import { Webhook, WebhookDelivery, WebhookSave } from "./webhooks.ts";

export const webhookEndpoints = {
  webhooks: endpoint({
    method: "GET",
    path: "/api/settings/webhooks",
    response: Schema.Array(Webhook),
    noStore: true,
    refused: 400,
    redact: false,
    fallback: "Could not load webhooks.",
  }),
  saveWebhook: endpoint({
    method: "PUT",
    path: "/api/settings/webhooks",
    body: WebhookSave,
    invalid: "Enter a URL and select at least one event.",
    response: Webhook,
    noStore: true,
    refused: 400,
    redact: false,
    fallback: "Could not save webhook.",
  }),
  removeWebhook: endpoint({
    method: "POST",
    path: "/api/settings/webhooks/remove",
    body: Schema.Struct({ id: Schema.String }),
    invalid: "Webhook ID required.",
    response: Schema.Struct({ ok: Schema.Literal(true) }),
    noStore: true,
    refused: 400,
    fallback: "Could not delete webhook.",
  }),
  testWebhook: endpoint({
    method: "POST",
    path: "/api/settings/webhooks/test",
    body: Schema.Struct({ id: Schema.String }),
    invalid: "Webhook ID required.",
    response: WebhookDelivery,
    noStore: true,
    refused: 400,
    redact: false,
    fallback: "Could not test webhook.",
  }),
} as const;
