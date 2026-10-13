/** Explicit Radius publication, independent of MCP and model calls. Pi owns credentials and
 * saved history; SessionHosts captures the branch under its ownership lock. No transcript or
 * token is retained in the registry, and no automatic retry can publish a second artifact. */
import { DEFAULT_RADIUS_GATEWAY } from "@earendil-works/pi-ai/providers/radius-config";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { Context, Data, Deferred, Effect, Layer, Schema } from "effect";
import type { SessionShare } from "../shared/share.ts";
import { SessionHosts } from "./SessionHosts.ts";

export class ShareError extends Data.TaggedError("ShareError")<{
  readonly detail: string;
}> {}
const failure = (detail: string) => new ShareError({ detail });
const uncertain = "Sharing could not be confirmed. Check Radius artifacts before sharing again.";

/** Only the external credential and HTTP boundaries are replaceable in tests. */
export const SharingEnvironment = Context.Reference<{
  runtime: (signal: AbortSignal) => Promise<Pick<ModelRuntime, "listCredentials" | "getAuth">>;
  fetch: typeof fetch;
  timeoutMs: number;
}>("piano/SharingEnvironment", {
  defaultValue: () => ({
    runtime: (signal) => ModelRuntime.create({ refreshOnCreate: false, signal }),
    fetch: globalThis.fetch,
    timeoutMs: 60_000,
  }),
});

const ArtifactResponse = Schema.Struct({
  artifact: Schema.Struct({
    canonical_url: Schema.String,
    expires_at: Schema.String,
    visibility: Schema.Literal("organization"),
  }),
});

export class SessionSharing extends Context.Service<
  SessionSharing,
  { readonly share: (cwd: string, sessionId: string) => Effect.Effect<SessionShare, ShareError> }
>()("piano/SessionSharing") {}

export const SessionSharingLive = Layer.effect(
  SessionSharing,
  Effect.gen(function* () {
    const hosts = yield* SessionHosts;
    const environment = yield* SharingEnvironment;
    const scope = yield* Effect.scope;
    const pending = new Map<string, Deferred.Deferred<SessionShare, ShareError>>();
    const publish = Effect.fn("SessionSharing.publish")(function* (cwd: string, sessionId: string) {
      const token = yield* Effect.tryPromise({
        try: async (signal) => {
          const runtime = await environment.runtime(signal);
          // Match the UI's signed-in rule; ambient API keys alone do not authorize this feature.
          if (
            !(await runtime.listCredentials({ signal })).some(
              (credential) => credential.providerId === "radius" && credential.type === "oauth",
            )
          )
            return undefined;
          const auth = await runtime.getAuth("radius", { minOAuthValidityMs: 300_000, signal });
          const authorization = Object.entries(auth?.auth.headers ?? {}).find(
            ([name]) => name.toLowerCase() === "authorization",
          )?.[1];
          return (
            auth?.auth.apiKey ?? (authorization && /^Bearer\s+(.+)$/iu.exec(authorization)?.[1])
          );
        },
        catch: () => failure("Could not authorize sharing. Sign in to Radius again in Providers."),
      });
      if (!token) return yield* failure("Sign in to Radius in Providers before sharing.");
      const content = yield* hosts
        .exportBranch(cwd, sessionId)
        .pipe(Effect.mapError((error) => failure(error.detail)));
      // A Piano safety bound, not a claim about Radius's undocumented upload quota.
      if (Buffer.byteLength(content) > 10 * 1024 * 1024)
        return yield* failure("This session exceeds Piano's 10 MiB sharing limit.");
      return yield* Effect.tryPromise({
        try: async (signal): Promise<SessionShare> => {
          const url = new URL("/v1/artifacts", DEFAULT_RADIUS_GATEWAY);
          url.searchParams.set("visibility", "organization");
          url.searchParams.set("title", "Pi session");
          const response = await environment.fetch(url, {
            method: "POST",
            redirect: "error",
            headers: { authorization: `Bearer ${token}`, "content-type": "application/x-ndjson" },
            body: content,
            signal,
          });
          if (!response.ok) {
            // Never expose provider response bodies: they can echo tokens or transcript content.
            await response.body?.cancel();
            throw new Error("Upload failed");
          }
          const { artifact } = Schema.decodeUnknownSync(ArtifactResponse)(await response.json());
          const link = new URL(artifact.canonical_url);
          if (
            link.protocol !== "https:" ||
            link.username ||
            link.password ||
            link.port ||
            !["radius.pi.dev", "radius.earendil.com"].includes(link.hostname) ||
            !Number.isFinite(Date.parse(artifact.expires_at))
          )
            throw new Error("Invalid artifact");
          return { url: link.href, expiresAt: artifact.expires_at, visibility: "organization" };
        },
        catch: () => failure(uncertain),
      });
    });
    return SessionSharing.of({
      share: Effect.fn("SessionSharing.share")(function* (cwd, sessionId) {
        const key = JSON.stringify([cwd, sessionId]);
        const current = pending.get(key);
        if (current) return yield* Deferred.await(current);
        // Claim before yielding; concurrent requests for this session join the same publication.
        const done = Deferred.makeUnsafe<SessionShare, ShareError>();
        pending.set(key, done);
        yield* publish(cwd, sessionId).pipe(
          Effect.timeoutOrElse({
            duration: environment.timeoutMs,
            orElse: () => Effect.fail(failure(uncertain)),
          }),
          Effect.catchDefect(() => Effect.fail(failure(uncertain))),
          (work) => Deferred.complete(done, work),
          Effect.ensuring(Effect.sync(() => pending.delete(key))),
          Effect.forkIn(scope),
        );
        // Browser disconnect does not own publication. A new user action after completion
        // intentionally creates a fresh snapshot, matching Pi's /share behavior.
        return yield* Deferred.await(done);
      }),
    });
  }),
);
