/** One discovered Slack destination and best-effort delivery, independent of browser lifetimes. */
import { Clock, Context, Data, Effect, Layer, Queue, Semaphore } from "effect";
import type { NotificationAction, NotificationSettings } from "../shared/notifications.ts";
import { ExeDev, ExeDevLive } from "./ExeDev.ts";
import { AllowedOrigins } from "./OriginPolicy.ts";
import { Registry } from "./Registry.ts";

export class NotificationError extends Data.TaggedError("NotificationError")<{
  readonly detail: string;
}> {
  override get message() {
    return this.detail;
  }
}
/**
 * A completion waits this long before posting, so a user who acts on or reopens the session in the
 * meantime gets no message. Tests shorten it.
 */
export const NotificationDelayMs = Context.Reference<number>("piano/NotificationDelayMs", {
  defaultValue: () => 60_000,
});
export const NotificationFetch = Context.Reference<typeof fetch>("piano/NotificationFetch", {
  defaultValue: () => globalThis.fetch,
});
const refused = (detail: string) => new NotificationError({ detail });
// DNS labels are case-insensitive, including names migrated from canonical lower-case URLs.
const availableName = (names: ReadonlyArray<string> | null, selected: string | null) =>
  names?.find((name) => name.toLowerCase() === selected?.toLowerCase());

export class Notifications extends Context.Service<
  Notifications,
  {
    readonly state: (refresh?: boolean) => Effect.Effect<NotificationSettings, NotificationError>;
    readonly change: (
      action: NotificationAction,
    ) => Effect.Effect<NotificationSettings, NotificationError>;
    /**
     * Nonblocking admission, once per live successful response. No historical replay. The message
     * waits `NotificationDelayMs`; a later `touched` for the session drops it, a later `completed`
     * restarts the wait. At most 32 sessions can be pending, including their initial delays;
     * overflow is dropped, while replacement reuses the session's existing slot.
     */
    readonly completed: (sessionId: string) => Effect.Effect<void>;
    /** The user acted on or opened the session: drop its pending completion message. */
    readonly touched: (sessionId: string) => Effect.Effect<void>;
  }
>()("piano/Notifications") {}

