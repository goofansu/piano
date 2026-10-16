/** exe.dev-only Slack preferences and best-effort delivery. No transcript content leaves Piano. */
import { Clock, Context, Data, Effect, Layer, Queue, Schema, Semaphore } from "effect";
import type { NotificationAction, NotificationSettings } from "../shared/notifications.ts";
import { AllowedOrigins } from "./OriginPolicy.ts";
import { Registry } from "./Registry.ts";

export class NotificationError extends Data.TaggedError("NotificationError")<{
  readonly detail: string;
}> {
  override get message() {
    return this.detail;
  }
}
export const NotificationFetch = Context.Reference<typeof fetch>("piano/NotificationFetch", {
  defaultValue: () => globalThis.fetch,
});
const Reflection = Schema.Struct({
  name: Schema.String,
  paths: Schema.Array(Schema.Struct({ path: Schema.String })),
});
const refused = (detail: string) => new NotificationError({ detail });

function webhook(raw: string): string {
  const value = raw.trim();
  // Match the entire spelling as well as parsing: URL normalization must not hide paths or credentials.
  if (!/^https:\/\/[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.int\.exe\.xyz\/?$/i.test(value))
    throw refused("Use an exe.dev Slack URL like https://slack-hook.int.exe.xyz/.");
  return new URL(value).href;
}

async function smallJson(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Empty response");
  let text = "";
  let bytes = 0;
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 16_384) throw new Error("Response too large");
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally {
    await reader.cancel();
  }
}

export class Notifications extends Context.Service<
  Notifications,
  {
    readonly state: Effect.Effect<NotificationSettings, NotificationError>;
    readonly change: (
      action: NotificationAction,
    ) => Effect.Effect<NotificationSettings, NotificationError>;
    /** Nonblocking admission, called once for each live successful response. No historical replay. */
    readonly completed: (sessionId: string) => Effect.Effect<void>;
  }
>()("piano/Notifications") {}

