/** Best-effort integration delivery. One bounded owner; no history, retries or Git reads. */
import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import { Clock, Context, Data, Deferred, Effect, Layer, Queue, Schema, Semaphore } from "effect";
import { dispositionOf, lastAnswerOf } from "../shared/sessionStatus.ts";
import {
  type Webhook,
  type WebhookDelivery,
  type WebhookEvent,
  type WebhookPayload,
  WebhookSave,
} from "../shared/webhooks.ts";
import type { Snapshot } from "../shared/wire.ts";
import { projectDisplay } from "./DisplayProjection.ts";
import { pullRequestIdentity } from "./GitHubPullRequests.ts";
import { AllowedOrigins, sessionLinkOrigin } from "./OriginPolicy.ts";
import { Registry, type StoredWebhook } from "./Registry.ts";

export class WebhookError extends Data.TaggedError("WebhookError")<{ readonly detail: string }> {}
const refused = (detail: string) => new WebhookError({ detail });
export const WebhookFetch = Context.Reference<typeof fetch>("piano/WebhookFetch", {
  defaultValue: () => globalThis.fetch,
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
    /** Admission only. Snapshot is the live event's view, never a history read. */
    readonly emit: (
      event: WebhookEvent,
      cwd: string,
      sessionId: string,
      snapshot: Snapshot,
    ) => Effect.Effect<void>;
  }
>()("piano/Webhooks") {}

type Job = {
  hook: StoredWebhook;
  payload: WebhookPayload;
  result?: Deferred.Deferred<WebhookDelivery>;
};

export const WebhooksLive = Layer.effect(
  Webhooks,
  Effect.gen(function* () {
    const registry = yield* Registry;
    const fetch = yield* WebhookFetch;
    const timeout = yield* WebhookTimeoutMs;
    const origin = sessionLinkOrigin(yield* AllowedOrigins);
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
    const send = Effect.fn("Webhooks.send")(function* (job: Job) {
      const { hook, payload } = job;
      const outcome = yield* Effect.tryPromise({
        try: async (signal) => {
          const response = await fetch(hook.url, {
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
        // Never retain fetch errors, response bodies or URLs: receivers can echo credentials.
        catch: () => refused("Delivery failed. Check the receiver and URL."),
      }).pipe(
        Effect.timeout(timeout),
        Effect.catch(() =>
          Effect.succeed({
            httpStatus: null,
            status: "failed" as const,
            detail: "Delivery failed or timed out. Redirects are not followed.",
          }),
        ),
      );
      const result: WebhookDelivery = {
        deliveryId: payload.deliveryId,
        occurredAt: payload.occurredAt,
        ...outcome,
      };
      if (job.result) yield* Deferred.succeed(job.result, result);
      if ((yield* stored).some((h) => h.id === hook.id)) last.set(hook.id, result);
    });
    // One owner schedules at most one request per hook. Slow hooks retain only their own slot;
    // up to 32 others can be pending. Wakeups coalesce, never retaining event data in the queue.
    yield* Effect.gen(function* () {
      const index = pending.findIndex((job) => !active.has(job.hook.id));
      if (index < 0 || active.size >= 32) {
        yield* Queue.take(wake);
        return;
      }
      const job = pending.splice(index, 1)[0]!;
      const current = yield* stored;
      const hook = current.find((h) => h.id === job.hook.id);
      if (
        !job.result &&
        (!hook?.active || !hook.events.includes(job.payload.event as WebhookEvent))
      )
        return;
      active.add(job.hook.id);
      yield* send({ ...job, hook: hook ?? job.hook }).pipe(
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
      if (pending.length >= 32) {
        yield* Effect.logWarning("Webhook pending capacity reached; delivery dropped.");
        return false;
      }
      pending.push(job);
      yield* Queue.offer(wake, undefined);
      return true;
    });
    return Webhooks.of({
      list,
      save: Effect.fn("Webhooks.save")(function* (raw) {
        const input = yield* Schema.decodeUnknownEffect(WebhookSave)(raw).pipe(
          Effect.mapError(() => refused("Enter a URL and select at least one event.")),
        );
        let url: URL;
        try {
          url = new URL(input.url);
        } catch {
          return yield* refused("Enter a valid HTTPS URL.");
        }
        if (
          url.username ||
          url.password ||
          url.hash ||
          !(
            url.protocol === "https:" ||
            (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
          )
        )
          return yield* refused(
            "Use HTTPS (HTTP is allowed only on loopback), without credentials or a fragment.",
          );
        if (input.token && /[^\x21-\x7e]/.test(input.token))
          return yield* refused(
            "Bearer token must contain only visible ASCII characters, without spaces.",
          );
        return yield* Semaphore.withPermits(
          lock,
          1,
        )(
          Effect.gen(function* () {
            const hooks = yield* stored;
            const previous = input.id ? hooks.find((h) => h.id === input.id) : undefined;
            if (input.id && !previous) return yield* refused("Webhook no longer exists.");
            if (!previous && hooks.length >= 32)
              return yield* refused("At most 32 webhooks can be configured.");
            const hook: StoredWebhook = {
              id: previous?.id ?? randomUUID(),
              url: url.href,
              token: input.token === undefined ? (previous?.token ?? null) : input.token || null,
              events: [...new Set(input.events)],
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
        yield* registry
          .removeWebhook(id)
          .pipe(Effect.mapError(() => refused("Could not delete webhook.")));
        last.delete(id);
      }),
      test: Effect.fn("Webhooks.test")(function* (id) {
        const hook = yield* find(id);
        const result = yield* Deferred.make<WebhookDelivery>();
        const payload: WebhookPayload = { ...(yield* envelope("ping")), ignore: true };
        if (!(yield* admit({ hook, payload, result })))
          return yield* refused("Delivery queue is full. Try again later.");
        return yield* Deferred.await(result);
      }),
      emit: Effect.fn("Webhooks.emit")(
        function* (event, cwd, sessionId, snapshot) {
          const configured = yield* stored;
          const hooks = configured.filter((h) => h.active && h.events.includes(event));
          if (!hooks.length) return;
          const data = yield* registry.get;
          const workspace = data.workspaces.find((w) => w.path === cwd);
          const entry = data.sessions.find((s) => s.cwd === cwd && s.sessionId === sessionId);
          if (!workspace || !entry) return;
          const url = origin ? `${origin}/s/${encodeURIComponent(sessionId)}` : null;
          const pr = entry.pullRequest ? pullRequestIdentity(entry.pullRequest.url) : null;
          // Free-form Pi text is display-projected and strips filesystem paths, including known
          // credentials. This is best-effort redaction, not a security boundary for conversation text.
          const clean = (value: string | undefined | null): string | null => {
            if (value == null) return null;
            let text = projectDisplay(value);
            for (const h of configured) if (h.token) text = text.replaceAll(h.token, "[redacted]");
            return text
              .replaceAll(cwd, "[folder]")
              .replaceAll(workspace.folder, "[folder]")
              .replace(
                /(^|[\s`"'(])(?:\/[\w.-]+(?:\/[^\s`"'<>)]*)?|[A-Za-z]:\\[^\s`"'<>)]*)/g,
                "$1[path]",
              );
          };
          const rawAnswer = lastAnswerOf(snapshot, 2001);
          const answer = clean(rawAnswer);
          const { dialog } = dispositionOf(snapshot, true);
          const closure = snapshot.state.closure;
          if (event === "session.needs_input" && !dialog) return;
          if (event === "session.failed" && (!closure || closure._tag === "released")) return;
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
                    answer: answer?.slice(0, 2000) ?? null,
                    answerTruncated:
                      (rawAnswer?.length ?? 0) > 2000 || (answer?.length ?? 0) > 2000,
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
              ...(event === "session.failed" && closure
                ? {
                    action: url ? `Open session in Piano: ${url}` : "Open session in Piano.",
                    failure: {
                      reason: closure._tag,
                      detail: clean(closure.detail),
                      exitCode: closure._tag === "exited" ? closure.code : null,
                    },
                    answer: answer?.slice(0, 2000) ?? null,
                  }
                : {}),
            };
            yield* admit({ hook, payload });
          }
        },
        Effect.catchCause(() => Effect.logWarning("A webhook event could not be queued.")),
      ),
    });
  }),
);