export const NotificationsLive = Layer.effect(
  Notifications,
  Effect.gen(function* () {
    const registry = yield* Registry;
    const exe = yield* ExeDev;
    const fetch = yield* NotificationFetch;
    // Deployment-owned origins, never request headers or a guessed VM hostname.
    const origin = [...(yield* AllowedOrigins)].find((value) => value.startsWith("https://"));
    const problem = origin
      ? undefined
      : "Set a public HTTPS Piano origin in PIANO_ALLOWED_ORIGINS.";
    // One short sentence, then the bare link: Slack renders a URL in `text` as a link by itself.
    const message = (sentence: string, path: string) =>
      `${sentence} ${new URL(path, origin).href.replaceAll("&", "&amp;")}`;
    const changes = yield* Semaphore.make(1);
    const rateLock = yield* Semaphore.make(1);
    const selectedIntegration = registry.notificationIntegration.pipe(
      Effect.mapError(() => refused("Could not read notification settings.")),
    );
    const slack = Effect.fn("Notifications.slack")(function* (refresh = false) {
      const inventory = yield* exe.integrations(refresh);
      return (
        inventory
          ?.filter((i) => i.type === "slack")
          .map((i) => i.name)
          .sort((a, b) => a.localeCompare(b)) ?? null
      );
    });
    const state = Effect.fn("Notifications.state")(function* (refresh = false) {
      const integrations = yield* slack(refresh);
      const selected = yield* selectedIntegration;
      return {
        integrations,
        selected: availableName(integrations, selected) ?? selected,
        ...(problem ? { problem } : {}),
      };
    });
    // Slack's per-user quota includes other VMs. This process cannot reserve their capacity.
    let sentAt: number[] = [];
    const waitMs = Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      sentAt = sentAt.filter((time) => time > now - 60_000);
      return sentAt.length < 5 ? 0 : sentAt[0]! + 60_000 - now;
    });
    const send = Effect.fn("Notifications.send")(function* (name: string, text: string) {
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
          // Only a name validated against the current Slack inventory reaches delivery.
          const response = await fetch(`https://${name.toLowerCase()}.int.exe.xyz/`, {
            method: "POST",
            redirect: "error",
            signal,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text, unfurl_links: false, unfurl_media: false }),
          });
          await response.body?.cancel();
          if (!response.ok) throw new Error("Rejected");
        },
        catch: () => refused("Slack did not accept the notification."),
      }).pipe(
        Effect.timeout(5_000),
        Effect.mapError(() =>
          refused(
            "Could not confirm Slack accepted the notification. Check the integration before retrying.",
          ),
        ),
      );
    });
    const delayMs = yield* NotificationDelayMs;
    // One bounded owner for delays, quota waits and discovery. The queue is only a coalesced
    // wake-up signal: it never retains cancelled completions or allocates a timer per session.
    const wake = yield* Queue.sliding<void>(1);
    const pending = new Map<string, { name: string; readyAt: number }>();
    yield* Effect.gen(function* () {
      let next: [string, { name: string; readyAt: number }] | undefined;
      for (const entry of pending) {
        if (!next || entry[1].readyAt < next[1].readyAt) next = entry;
      }
      if (!next) {
        yield* Queue.take(wake);
        return;
      }
      const [sessionId, completion] = next;
      const delay = Math.max(completion.readyAt - (yield* Clock.currentTimeMillis), yield* waitMs);
      if (delay > 0) {
        yield* Effect.raceFirst(Effect.sleep(delay), Queue.take(wake));
        return;
      }
      const { name } = completion;
      const current = () => pending.get(sessionId) === completion;
      const forget = () => {
        if (current()) pending.delete(sessionId);
      };
      yield* Effect.gen(function* () {
        if (problem || !current()) return;
        const names = yield* slack();
        // Discovery and preferences can wait: revalidate identity after both, then claim it.
        const selected = yield* selectedIntegration;
        if (!current() || !availableName(names, name) || selected !== name) return;
        forget();
        yield* send(
          name,
          message("Agent finished responding.", `/s/${encodeURIComponent(sessionId)}`),
        );
      }).pipe(Effect.ensuring(Effect.sync(forget)));
    }).pipe(
      Effect.catch(() => Effect.logWarning("A Slack notification could not be delivered.")),
      Effect.forever,
      Effect.forkScoped,
    );

    return Notifications.of({
      state,
      change: Effect.fn("Notifications.change")(function* (action) {
        if (action.action === "refresh") return yield* state(true);
        return yield* Semaphore.withPermits(
          changes,
          1,
        )(
          Effect.gen(function* () {
            if (action.action === "select" && action.name === null) {
              // Clear is local policy, never contingent on discovery or link configuration.
              yield* registry
                .setNotificationIntegration(null)
                .pipe(Effect.mapError(() => refused("Could not clear notifications.")));
              return yield* state();
            }
            if (problem) return yield* refused(problem);
            const names = yield* slack(true);
            if (names === null) return yield* refused("Couldn’t load integrations. Try again.");
            if (action.action === "test") {
              const name = yield* selectedIntegration;
              if (!name || !availableName(names, name))
                return yield* refused("Select an available Slack integration.");
              yield* send(name, message("Test notification from Piano.", "/"));
            } else {
              if (action.name === null || !names.includes(action.name))
                return yield* refused("Select an available Slack integration.");
              yield* registry
                .setNotificationIntegration(action.name)
                .pipe(Effect.mapError(() => refused("Could not save notifications.")));
            }
            return yield* state();
          }),
        );
      }),
      completed: Effect.fn("Notifications.completed")(
        function* (sessionId) {
          const name = yield* selectedIntegration;
          // Network and discovery are owned by the worker, not the session observer.
          if (problem || !name) return;
          const readyAt = (yield* Clock.currentTimeMillis) + delayMs;
          // No suspension between capacity check and admission; replacement reuses its slot.
          if (!pending.has(sessionId) && pending.size >= 32) return;
          pending.set(sessionId, { name, readyAt });
          yield* Queue.offer(wake, undefined);
        },
        Effect.catchCause(() => Effect.logWarning("A Slack notification could not be queued.")),
      ),
      touched: Effect.fn("Notifications.touched")(function* (sessionId) {
        if (pending.delete(sessionId)) yield* Queue.offer(wake, undefined);
      }),
    });
  }),
).pipe(Layer.provideMerge(ExeDevLive));
