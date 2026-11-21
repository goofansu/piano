import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import { Clock, Context, Data, Deferred, Effect, Layer, Queue, Semaphore } from "effect";
import { KNOWN_SECRET_MIN, projectDisplay } from "../../../server/shared/DisplayProjection.ts";
import { SessionLinkOrigin } from "../../../server/shared/OriginPolicy.ts";
import { Registry, type StoredWebhook } from "../../../server/shared/registry/Registry.ts";
import { cutText } from "../../../shared/cutText.ts";
import { pullRequestIdentity } from "../../../shared/git/pullRequestIdentity.ts";
import { readLiteralSecret } from "../../../shared/literalSecret.ts";
import { LAST_ANSWER_CHARS } from "../../../shared/session/dispatch.ts";
import { sessionLink } from "../../../shared/session/sessionLink.ts";
import {
  closureNeedsAttention,
  dispositionOf,
  lastAnswerOf,
} from "../../../shared/session/sessionStatus.ts";
import { type WebhookEvent } from "../../../shared/session/webhookEvents.ts";
import { type SessionEvent, type Snapshot, sameSession } from "../../../shared/wire.ts";
import {
  type Webhook,
  type WebhookDelivery,
  type WebhookField,
  type WebhookPayload,
  WebhookSave,
} from "../contracts/webhooks.ts";
import {
  RECEIVER_RULE,
  ReceiverRefusal,
  webhookFetch,
  webhookReceiver,
} from "./WebhookReceiver.ts";

export class WebhookError extends Data.TaggedError("WebhookError")<{
  readonly detail: string;
  readonly field?: WebhookField;
}> {}
const refused = (detail: string, field?: WebhookField) =>
  new WebhookError(field ? { detail, field } : { detail });
class DeliveryFailure extends Data.TaggedError("DeliveryFailure")<{ readonly detail: string }> {}
export const WebhookFetch = Context.Reference<typeof fetch>("piano/WebhookFetch", {
  defaultValue: () => webhookFetch,
});
export const WebhookTimeoutMs = Context.Reference<number>("piano/WebhookTimeoutMs", {
  defaultValue: () => 10_000,
});
export class Webhooks extends Context.Service<
  Webhooks,
  {
    readonly list: Effect.Effect<readonly Webhook[], WebhookError>;
    readonly save: (input: WebhookSave) => Effect.Effect<Webhook, WebhookError>;
    readonly remove: (id: string) => Effect.Effect<void, WebhookError>;
    readonly test: (id: string) => Effect.Effect<WebhookDelivery, WebhookError>;
    readonly observe: (
      cwd: string,
      sessionId: string,
      previous: Snapshot | undefined,
      event: SessionEvent,
      observed: Snapshot,
    ) => Effect.Effect<void>;
  }
>()("piano/Webhooks") {}

const maxHooks = 32;
const perHook = 32;

type Job = {
  hook: StoredWebhook;
  payload: WebhookPayload;
  result?: Deferred.Deferred<WebhookDelivery, WebhookError>;
};

