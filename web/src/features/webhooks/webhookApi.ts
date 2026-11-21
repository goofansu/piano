import { webhookEndpoints } from "../../../../shared/features/webhooks/http.ts";
import { call, type RequestOptions } from "../../shared/transport/api.ts";

export const listWebhooks = (options?: RequestOptions) =>
  call(webhookEndpoints.webhooks, {}, options);

export const saveWebhook = (
  body: import("../../../../shared/features/webhooks/webhooks.ts").WebhookSave,
) => call(webhookEndpoints.saveWebhook, { body });

export const removeWebhook = (id: string) => call(webhookEndpoints.removeWebhook, { body: { id } });

export const testWebhook = (id: string) => call(webhookEndpoints.testWebhook, { body: { id } });
