/** Radius adapter for organization-only artifacts: the official gateway, bearer and redirect
 * rules, response schemas, the canonical-URL allowlist, and artifact identity and visibility
 * checks. Nothing else in Piano knows how Radius phrases an artifact; publication policy lives
 * in SessionSharing.
 */
import { DEFAULT_RADIUS_GATEWAY } from "@earendil-works/pi-ai/providers/radius-config";
import { Context, Data, Effect, Layer, Schema } from "effect";
import type { RadiusShareLink } from "../shared/share.ts";

export class RadiusArtifactsError extends Data.TaggedError("RadiusArtifactsError")<{
  /** `request`: a transport failure, non-OK status or unreadable body. `response`: a reply that
   * is malformed, names an unsafe URL or another artifact. `visibility`: the artifact is no
   * longer organization-only. Never carries a provider body, which may echo secrets. */
  readonly reason: "request" | "response" | "visibility";
  readonly status?: number;
}> {}
const invalid = () => new RadiusArtifactsError({ reason: "response" });

/** One organization-only artifact as Radius confirmed it. */
export interface RadiusArtifact {
  readonly id: string;
  /** Canonical HTTPS URL on a Radius host. */
  readonly url: string;
  readonly expiresAt: string;
  /** False only when Radius says this account cannot add a version. */
  readonly canPublishRevision: boolean;
}

/** The HTTP boundary, replaceable in tests. */
export const RadiusFetch = Context.Reference<typeof fetch>("piano/RadiusFetch", {
  defaultValue: () => globalThis.fetch,
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

export class RadiusArtifacts extends Context.Service<
  RadiusArtifacts,
  {
    /** The Radius organization of the token's account. */
    readonly organization: (token: string) => Effect.Effect<string, RadiusArtifactsError>;
    /** The linked artifact, or undefined only when Radius reports it missing or gone (404/410). */
    readonly lookup: (
      token: string,
      link: RadiusShareLink,
    ) => Effect.Effect<RadiusArtifact | undefined, RadiusArtifactsError>;
    /** A new, empty organization artifact. */
    readonly allocate: (
      token: string,
      title: string,
    ) => Effect.Effect<RadiusArtifact, RadiusArtifactsError>;
    /** Add a version to the linked artifact whose only file is `content` (native JSONL). */
    readonly publishVersion: (
      token: string,
      link: RadiusShareLink,
      title: string,
      content: string,
    ) => Effect.Effect<RadiusArtifact, RadiusArtifactsError>;
  }
>()("piano/RadiusArtifacts") {}

export const RadiusArtifactsLive = Layer.effect(
  RadiusArtifacts,
  Effect.gen(function* () {
    const fetch = yield* RadiusFetch;
    // All requests go to Pi's official Radius gateway, never a URL from a browser or stored link.
    const request = (token: string, path: string, init: RequestInit) =>
      Effect.tryPromise({
        try: async (signal): Promise<unknown> => {
          const response = await fetch(new URL(path, DEFAULT_RADIUS_GATEWAY), {
            ...init,
            redirect: "error",
            headers: { ...init.headers, authorization: `Bearer ${token}` },
            signal,
          });
          if (!response.ok) {
            // Provider bodies may echo tokens or transcript content. Never deliver or log them.
            await response.body?.cancel();
            throw new RadiusArtifactsError({ reason: "request", status: response.status });
          }
          return response.json();
        },
        catch: (error) =>
          error instanceof RadiusArtifactsError
            ? error
            : new RadiusArtifactsError({ reason: "request" }),
      });
    const artifact = Effect.fnUntraced(function* (reply: unknown, expected?: RadiusShareLink) {
      const { artifact } = yield* Schema.decodeUnknownEffect(ArtifactResponse)(reply).pipe(
        Effect.mapError(invalid),
      );
      const link = yield* Effect.try({
        try: () => new URL(artifact.canonical_url),
        catch: invalid,
      });
      if (
        link.protocol !== "https:" ||
        link.username ||
        link.password ||
        link.port ||
        !["radius.pi.dev", "radius.earendil.com"].includes(link.hostname) ||
        !Number.isFinite(Date.parse(artifact.expires_at)) ||
        (expected && (artifact.id !== expected.artifactId || link.href !== expected.url))
      )
        return yield* invalid();
      if (artifact.visibility !== "organization")
        return yield* new RadiusArtifactsError({ reason: "visibility" });
      return {
        id: artifact.id,
        url: link.href,
        expiresAt: artifact.expires_at,
        canPublishRevision: artifact.capabilities?.publish_revision !== false,
      } satisfies RadiusArtifact;
    });
    return RadiusArtifacts.of({
      organization: Effect.fn("RadiusArtifacts.organization")(function* (token) {
        const reply = yield* request(token, "/v1/organization/settings", { method: "GET" });
        const { organization } = yield* Schema.decodeUnknownEffect(OrganizationResponse)(
          reply,
        ).pipe(Effect.mapError(invalid));
        return organization.id;
      }),
      lookup: Effect.fn("RadiusArtifacts.lookup")(function* (token, link) {
        return yield* request(token, `/v1/artifacts/${encodeURIComponent(link.artifactId)}`, {
          method: "GET",
        }).pipe(
          Effect.flatMap((reply) => artifact(reply, link)),
          // Only an explicit missing/gone status reports absence; every other failure stays one.
          Effect.catchIf(
            (error) => error.reason === "request" && (error.status === 404 || error.status === 410),
            () => Effect.succeed(undefined),
          ),
        );
      }),
      allocate: Effect.fn("RadiusArtifacts.allocate")(function* (token, title) {
        const reply = yield* request(token, "/v1/artifacts", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title, visibility: "organization" }),
        });
        return yield* artifact(reply);
      }),
      publishVersion: Effect.fn("RadiusArtifacts.publishVersion")(
        function* (token, link, title, content) {
          // Explicit visibility keeps an update organization-only even if it changes after a
          // lookup. fresh=1 replaces the file set instead of inheriting another member's files.
          const reply = yield* request(
            token,
            `/v1/artifacts/${encodeURIComponent(link.artifactId)}/versions?visibility=organization&fresh=1&title=${encodeURIComponent(title)}`,
            {
              method: "POST",
              headers: { "content-type": "application/x-ndjson" },
              body: content,
            },
          );
          return yield* artifact(reply, link);
        },
      ),
    });
  }),
);
