import { Schema } from "effect";

export const WEBHOOK_EVENTS = [
  "session.completed",
  "session.needs_input",
  "session.failed",
] as const;
export const WebhookEvent = Schema.Literals(WEBHOOK_EVENTS);
export type WebhookEvent = typeof WebhookEvent.Type;
/** A new webhook needs `url` and `events`; for an existing `id`, an omitted one keeps its stored value. */
export const WebhookSave = Schema.Struct({
  id: Schema.optional(Schema.String),
  url: Schema.optional(Schema.String.check(Schema.isMaxLength(4096))),
  /** Omitted preserves the token; null clears it. Never returned. */
  token: Schema.optional(Schema.NullOr(Schema.String.check(Schema.isMaxLength(4096)))),
  events: Schema.optional(Schema.Array(WebhookEvent).check(Schema.isMinLength(1))),
  active: Schema.Boolean,
});
export type WebhookSave = typeof WebhookSave.Type;
/** The editor field a refused save belongs to; a refusal without one is about the save as a whole. */
export type WebhookField = "url" | "events" | "token";
export const WebhookDelivery = Schema.Struct({
  deliveryId: Schema.String,
  occurredAt: Schema.String,
  status: Schema.Literals(["delivered", "failed"]),
  httpStatus: Schema.NullOr(Schema.Number),
  detail: Schema.NullOr(Schema.String),
});
export type WebhookDelivery = typeof WebhookDelivery.Type;
export const Webhook = Schema.Struct({
  id: Schema.String,
  url: Schema.String,
  hasToken: Schema.Boolean,
  events: Schema.Array(WebhookEvent),
  active: Schema.Boolean,
  lastDelivery: Schema.NullOr(WebhookDelivery),
});
export type Webhook = typeof Webhook.Type;

export interface WebhookPayload {
  readonly source: "piano";
  readonly version: 1;
  readonly event: WebhookEvent | "ping";
  readonly deliveryId: string;
  readonly occurredAt: string;
  readonly action: string | null;
  readonly workspace: { readonly id: string; readonly folder: string } | null;
  readonly session: {
    readonly id: string;
    readonly title: string | null;
    readonly url: string | null;
    readonly model: string | null;
  } | null;
  readonly pullRequest: {
    readonly number: number;
    readonly url: string;
    readonly state: string | null;
  } | null;
  readonly answer?: string | null;
  readonly answerTruncated?: boolean;
  readonly question?: {
    readonly kind: string;
    readonly title: string | null;
    readonly message: string | null;
    readonly options: readonly string[] | null;
  };
  readonly failure?: {
    readonly reason: string;
    readonly detail: string | null;
    readonly exitCode: number | null;
  };
  readonly ignore?: true;
}
