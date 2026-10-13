/** Explicit Radius publication, independent of MCP and model calls. Pi owns credentials and
 * saved history; Radius owns artifact contents and revisions. Only a durable destination is
 * retained in Piano's database. Save it before uploading any transcript so retries/restarts
 * can add a version at the same URL, replacing it only after Radius reports it missing. */
import { Context, Data, Deferred, Effect, Layer } from "effect";
import type { SessionShare } from "../shared/share.ts";
import { ProviderLogin } from "./ProviderLogin.ts";
import { RadiusArtifacts } from "./RadiusArtifacts.ts";
import { Registry, type SessionEntry } from "./Registry.ts";
import { SessionHosts } from "./SessionHosts.ts";

export class ShareError extends Data.TaggedError("ShareError")<{
  readonly detail: string;
}> {}
const failure = (detail: string) => new ShareError({ detail });
const uncertain = "Sharing could not be confirmed. Check Radius artifacts before sharing again.";
const unavailable =
  "The saved Radius share is unavailable. Check its access or expiration in Radius. Piano has not created a new link.";

/** The publication deadline; Radius itself sits behind RadiusArtifacts. */
export const SharingEnvironment = Context.Reference<{ timeoutMs: number }>(
  "piano/SharingEnvironment",
  { defaultValue: () => ({ timeoutMs: 60_000 }) },
);

export class SessionSharing extends Context.Service<
  SessionSharing,
  {
    /** Share the session reference the caller resolved by ID. */
    readonly share: (session: SessionEntry) => Effect.Effect<SessionShare, ShareError>;
  }
>()("piano/SessionSharing") {}

export const SessionSharingLive = Layer.effect(
  SessionSharing,
  Effect.gen(function* () {
    const hosts = yield* SessionHosts;
    const registry = yield* Registry;
    const environment = yield* SharingEnvironment;
    const radius = yield* RadiusArtifacts;
    const login = yield* ProviderLogin;
    const scope = yield* Effect.scope;
    const pending = new Map<string, Deferred.Deferred<SessionShare, ShareError>>();
    const publish = Effect.fn("SessionSharing.publish")(function* (
      expected: SessionEntry,
    ): Effect.fn.Return<SessionShare, ShareError> {
      const { cwd, sessionId } = expected;
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
      const organizationId = yield* radius
        .organization(token)
        .pipe(
          Effect.mapError(() =>
            failure("Could not verify your Radius organization. No transcript was uploaded."),
          ),
        );
      const session = yield* registry.current(expected);
      if (!session || session.archived)
        return yield* failure("This session is no longer available to share.");
      const title = `Pi session ${sessionId}`;
      let destination = session.radiusShare;
      // The reference as it holds `destination`: a fresh allocation replaces it.
      let reference = session;
      if (destination && destination.organizationId !== organizationId)
        return yield* failure(
          "This session was shared with a different Radius organization. Sign in to that organization to update the same link.",
        );
      if (destination) {
        // Only an explicit missing/gone lookup authorizes replacing the saved link. Auth,
        // malformed replies and transport failures must not allocate duplicates.
        const existing = yield* radius
          .lookup(token, destination)
          .pipe(
            Effect.mapError((error) =>
              failure(
                error.reason === "visibility"
                  ? "This share's visibility changed in Radius. Set it to Organization before updating it from Piano."
                  : unavailable,
              ),
            ),
          );
        if (existing && !existing.canPublishRevision)
          return yield* failure(
            "This Radius account cannot update the saved share. Sign in with an account that has access.",
          );
        if (!existing) destination = undefined;
      }
      if (!destination) {
        // Allocate an empty artifact, not a transcript. If allocation or saving fails, any
        // orphan is empty. Once a transcript can reach Radius its destination is already durable.
        const created = yield* radius
          .allocate(token, title)
          .pipe(
            Effect.mapError(() =>
              failure("Could not prepare the Radius share. No transcript was uploaded."),
            ),
          );
        destination = { organizationId, artifactId: created.id, url: created.url };
        const saved = yield* registry
          .setSessionLink(session, "radiusShare", destination)
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
        reference = saved;
      }
      // A deletion/archive or another destination while Radius was being read must not start a new upload.
      if (!(yield* registry.current(reference, "radiusShare")))
        return yield* failure(
          "The session changed while preparing its share. No transcript was uploaded.",
        );
      const updated = yield* radius
        .publishVersion(token, destination, title, content)
        .pipe(Effect.mapError(() => failure(uncertain)));
      return { url: destination.url, expiresAt: updated.expiresAt, visibility: "organization" };
    });
    return SessionSharing.of({
      share: Effect.fn("SessionSharing.share")(function* (session) {
        const key = JSON.stringify([session.cwd, session.sessionId]);
        const current = pending.get(key);
        if (current) return yield* Deferred.await(current);
        // Claim before yielding; concurrent requests for this session join the same publication.
        const done = Deferred.makeUnsafe<SessionShare, ShareError>();
        pending.set(key, done);
        yield* publish(session).pipe(
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
