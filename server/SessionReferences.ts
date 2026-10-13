/**
 * Where a session reference's Pi history is, and whether the session can be opened from it.
 * Registry owns the reference and Pi owns the file (INV-01); this module joins them without
 * moving, merging or repairing either, and reads Pi's files only through PiSessions' `history`.
 * It never starts Pi and holds no ownership lock: SessionHosts calls it under its lock, keyed by
 * the physical checkout returned here (INV-02).
 *
 * A checkout has several spellings: the registry's, the caller's, and its physical path. Pi records
 * each file under the spelling its CLI started in, so history is searched under all of them. An
 * observed realpath is remembered for this server's lifetime, so a removed alias keeps the identity
 * of its checkout; after a restart a missing path is only its own spelling, never a guessed alias.
 */
import { realpath, rm } from "node:fs/promises";
import { Context, Effect, Layer } from "effect";
import { withLastKnownStats } from "../shared/sessionProjection.ts";
import type { SessionReference, SessionStats, Snapshot } from "../shared/wire.ts";
import { directoryPath } from "./PiEnv.ts";
import { PiSessionError, PiSessions } from "./PiSessions.ts";
import { Registry } from "./Registry.ts";

/** A checkout's physical identity, and whether it is gone from disk. */
export interface Checkout {
  readonly physical: string;
  readonly missing: boolean;
}

/** A session reference resolved to its Pi history. */
export interface SessionLocation {
  /** The registry reference's spelling, or the caller's for a session being created. */
  readonly cwd: string;
  readonly sessionId: string;
  /** Physical path of the caller's checkout: the basis of ownership. */
  readonly physical: string;
  /** Pi's file; undefined until Pi writes one. */
  readonly file: string | undefined;
  /** Registry's last known statistics, shown until Pi reads them back. */
  readonly stats: SessionStats | undefined;
  /** The checkout is gone: history stays readable, archivable and deletable, but cannot continue. */
  readonly checkoutMissing: boolean;
}

const rejected = (detail: string) => new PiSessionError({ reason: "rejected", detail });

export const checkoutMissing = rejected(
  "This checkout no longer exists. You can read, archive or delete this session. Restore the checkout at its original path before continuing.",
);

export class SessionReferences extends Context.Service<
  SessionReferences,
  {
    readonly checkout: (cwd: string) => Effect.Effect<Checkout, PiSessionError>;
    /** Fails with `checkoutMissing` when the checkout is gone. */
    readonly requireCheckout: (cwd: string) => Effect.Effect<void, PiSessionError>;
    /**
     * The one registry reference owning this session under any spelling of the caller's checkout,
     * and its Pi file. Refuses an archived, unregistered or (with `create`) already registered
     * session, and conflicting references or files, which are never merged.
     */
    readonly resolve: (
      cwd: string,
      sessionId: string,
      options?: { readonly create?: boolean },
    ) => Effect.Effect<SessionLocation, PiSessionError>;
    /**
     * Why each registered session could not be resolved to history it can continue from: no Pi
     * file under any spelling of its checkout, or a checkout that is gone. Undefined when it can.
     * Observes each checkout once, as `resolve` does, so a caller can ask about many sessions in
     * the background; it is not a lock-held answer, and an open may still refuse for other reasons.
     */
    readonly availability: (
      sessions: ReadonlyArray<{ readonly cwd: string; readonly sessionId: string }>,
    ) => Effect.Effect<(cwd: string, sessionId: string) => SessionReference["unavailable"]>;
    /** The saved conversation without starting Pi, with last known statistics and checkout state. */
    readonly peek: (location: SessionLocation) => Effect.Effect<Snapshot>;
    /** Read-only, redacted JSONL of Pi's saved active branch. */
    readonly exportBranch: (location: SessionLocation) => Effect.Effect<string, PiSessionError>;
    /** Keep the history and hide the reference; an archived session cannot be resolved again. */
    readonly archive: (location: SessionLocation) => Effect.Effect<void, PiSessionError>;
    /** Delete Pi's file, then the reference. Pi must not be running for it. */
    readonly remove: (location: SessionLocation) => Effect.Effect<void, PiSessionError>;
  }
>()("piano/SessionReferences") {}

