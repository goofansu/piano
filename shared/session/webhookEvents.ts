import { Schema } from "effect";

export const WEBHOOK_EVENTS = [
  "session.completed",
  "session.needs_input",
  "session.failed",
] as const;
export const WebhookEvent = Schema.Literals(WEBHOOK_EVENTS);
export type WebhookEvent = typeof WebhookEvent.Type;
