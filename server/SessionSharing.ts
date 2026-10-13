/** Explicit Radius publication, independent of MCP and model calls. Pi owns credentials and
 * saved history; Radius owns artifact contents and revisions. Only a durable destination is
 * retained in Piano's database. Save it before uploading any transcript so retries/restarts
 * can add a version at the same URL, replacing it only after Radius reports it missing. */
import { DEFAULT_RADIUS_GATEWAY } from "@earendil-works/pi-ai/providers/radius-config";
import { Context, Data, Deferred, Effect, Layer, Schema } from "effect";
import type { RadiusShareLink, SessionShare } from "../shared/share.ts";
import { ProviderLogin } from "./ProviderLogin.ts";
import { Registry } from "./Registry.ts";
import { SessionHosts } from "./SessionHosts.ts";

export class ShareError extends Data.TaggedError("ShareError")<{
  readonly detail: string;
}> {}
class RadiusRequestError extends Data.TaggedError("RadiusRequestError")<{
  readonly status: number;
}> {}
const failure = (detail: string) => new ShareError({ detail });
const uncertain = "Sharing could not be confirmed. Check Radius artifacts before sharing again.";
const unavailable =
  "The saved Radius share is unavailable. Check its access or expiration in Radius. Piano has not created a new link.";

/** Only the HTTP boundary is replaceable in tests; credentials come from ProviderLogin. */
export const SharingEnvironment = Context.Reference<{
  fetch: typeof fetch;
  timeoutMs: number;
}>("piano/SharingEnvironment", {
  defaultValue: () => ({
    fetch: globalThis.fetch,
    timeoutMs: 60_000,
  }),
});