export const WebhooksLive = Layer.effect(
  Webhooks,
  Effect.gen(function* () {
    const registry = yield* Registry;
    const fetch = yield* WebhookFetch;
    const timeout = yield* WebhookTimeoutMs;
    const origin = yield* SessionLinkOrigin;
    const lock = yield* Semaphore.make(1);
    const scope = yield* Effect.scope;
    const wake = yield* Queue.sliding<void>(1);
    const pending: Job[] = [];
    const active = new Set<string>();
    const last = new Map<string, WebhookDelivery>();
    const stored = registry.webhooks.pipe(
      Effect.mapError(() => refused("Could not read webhooks.")),
    );
    const shown = (hook: StoredWebhook): Webhook => ({
      id: hook.id,
      url: hook.url,
      hasToken: !!hook.token,
      events: hook.events,
      active: hook.active,
      lastDelivery: last.get(hook.id) ?? null,
    });
    const list = Effect.map(stored, (hooks) => hooks.map(shown));
    const find = Effect.fn("Webhooks.find")(function* (id: string) {
      const hook = (yield* stored).find((h) => h.id === id);
      if (!hook) return yield* refused("Webhook no longer exists.");
      return hook;
    });
    const envelope = Effect.fn("Webhooks.envelope")(function* (event: WebhookEvent | "ping") {
      return {
        source: "piano" as const,
        version: 1 as const,
        event,
        deliveryId: randomUUID(),
        occurredAt: new Date(yield* Clock.currentTimeMillis).toISOString(),
        action: null,
        workspace: null,
        session: null,
        pullRequest: null,
      };
    });
    const receiverOf = (hook: StoredWebhook): string | undefined => {
      try {
        return webhookReceiver(hook.url).href;
      } catch {
        return undefined;
      }
    };
    const deliver = Effect.fn("Webhooks.deliver")(function* (
      receiver: string,
      hook: StoredWebhook,
      payload: WebhookPayload,
    ) {
      return yield* Effect.tryPromise({
        try: async (signal) => {
          const response = await fetch(receiver, {
            method: "POST",
            redirect: "error",
            signal,
            headers: {
              "Content-Type": "application/json",
              "User-Agent": "Piano-Webhook/1",
              "X-Piano-Event": payload.event,
              "X-Piano-Delivery": payload.deliveryId,
              "X-Piano-Hook-ID": hook.id,
              ...(hook.token ? { Authorization: `Bearer ${hook.token}` } : {}),
            },
            body: JSON.stringify(payload),
          });
          await response.body?.cancel();
          return {
            httpStatus: response.status,
            status: response.ok ? ("delivered" as const) : ("failed" as const),
            detail: response.ok ? null : "Receiver returned a non-2xx status.",
          };
        },
        catch: (error) =>
          new DeliveryFailure({
            detail:
              error instanceof ReceiverRefusal ? error.message : "Could not reach the receiver.",
          }),
      }).pipe(
        Effect.timeoutOrElse({
          duration: timeout,
          orElse: () => new DeliveryFailure({ detail: "Receiver did not answer in time." }),
        }),
        Effect.catch((failure) =>
          Effect.succeed({ httpStatus: null, status: "failed" as const, detail: failure.detail }),
        ),
      );
    });
    const send = Effect.fn("Webhooks.send")(function* (job: Job) {
      const { hook, payload } = job;
      const receiver = receiverOf(hook);
      const outcome =
        receiver === undefined
          ? { httpStatus: null, status: "failed" as const, detail: RECEIVER_RULE }
          : yield* deliver(receiver, hook, payload);
      const result: WebhookDelivery = {
        deliveryId: payload.deliveryId,
        occurredAt: payload.occurredAt,
        ...outcome,
      };
      if (job.result) yield* Deferred.succeed(job.result, result);
      if ((yield* stored).some((h) => h.id === hook.id)) last.set(hook.id, result);
    });
    yield* Effect.gen(function* () {
      const index = pending.findIndex((job) => !active.has(job.hook.id));
      if (index < 0) {
        yield* Queue.take(wake);
        return;
      }
      const job = pending.splice(index, 1)[0]!;
      const current = yield* stored.pipe(
        Effect.tapError((error) => (job.result ? Deferred.fail(job.result, error) : Effect.void)),
      );
      const hook = current.find((h) => h.id === job.hook.id);
      if (!hook) {
        if (job.result) yield* Deferred.fail(job.result, refused("Webhook no longer exists."));
        return;
      }
      if (!job.result && (!hook.active || !hook.events.includes(job.payload.event as WebhookEvent)))
        return;
      active.add(hook.id);
      yield* send({ ...job, hook }).pipe(
        Effect.catchCause(() => Effect.logWarning("A webhook delivery could not be recorded.")),
        Effect.ensuring(
          Effect.gen(function* () {
            active.delete(job.hook.id);
            yield* Queue.offer(wake, undefined);
          }),
        ),
        Effect.forkIn(scope),
      );
    }).pipe(
      Effect.catchCause(() => Effect.logWarning("Webhook worker could not read settings.")),
      Effect.forever,
      Effect.forkScoped,
    );

    const admit = Effect.fn("Webhooks.admit")(function* (job: Job) {
      const lane = pending.filter((queued) => queued.hook.id === job.hook.id);
      if (lane.filter((queued) => !queued.result === !job.result).length >= perHook) {
        yield* Effect.logWarning("Webhook pending capacity reached; delivery dropped.");
        return false;
      }
      const backlog = job.result ? lane.find((queued) => !queued.result) : undefined;
      if (backlog) pending.splice(pending.indexOf(backlog), 0, job);
      else pending.push(job);
      yield* Queue.offer(wake, undefined);
      return true;
    });
    const triggered = (
      previous: Snapshot | undefined,
      event: SessionEvent,
      observed: Snapshot,
    ): WebhookEvent[] => {
      if (!previous && event._tag === "snapshot") return [];
      const events: WebhookEvent[] = [];
      if (event._tag === "response_completed") events.push("session.completed");
      if (event._tag === "response_failed") events.push("session.failed");
      const dialog = dispositionOf(observed, true).dialog;
      const before = previous && dispositionOf(previous, true).dialog;
      if (dialog && (dialog.id !== before?.id || dialog.generation !== before?.generation))
        events.push("session.needs_input");
      const stopped =
        event._tag === "closed" || (event._tag === "snapshot" && !previous?.state.closure);
      if (stopped && closureNeedsAttention(observed.state.closure)) events.push("session.failed");
      return events;
    };
    const receiverUrl = Effect.fn("Webhooks.receiverUrl")(function* (text: string) {
      return yield* Effect.try({
        try: () => webhookReceiver(text),
        catch: () => refused(RECEIVER_RULE, "url"),
      });
    });
    const emit = Effect.fn("Webhooks.emit")(
      function* (
        event: WebhookEvent,
        cwd: string,
        sessionId: string,
        snapshot: Snapshot,
        cause: SessionEvent,
      ) {
        const configured = yield* stored;
        const hooks = configured.filter((h) => h.active && h.events.includes(event));
        if (!hooks.length) return;
        const data = yield* registry.get;
        const workspace = data.workspaces.find((w) => w.path === cwd);
        const entry = data.sessions.find((s) => sameSession(s, { cwd, sessionId }));
        if (!workspace || !entry) return;
        const url = origin ? sessionLink(origin, sessionId) : null;
        const pr = entry.pullRequest ? pullRequestIdentity(entry.pullRequest.url) : null;
        const clean = (value: string | undefined | null): string | null => {
          if (value == null) return null;
          let text = projectDisplay(value);
          for (const h of configured)
            if (h.token && h.token.length >= KNOWN_SECRET_MIN)
              text = text.replaceAll(h.token, "[redacted]");
          return text
            .replaceAll(cwd, "[folder]")
            .replaceAll(workspace.folder, "[folder]")
            .replace(
              /(^|[\s`"'(])(?:\/[\w.-]+(?:\/[^\s`"'<>)]*)?|[A-Za-z]:\\[^\s`"'<>)]*)/g,
              "$1[path]",
            );
        };
        const full = clean(lastAnswerOf(snapshot, Infinity));
        const answer = full == null ? null : cutText(full, LAST_ANSWER_CHARS);
        const { dialog } = dispositionOf(snapshot, true);
        const closure = snapshot.state.closure;
        const failure =
          cause._tag === "response_failed"
            ? { reason: "turn_failed", detail: clean(cause.detail), exitCode: null }
            : closure
              ? {
                  reason: closure._tag,
                  detail: clean(closure.detail),
                  exitCode: closure._tag === "exited" ? closure.code : null,
                }
              : undefined;
        for (const hook of hooks) {
          const payload: WebhookPayload = {
            ...(yield* envelope(event)),
            workspace: { id: workspace.id, folder: basename(workspace.folder) },
            session: {
              id: sessionId,
              title: clean(entry.title),
              url,
              model: clean(snapshot.state.model),
            },
            pullRequest: pr ? { number: pr.number, url: pr.url, state: null } : null,
            ...(event === "session.completed"
              ? {
                  answer,
                  answerTruncated: (full?.length ?? 0) > LAST_ANSWER_CHARS,
                }
              : {}),
            ...(event === "session.needs_input" && dialog
              ? {
                  action: url ? `Answer in Piano: ${url}` : "Answer in Piano.",
                  question: {
                    kind: dialog.method,
                    title: clean(dialog.title),
                    message: clean(dialog.message),
                    options: dialog.options?.map((s) => clean(s)!) ?? null,
                  },
                }
              : {}),
            ...(event === "session.failed" && failure
              ? {
                  action: url ? `Open session in Piano: ${url}` : "Open session in Piano.",
                  failure,
                  answer,
                }
              : {}),
          };
          yield* admit({ hook, payload });
        }
      },
      Effect.catchCause(() => Effect.logWarning("A webhook event could not be queued.")),
    );
    return Webhooks.of({
      list,
      save: Effect.fn("Webhooks.save")(function* (input) {
        const url = input.url === undefined ? undefined : yield* receiverUrl(input.url);
        let token = input.token;
        if (typeof token === "string") {
          const read = readLiteralSecret(token);
          if (read.refusal !== undefined) return yield* refused(read.refusal, "token");
          token = read.value;
        }
        if (token && token.length < KNOWN_SECRET_MIN)
          return yield* refused(`Use at least ${KNOWN_SECRET_MIN} characters.`, "token");
        return yield* Semaphore.withPermits(
          lock,
          1,
        )(
          Effect.gen(function* () {
            const hooks = yield* stored;
            const previous = input.id ? hooks.find((h) => h.id === input.id) : undefined;
            if (input.id && !previous) return yield* refused("Webhook no longer exists.");
            const target = url?.href ?? previous?.url;
            const events = input.events ?? previous?.events;
            if (!target || !events)
              return yield* refused("Enter a URL and select at least one event.");
            if (!previous && hooks.length >= maxHooks)
              return yield* refused(`At most ${maxHooks} webhooks can be configured.`);
            const hook: StoredWebhook = {
              id: previous?.id ?? randomUUID(),
              url: target,
              token: token === undefined ? (previous?.token ?? null) : token || null,
              events: [...new Set(events)],
              active: input.active,
              createdAt:
                previous?.createdAt ?? new Date(yield* Clock.currentTimeMillis).toISOString(),
            };
            yield* registry
              .saveWebhook(hook)
              .pipe(Effect.mapError(() => refused("Could not save webhook.")));
            return shown(hook);
          }),
        );
      }),
      remove: Effect.fn("Webhooks.remove")(function* (id) {
        yield* Semaphore.withPermits(
          lock,
          1,
        )(
          registry
            .removeWebhook(id)
            .pipe(Effect.mapError(() => refused("Could not delete webhook."))),
        );
        last.delete(id);
      }),
      test: Effect.fn("Webhooks.test")(function* (id) {
        const hook = yield* find(id);
        const result = yield* Deferred.make<WebhookDelivery, WebhookError>();
        const payload: WebhookPayload = { ...(yield* envelope("ping")), ignore: true };
        if (!(yield* admit({ hook, payload, result })))
          return yield* refused("Delivery queue is full. Try again later.");
        return yield* Deferred.await(result);
      }),
      observe: Effect.fn("Webhooks.observe")(function* (cwd, sessionId, previous, event, observed) {
        for (const sent of triggered(previous, event, observed))
          yield* emit(sent, cwd, sessionId, observed, event);
      }),
    });
  }),
);
