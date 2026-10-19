/**
 * What the Integrations section shows and allows, decided once. Slack is one card whose radios pick
 * the webhook that receives completion notifications, or Off. Discovery is either unavailable (this
 * VM's attached webhooks can't be read), or ready with the attached webhooks. A saved webhook stays
 * checked in both, so the radio group never claims Off while Piano still sends; it is pickable only
 * when attached, and called "(not attached)" only when discovery says so. Off stays reachable
 * through discovery failures and a missing public URL. Pure; the section renders it.
 */
import type { NotificationSettings } from "../../../shared/notifications.ts";

export interface IntegrationsInput {
  /** The settings as last read; absent until the first read succeeds. */
  settings: NotificationSettings | undefined;
  /** The last read failed and no read is in flight. */
  loadFailed: boolean;
  /** A change is in flight; every control waits for it. */
  busy: boolean;
}

export interface WebhookOption {
  name: string;
  /** Saved, but discovery reports it is no longer attached to this VM. */
  notAttached: boolean;
  disabled: boolean;
}

export interface IntegrationsReady {
  status: "ready" | "unavailable";
  /** Why choosing a webhook or testing waits: Piano's public URL is not configured. */
  problem: string | undefined;
  /** The checked webhook; `null` checks Off. */
  checked: string | null;
  /** Webhook radios after Off, in order. */
  options: readonly WebhookOption[];
  offDisabled: boolean;
  /** Slack is on with an attached webhook: show the On mark and offer Test. */
  on: boolean;
  testDisabled: boolean;
  /** Discovery found no webhooks and none is saved. */
  noWebhooks: boolean;
  /** Offer Refresh on the card: nothing is attached, or the saved webhook is not. */
  refresh: boolean;
}

export type IntegrationsView = { status: "loading" } | IntegrationsReady;

export function integrationsView({
  settings,
  loadFailed,
  busy,
}: IntegrationsInput): IntegrationsView {
  if (!settings && !loadFailed) return { status: "loading" };
  const names = loadFailed ? null : (settings?.integrations ?? null);
  const selected = settings?.selected ?? null;
  const problem = settings?.problem;
  const webhooksDisabled = busy || !!problem;
  if (names === null) {
    return {
      status: "unavailable",
      problem,
      checked: selected,
      // Unknown whether it is still attached: checked, but not pickable until discovery answers.
      options: selected ? [{ name: selected, notAttached: false, disabled: true }] : [],
      offDisabled: busy,
      on: false,
      testDisabled: true,
      noWebhooks: false,
      refresh: false,
    };
  }
  const missing = !!selected && !names.includes(selected);
  return {
    status: "ready",
    problem,
    checked: selected,
    options: [
      ...(selected && missing ? [{ name: selected, notAttached: true, disabled: true }] : []),
      ...names.map((name) => ({ name, notAttached: false, disabled: webhooksDisabled })),
    ],
    offDisabled: busy,
    on: !!selected && !missing,
    testDisabled: webhooksDisabled,
    noWebhooks: names.length === 0 && !selected,
    refresh: missing || (names.length === 0 && !selected),
  };
}
