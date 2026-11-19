import { join } from "node:path";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { Context, Data, Effect, Layer, Schema } from "effect";
import {
  RadiusAuthenticationError,
  RadiusClient,
} from "../extensions/radius-artifacts/RadiusClient.ts";
import {
  SessionShare,
  type SessionShareResult,
  SHARE_NOT_SENT,
  SHARE_UNCONFIRMED,
  SESSION_SHARE_TIMEOUT_MS,
} from "../shared/share.ts";
import { agentDir } from "./PiEnv.ts";
import { PiSessions } from "./PiSessions.ts";
import type { SessionEntry } from "./Registry.ts";
import { SessionReferences } from "./SessionReferences.ts";

export class SessionShareError extends Data.TaggedError("SessionShareError")<{
  readonly detail: string;
}> {}

export const SessionShareAuth = Context.Reference<
  (signal: AbortSignal) => Promise<string | undefined>
>("piano/SessionShareAuth", {
  defaultValue: () => async (signal) => {
    const directory = agentDir();
    const runtime = await ModelRuntime.create({
      authPath: join(directory, "auth.json"),
      modelsPath: join(directory, "models.json"),
      refreshOnCreate: false,
      signal,
    });
    return (await runtime.getAuth("radius", { signal }))?.auth.apiKey;
  },
});

export class SessionSharing extends Context.Service<
  SessionSharing,
  {
    readonly share: (session: SessionEntry) => Effect.Effect<SessionShareResult, SessionShareError>;
  }
>()("piano/SessionSharing") {}

const Reply = Schema.Struct({
  ok: Schema.Literal(true),
  artifact: Schema.Struct({
    id: Schema.NonEmptyString.check(Schema.isMaxLength(256)),
    latest_version: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
    url: Schema.optional(Schema.String),
    canonical_url: Schema.optional(Schema.String),
    visibility: SessionShare.fields.visibility,
    expires_at: SessionShare.fields.expiresAt,
  }),
});

export const SessionSharingLive = Layer.effect(
  SessionSharing,
  Effect.gen(function* () {
    const references = yield* SessionReferences;
    const { history } = yield* PiSessions;
    const auth = yield* SessionShareAuth;
    let busy = false;
    return SessionSharing.of({
      share: Effect.fn("SessionSharing.share")(function* (session) {
        if (busy)
          return yield* new SessionShareError({
            detail: "Another session share is in progress on this machine. Wait for it to finish.",
          });
        busy = true;
        let sent = false;
        const failure = () =>
          new SessionShareError({ detail: sent ? SHARE_UNCONFIRMED : SHARE_NOT_SENT });
        return yield* Effect.gen(function* () {
          const location = yield* references.resolve(session.cwd, session.sessionId).pipe(
            Effect.mapError(
              () =>
                new SessionShareError({
                  detail:
                    "Could not resolve this saved session. Refresh the session list before sharing.",
                }),
            ),
          );
          if (!location.file)
            return yield* new SessionShareError({
              detail: "This session has no saved history to share yet.",
            });
          const content = yield* history
            .savedJsonl(session.sessionId, location.file)
            .pipe(Effect.mapError((error) => new SessionShareError({ detail: error.detail })));
          const token = yield* Effect.tryPromise({
            try: (signal) => auth(signal),
            catch: () => undefined,
          }).pipe(Effect.orElseSucceed(() => undefined));
          if (!token) return { status: "sign-in-required" as const };
          return yield* Effect.tryPromise({
            try: async (signal): Promise<SessionShareResult> => {
              const client = new RadiusClient(token, signal);
              try {
                await client.connect();
                client.operation("artifacts_create");
                sent = true;
                const { artifact } = Schema.decodeUnknownSync(Reply)(
                  await client.call("artifacts_create", {
                    title: session.title || "Piano session",
                    content,
                    content_type: "application/x-ndjson",
                    visibility: "private",
                    fresh: 1,
                  }),
                );
                return {
                  status: "shared",
                  share: Schema.decodeUnknownSync(SessionShare)({
                    url: artifact.url ?? artifact.canonical_url,
                    visibility: artifact.visibility,
                    expiresAt: artifact.expires_at,
                  }),
                };
              } catch (error) {
                if (error instanceof RadiusAuthenticationError)
                  return { status: "sign-in-required" };
                throw error;
              } finally {
                await client.close();
              }
            },
            catch: failure,
          });
        }).pipe(
          Effect.timeoutOrElse({
            duration: SESSION_SHARE_TIMEOUT_MS,
            orElse: () => Effect.fail(failure()),
          }),
          Effect.ensuring(
            Effect.sync(() => {
              busy = false;
            }),
          ),
        );
      }),
    });
  }),
);
