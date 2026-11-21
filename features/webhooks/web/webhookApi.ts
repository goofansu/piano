import { call, type RequestOptions } from "../../../web/src/shared/transport/api.ts";
import { webhookEndpoints } from "../contracts/http.ts";

export const listWebhooks = (options?: RequestOptions) =>
  call(webhookEndpoints.webhooks, {}, options);

export const saveWebhook = (body: import("../contracts/webhooks.ts").WebhookSave) =>
  call(webhookEndpoints.saveWebhook, { body });

export const removeWebhook = (id: string) => call(webhookEndpoints.removeWebhook, { body: { id } });

export const testWebhook = (id: string) => call(webhookEndpoints.testWebhook, { body: { id } });
