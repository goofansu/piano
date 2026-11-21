import { realpath, rm } from "node:fs/promises";
import { Context, Effect, Layer } from "effect";
import { directoryPath } from "../../../server/shared/PiEnv.ts";
import { Registry, type SessionEntry } from "../../../server/shared/registry/Registry.ts";
import { withLastKnownStats } from "../../../shared/session/sessionProjection.ts";
import {
  type SessionReference,
  type SessionStats,
  type Snapshot,
  sessionKey,
} from "../../../shared/wire.ts";
import { PiSessionError, PiSessions } from "./pi/PiSessions.ts";

export interface Checkout {
  readonly physical: string;
  readonly missing: boolean;
}

export interface SessionLocation {
  readonly cwd: string;
  readonly sessionId: string;
  readonly physical: string;
  readonly file: string | undefined;
  readonly stats: SessionStats | undefined;
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
    readonly requireCheckout: (cwd: string) => Effect.Effect<void, PiSessionError>;
    readonly resolve: (
      cwd: string,
      sessionId: string,
      options?: { readonly create?: boolean; readonly confirmAbsent?: boolean },
    ) => Effect.Effect<SessionLocation, PiSessionError>;
    readonly canonical: Effect.Effect<
      ReadonlyArray<{ readonly key: string; readonly entry: SessionEntry }>
    >;
    readonly availability: (
      sessions: ReadonlyArray<{ readonly cwd: string; readonly sessionId: string }>,
    ) => Effect.Effect<(cwd: string, sessionId: string) => SessionReference["unavailable"]>;
    readonly peek: (location: SessionLocation) => Effect.Effect<Snapshot>;
    readonly archive: (location: SessionLocation) => Effect.Effect<void, PiSessionError>;
    readonly unarchive: (cwd: string, sessionId: string) => Effect.Effect<string, PiSessionError>;
    readonly remove: (location: SessionLocation) => Effect.Effect<void, PiSessionError>;
  }
>()("piano/SessionReferences") {}

export const SessionReferencesLive = Layer.effect(
  SessionReferences,
  Effect.gen(function* () {
    const registry = yield* Registry;
    const { history } = yield* PiSessions;
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
    const observe = Effect.fnUntraced(function* (cwd: string) {
      const at = yield* checkout(cwd);
      return { ...at, spellings: new Set([directoryPath(cwd), at.physical]) };
    });

    const grouped = Effect.fnUntraced(function* (entries: ReadonlyArray<SessionEntry>) {
      const groups = new Map<string, SessionEntry[]>();
      for (const entry of entries) {
        const at = yield* checkout(entry.cwd).pipe(Effect.option);
        if (at._tag === "None") continue;
        const key = sessionKey(at.value.physical, entry.sessionId);
        const group = groups.get(key);
        if (group) group.push(entry);
        else groups.set(key, [entry]);
      }
      return groups;
    });

    const reference = Effect.fn("SessionReferences.reference")(function* (
      cwd: string,
      sessionId: string,
    ) {
      const { physical } = yield* checkout(cwd);
      const candidates = (yield* registry.get).sessions.filter((s) => s.sessionId === sessionId);
      const matching = (yield* grouped(candidates)).get(sessionKey(physical, sessionId)) ?? [];
      if (matching.length > 1)
        return yield* rejected(
          `Conflicting session references for ${sessionId}: ${matching.map((s) => s.cwd).join(", ")}. Keep the original references and resolve the duplicate explicitly; Piano has not merged or moved history.`,
        );
      return { entry: matching[0], physical };
    });

    const resolve = Effect.fn("SessionReferences.resolve")(function* (
      cwd: string,
      sessionId: string,
      options?: { readonly create?: boolean; readonly confirmAbsent?: boolean },
    ): Effect.fn.Return<SessionLocation, PiSessionError> {
      const create = options?.create ?? false;
      const { entry, physical } = yield* reference(cwd, sessionId);
      if (entry?.archived)
        return yield* rejected(
          "This session is archived. Unarchive it in Settings → Data controls.",
        );
      if (!entry && !create)
        return yield* rejected(
          "This session is no longer registered. Refresh the folder list; deleted sessions cannot be restarted.",
        );
      if (entry && create) return yield* rejected("This session ID is already registered.");
      const owner = entry?.cwd ?? directoryPath(cwd);
      const at = yield* observe(owner);
      const located = yield* history.locate(sessionId, [...at.spellings, cwd, physical], options);
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

    const canonical = Effect.gen(function* () {
      const groups = yield* grouped((yield* registry.get).sessions);
      return [...groups].flatMap(([key, [entry, ...conflicts]]) =>
        entry && conflicts.length === 0 ? [{ key, entry }] : [],
      );
    }).pipe(Effect.withSpan("SessionReferences.canonical"));

    const availability = Effect.fn("SessionReferences.availability")(function* (
      refs: ReadonlyArray<{ readonly cwd: string; readonly sessionId: string }>,
    ) {
      const checkouts = new Map(
        yield* Effect.forEach(
          new Set(refs.map((r) => r.cwd)),
          (cwd) =>
            Effect.gen(function* () {
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
      canonical,
      availability,
      peek,
      archive: (location) =>
        registry
          .archiveSession(location.cwd, location.sessionId)
          .pipe(Effect.mapError((e) => rejected(e.detail))),
      unarchive: Effect.fn("SessionReferences.unarchive")(function* (cwd, sessionId) {
        const { entry } = yield* reference(cwd, sessionId);
        if (!entry?.archived)
          return yield* rejected("Session reference is unavailable. Refresh and try again.");
        yield* registry
          .unarchiveSession(entry.cwd, sessionId)
          .pipe(Effect.mapError((e) => rejected(e.detail)));
        return entry.cwd;
      }),
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