const OrganizationResponse = Schema.Struct({
  organization: Schema.Struct({ id: Schema.String.check(Schema.isMinLength(1)) }),
});
const ArtifactResponse = Schema.Struct({
  artifact: Schema.Struct({
    id: Schema.String.check(Schema.isMinLength(1)),
    canonical_url: Schema.String,
    expires_at: Schema.String,
    visibility: Schema.Literals(["organization", "private", "public"]),
    capabilities: Schema.optional(Schema.Struct({ publish_revision: Schema.Boolean })),
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
    const registry = yield* Registry;
    const environment = yield* SharingEnvironment;
    const login = yield* ProviderLogin;
    const scope = yield* Effect.scope;
    const pending = new Map<string, Deferred.Deferred<SessionShare, ShareError>>();
    // All requests go to Pi's official Radius gateway, never a URL from a browser or stored link.
    const request = async (token: string, path: string, init: RequestInit, signal: AbortSignal) => {
      const response = await environment.fetch(new URL(path, DEFAULT_RADIUS_GATEWAY), {
        ...init,
        redirect: "error",
        headers: { ...init.headers, authorization: `Bearer ${token}` },
        signal,
      });
      if (!response.ok) {
        // Provider bodies may echo tokens or transcript content. Never deliver or log them.
        await response.body?.cancel();
        throw new RadiusRequestError({ status: response.status });
      }
      return response.json();
    };
    const artifact = async (
      token: string,
      path: string,
      init: RequestInit,
      signal: AbortSignal,
      expected?: RadiusShareLink,
    ) => {
      const { artifact } = Schema.decodeUnknownSync(ArtifactResponse)(
        await request(token, path, init, signal),
      );
      const link = new URL(artifact.canonical_url);
      if (
        link.protocol !== "https:" ||
        link.username ||
        link.password ||
        link.port ||
        !["radius.pi.dev", "radius.earendil.com"].includes(link.hostname) ||
        !Number.isFinite(Date.parse(artifact.expires_at)) ||
        (expected && (artifact.id !== expected.artifactId || link.href !== expected.url))
      )
        throw new Error("Invalid artifact identity");
      if (artifact.visibility !== "organization")
        throw failure(
          "This share's visibility changed in Radius. Set it to Organization before updating it from Piano.",
        );
      return { ...artifact, canonical_url: link.href };
    };
    const publish = Effect.fn("SessionSharing.publish")(function* (cwd: string, sessionId: string) {
      // The Providers UI's signed-in rule; ambient API keys alone do not authorize this feature.
      const token = yield* login
        .bearer("radius")
        .pipe(
          Effect.mapError(() =>
            failure("Could not authorize sharing. Sign in to Radius again in Providers."),
          ),
        );
      if (!token) return yield* failure("Sign in to Radius in Providers before sharing.");
      const content = yield* hosts
        .exportBranch(cwd, sessionId)
        .pipe(Effect.mapError((error) => failure(error.detail)));
      // A Piano safety bound, not a claim about Radius's undocumented upload quota.
      if (Buffer.byteLength(content) > 10 * 1024 * 1024)
        return yield* failure("This session exceeds Piano's 10 MiB sharing limit.");
      const organizationId = yield* Effect.tryPromise({
        try: async (signal) =>
          Schema.decodeUnknownSync(OrganizationResponse)(
            await request(token, "/v1/organization/settings", { method: "GET" }, signal),
          ).organization.id,
        catch: () =>
          failure("Could not verify your Radius organization. No transcript was uploaded."),
      });
      const session = (yield* registry.get).sessions.find(
        (s) => s.cwd === cwd && s.sessionId === sessionId,
      );
      if (!session || session.archived)
        return yield* failure("This session is no longer available to share.");
      const title = `Pi session ${sessionId}`;
      let destination = session.radiusShare;
      if (destination && destination.organizationId !== organizationId)
        return yield* failure(
          "This session was shared with a different Radius organization. Sign in to that organization to update the same link.",
        );
      if (destination) {
        const target = destination;
        const existing = yield* Effect.tryPromise({
          try: async (signal) => {
            try {
              return await artifact(
                token,
                `/v1/artifacts/${encodeURIComponent(target.artifactId)}`,
                { method: "GET" },
                signal,
                target,
              );
            } catch (error) {
              // Only an explicit missing/gone lookup authorizes replacing the saved link.
              // Auth, malformed replies and transport failures must not allocate duplicates.
              if (
                error instanceof RadiusRequestError &&
                (error.status === 404 || error.status === 410)
              )
                return undefined;
              throw error;
            }
          },
          catch: (error) => (error instanceof ShareError ? error : failure(unavailable)),
        });
        if (existing?.capabilities?.publish_revision === false)
          return yield* failure(
            "This Radius account cannot update the saved share. Sign in with an account that has access.",
          );
        if (!existing) destination = undefined;
      }
      if (!destination) {
        // Allocate an empty artifact, not a transcript. If allocation or saving fails, any
        // orphan is empty. Once a transcript can reach Radius its destination is already durable.
        const created = yield* Effect.tryPromise({
          try: (signal) =>
            artifact(
              token,
              "/v1/artifacts",
              {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ title, visibility: "organization" }),
              },
              signal,
            ),
          catch: () => failure("Could not prepare the Radius share. No transcript was uploaded."),
        });
        destination = { organizationId, artifactId: created.id, url: created.canonical_url };
        const saved = yield* registry
          .setSessionRadiusShare(session, destination)
          .pipe(
            Effect.mapError(() =>
              failure(
                "Could not save the share link in Piano's database. No transcript was uploaded.",
              ),
            ),
          );
        if (!saved)
          return yield* failure(
            "The session changed while preparing its share. No transcript was uploaded; reopen Share to try again.",
          );
      }
      // A deletion/archive while Radius was being read must not start a new upload.
      const current = (yield* registry.get).sessions.find(
        (s) => s.cwd === cwd && s.sessionId === sessionId,
      );
      if (
        !current ||
        current.archived ||
        current.createdAt !== session.createdAt ||
        current.radiusShare?.artifactId !== destination.artifactId
      )
        return yield* failure(
          "The session changed while preparing its share. No transcript was uploaded.",
        );
      const target = destination;
      return yield* Effect.tryPromise({
        try: async (signal): Promise<SessionShare> => {
          // Explicit visibility keeps an update organization-only even if it changes after our
          // read. fresh=1 replaces the file set instead of inheriting another member's extra files.
          const updated = await artifact(
            token,
            `/v1/artifacts/${encodeURIComponent(target.artifactId)}/versions?visibility=organization&fresh=1&title=${encodeURIComponent(title)}`,
            {
              method: "POST",
              headers: { "content-type": "application/x-ndjson" },
              body: content,
            },
            signal,
            target,
          );
          return { url: target.url, expiresAt: updated.expires_at, visibility: "organization" };
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
        // Browser disconnect does not own publication. Explicit later shares add versions;
        // uncertain version responses never discard the durable destination or create a new one.
        return yield* Deferred.await(done);
      }),
    });
  }),
);