export const NotificationsLive = Layer.effect(
  Notifications,
  Effect.gen(function* () {
    const registry = yield* Registry;
    const fetch = yield* NotificationFetch;
    // Deployment-owned origins, never Host/Origin headers or a guessed VM hostname.
    // The first HTTPS browser origin is the canonical notification destination.
    const origin = [...(yield* AllowedOrigins)].find((value) => value.startsWith("https://"));
    const problem = origin
      ? undefined
      : "Set a public HTTPS Piano origin in PIANO_ALLOWED_ORIGINS to enable clickable notifications.";
    const slackLink = (path: string, label: string) =>
      `<${new URL(path, origin).href.replaceAll("&", "&amp;")}|${label}>`;
    const detectionLock = yield* Semaphore.make(1);
    const changes = yield* Semaphore.make(1);
    const rateLock = yield* Semaphore.make(1);
    let detected = false;
    let retryAt = 0;
    const detect = Semaphore.withPermits(
      detectionLock,
      1,
    )(
      Effect.gen(function* () {
        if (detected) return true;
        const now = yield* Clock.currentTimeMillis;
        if (now < retryAt) return false;
        retryAt = now + 30_000;
        detected = yield* Effect.tryPromise({
          try: async (signal) => {
            const response = await fetch("https://reflection.int.exe.xyz/", {
              signal,
              redirect: "error",
            });
            if (!response.ok) {
              await response.body?.cancel();
              return false;
            }
            const metadata = Schema.decodeUnknownSync(Reflection)(await smallJson(response));
            return metadata.name.trim().length > 0;
          },
          catch: () => refused("exe.dev detection unavailable."),
        }).pipe(
          Effect.timeout(1_000),
          Effect.catch(() => Effect.succeed(false)),
        );
        return detected;
      }),
    );
    const webhooks = registry.notificationWebhooks.pipe(
      Effect.mapError(() => refused("Could not read notification settings.")),
    );
    const state = Effect.gen(function* () {
      const available = yield* detect;
      return {
        detected: available,
        webhooks: available ? yield* webhooks : [],
        ...(available && problem ? { problem } : {}),
      };
    });
    // Slack's limit is per user, including other VMs. This process cannot reserve their quota.
    let sentAt: number[] = [];
    const waitMs = Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      sentAt = sentAt.filter((time) => time > now - 60_000);
      return sentAt.length < 5 ? 0 : sentAt[0]! + 60_000 - now;
    });
    const send = Effect.fn("Notifications.send")(function* (url: string, text: string) {
      yield* Semaphore.withPermits(
        rateLock,
        1,
      )(
        Effect.gen(function* () {
          if ((yield* waitMs) > 0)
            return yield* refused("Slack notification limit reached. Try again in a minute.");
          sentAt.push(yield* Clock.currentTimeMillis);
        }),
      );
      yield* Effect.tryPromise({
        try: async (signal) => {
          const response = await fetch(url, {
            method: "POST",
            redirect: "error",
            signal,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text, unfurl_links: false, unfurl_media: false }),
          });
          await response.body?.cancel();
          if (!response.ok) throw new Error("Rejected");
        },
        catch: () =>
          refused(
            "Slack did not accept the notification. Check the integration is attached and try again.",
          ),
      }).pipe(
        Effect.timeout(5_000),
        Effect.mapError(() =>
          refused(
            "Could not confirm Slack accepted the notification. Check the integration before retrying.",
          ),
        ),
      );
    });
    const queue = yield* Queue.dropping<{ url: string; sessionId: string }>(32);
    yield* Effect.gen(function* () {
      const { url, sessionId } = yield* Queue.take(queue);
      const delay = yield* waitMs;
      if (delay > 0) yield* Effect.sleep(delay);
      // Removal cancels queued deliveries; configuration is re-read just before sending.
      if (problem || !(yield* detect) || !(yield* webhooks).includes(url)) return;
      yield* send(
        url,
        `Piano: agent finished responding.\n${slackLink(`/s/${encodeURIComponent(sessionId)}`, "Open session")}`,
      );
    }).pipe(
      Effect.catch(() => Effect.logWarning("A Slack notification could not be delivered.")),
      Effect.forever,
      Effect.forkScoped,
    );

    return Notifications.of({
      state,
      change: Effect.fn("Notifications.change")(function* (action) {
        return yield* Semaphore.withPermits(
          changes,
          1,
        )(
          Effect.gen(function* () {
            if (!(yield* detect))
              return yield* refused("Notifications are available on detected exe.dev VMs only.");
            const url = yield* Effect.try({
              try: () => webhook(action.url),
              catch: () =>
                refused("Use an exe.dev Slack URL like https://slack-hook.int.exe.xyz/."),
            });
            const saved = yield* webhooks;
            if (problem && action.action !== "remove") return yield* refused(problem);
            if (action.action === "test") {
              if (!saved.includes(url))
                return yield* refused("Add this webhook before testing it.");
              yield* send(url, `Piano: test notification.\n${slackLink("/", "Open Piano")}`);
            } else {
              if (action.action === "add") {
                if (saved.includes(url))
                  return yield* refused("This webhook has already been added.");
                if (saved.length >= 10)
                  return yield* refused("You can add up to 10 Slack webhooks.");
              }
              yield* registry
                .changeNotificationWebhook(url, action.action === "add")
                .pipe(Effect.mapError(() => refused("Could not save notification settings.")));
            }
            return yield* state;
          }),
        );
      }),
      completed: Effect.fn("Notifications.completed")(
        function* (sessionId) {
          const urls = yield* webhooks;
          // Detection and HTTP belong to the worker, never the session observer.
          if (problem || urls.length === 0) return;
          for (const url of urls) yield* Queue.offer(queue, { url: webhook(url), sessionId });
        },
        Effect.catchCause(() => Effect.logWarning("A Slack notification could not be queued.")),
      ),
    });
  }),
);