export const SessionReferencesLive = Layer.effect(
  SessionReferences,
  Effect.gen(function* () {
    const registry = yield* Registry;
    const { history } = yield* PiSessions;
    // Observed aliases for this server lifetime: removing a checkout cannot give an existing
    // child a second ownership key.
    const identities = new Map<string, string>();
    const checkout = (cwd: string) =>
      Effect.tryPromise({
        try: async (): Promise<Checkout> => {
          const path = directoryPath(cwd);
          try {
            const physical = await realpath(path);
            identities.set(path, physical);
            return { physical, missing: false };
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
            return { physical: identities.get(path) ?? path, missing: true };
          }
        },
        catch: (error) => rejected(`Cannot resolve checkout ${cwd}: ${String(error)}`),
      });
    /** A registered checkout and the spellings its history is searched under; shared by resolve and availability. */
    const observe = Effect.fnUntraced(function* (cwd: string) {
      const at = yield* checkout(cwd);
      return { ...at, spellings: new Set([directoryPath(cwd), at.physical]) };
    });

    const resolve = Effect.fn("SessionReferences.resolve")(function* (
      cwd: string,
      sessionId: string,
      options?: { readonly create?: boolean },
    ): Effect.fn.Return<SessionLocation, PiSessionError> {
      const create = options?.create ?? false;
      const { physical } = yield* checkout(cwd);
      const candidates = (yield* registry.get).sessions.filter((s) => s.sessionId === sessionId);
      const matching = [];
      for (const entry of candidates) {
        const path = yield* checkout(entry.cwd).pipe(
          Effect.map((c) => c.physical),
          Effect.orElseSucceed(() => undefined),
        );
        if (path === physical) matching.push(entry);
      }
      if (matching.length > 1)
        return yield* rejected(
          `Conflicting session references for ${sessionId}: ${matching.map((s) => s.cwd).join(", ")}. Keep the original references and resolve the duplicate explicitly; Piano has not merged or moved history.`,
        );
      const entry = matching[0];
      if (entry?.archived)
        return yield* rejected("This session is archived. Start a new session instead.");
      if (!entry && !create)
        return yield* rejected(
          "This session is no longer registered. Refresh the folder list; deleted sessions cannot be restarted.",
        );
      if (entry && create) return yield* rejected("This session ID is already registered.");
      const owner = entry?.cwd ?? directoryPath(cwd);
      const at = yield* observe(owner);
      const located = yield* history.locate(sessionId, [...at.spellings, cwd, physical]);
      if (located._tag === "conflict")
        return yield* rejected(
          `Conflicting Pi files for checkout aliases (${owner}, ${physical}). Piano has not merged or moved history. Resolve the conflicting session ID before starting it.`,
        );
      return {
        cwd: owner,
        sessionId,
        physical,
        file: located._tag === "file" ? located.path : undefined,
        stats: entry?.stats,
        checkoutMissing: at.missing,
      };
    });

    const availability = Effect.fn("SessionReferences.availability")(function* (
      refs: ReadonlyArray<{ readonly cwd: string; readonly sessionId: string }>,
    ) {
      const checkouts = new Map(
        yield* Effect.forEach(
          new Set(refs.map((r) => r.cwd)),
          (cwd) =>
            Effect.gen(function* () {
              // A checkout that cannot be resolved cannot be opened either; its history is still listed under the registry spelling.
              const { missing, spellings } = yield* observe(cwd).pipe(
                Effect.orElseSucceed(() => ({
                  missing: true,
                  spellings: new Set([directoryPath(cwd)]),
                })),
              );
              const ids = yield* Effect.forEach(spellings, history.sessionIds);
              return [cwd, { missing, ids }] as const;
            }),
          { concurrency: 4 },
        ),
      );
      // History is judged first: a session without it cannot be opened even once its checkout is restored.
      return (cwd: string, sessionId: string): SessionReference["unavailable"] => {
        const c = checkouts.get(cwd);
        return !c
          ? undefined
          : !c.ids.some((ids) => ids.has(sessionId))
            ? "history"
            : c.missing
              ? "checkout"
              : undefined;
      };
    });

    const peek = Effect.fn("SessionReferences.peek")(function* (location: SessionLocation) {
      const snapshot = yield* history.peek(location.sessionId, location.file);
      return {
        ...snapshot,
        state: {
          ...withLastKnownStats(snapshot.state, location.stats),
          checkoutMissing: location.checkoutMissing,
        },
      };
    });

    return SessionReferences.of({
      checkout,
      requireCheckout: (cwd) =>
        checkout(cwd).pipe(
          Effect.flatMap(({ missing }) => (missing ? Effect.fail(checkoutMissing) : Effect.void)),
        ),
      resolve,
      availability,
      peek,
      exportBranch: (location) => history.exportBranch(location.sessionId, location.file),
      archive: (location) =>
        registry
          .archiveSession(location.cwd, location.sessionId)
          .pipe(Effect.mapError((e) => rejected(e.detail))),
      remove: Effect.fn("SessionReferences.remove")(function* (location: SessionLocation) {
        const file = location.file;
        if (file)
          yield* Effect.tryPromise({
            try: () => rm(file, { force: true }),
            catch: (error) => rejected(`Could not delete Pi history: ${String(error)}`),
          });
        yield* registry
          .removeSession(location.cwd, location.sessionId)
          .pipe(Effect.mapError((e) => rejected(e.detail)));
      }),
    });
  }),
);
