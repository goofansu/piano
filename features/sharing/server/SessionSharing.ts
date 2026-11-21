import { join } from "node:path";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { Context, Data, Effect, Layer, Schema } from "effect";
import { agentDir } from "../../../server/shared/PiEnv.ts";
import type { SessionEntry } from "../../../server/shared/registry/Registry.ts";
import {
  RADIUS_ARTIFACT_FILE_BYTES,
  RADIUS_ARTIFACT_FILE_LIMIT,
} from "../../../shared/radius/radiusArtifacts.ts";
import {
  SessionShare,
  type SessionShareResult,
  SHARE_NOT_SENT,
  SHARE_UNCONFIRMED,
  SESSION_SHARE_TIMEOUT_MS,
} from "../contracts/share.ts";

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

interface ShareSources {
  resolve: (cwd: string, sessionId: string) => Effect.Effect<{ readonly file?: string }, unknown>;
  savedJsonl: (sessionId: string, file: string, limit: number) => Effect.Effect<string, unknown>;
  openClient: (
    token: string,
    signal: AbortSignal,
  ) => {
    connect(): Promise<void>;
    close(): Promise<void>;
    operation(name: string): string;
    call(name: string, args: Record<string, unknown>): Promise<unknown>;
  };
  isAuthenticationError: (error: unknown) => boolean;
}

export const sessionSharingLayer = <R>(sources: Effect.Effect<ShareSources, never, R>) =>
  Layer.effect(
    SessionSharing,
    Effect.gen(function* () {
      const { resolve, savedJsonl, openClient, isAuthenticationError } = yield* sources;
      const auth = yield* SessionShareAuth;
      let busy = false;
      return SessionSharing.of({
        share: Effect.fn("SessionSharing.share")(function* (session) {
          if (busy)
            return yield* new SessionShareError({
              detail:
                "Another session share is in progress on this machine. Wait for it to finish.",
            });
          busy = true;
          let sent = false;
          const failure = () =>
            new SessionShareError({ detail: sent ? SHARE_UNCONFIRMED : SHARE_NOT_SENT });
          return yield* Effect.gen(function* () {
            const location = yield* resolve(session.cwd, session.sessionId).pipe(
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
            const content = yield* savedJsonl(
              session.sessionId,
              location.file,
              RADIUS_ARTIFACT_FILE_BYTES,
            ).pipe(
              Effect.mapError(
                () =>
                  new SessionShareError({
                    detail: `Could not read a complete saved session (${RADIUS_ARTIFACT_FILE_LIMIT} maximum). Let Pi finish saving and check the history file before sharing again.`,
                  }),
              ),
            );
            const token = yield* Effect.tryPromise({
              try: (signal) => auth(signal),
              catch: () => undefined,
            }).pipe(Effect.orElseSucceed(() => undefined));
            if (!token) return { status: "sign-in-required" as const };
            return yield* Effect.tryPromise({
              try: async (signal): Promise<SessionShareResult> => {
                const client = openClient(token, signal);
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
                  if (isAuthenticationError(error)) return { status: "sign-in-required" };
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
