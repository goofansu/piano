/**
 * What Pi will do in a directory before any session runs there: its project trust, its model
 * catalog and its slash commands. Every caller names a directory in its own spelling (`~/x`,
 * `/home/me/x/`); this module turns it into one path before reading or caching, so one directory
 * has one cache entry. Pi stays the authority (INV-12): trust is read and saved through Pi's own
 * store, and the catalog and commands come from a one-shot Pi probe, already in wire terms,
 * cached per directory until something that changes Pi's resources (trust, credentials,
 * defaults, packages, MCP config) invalidates it. A running session's commands come from that
 * session, not from here.
 */
import { homedir } from "node:os";
import { Context, Data, Effect, Layer, PubSub, Semaphore, Stream } from "effect";
import type { ModelCatalog, ProjectTrust, SlashCommand } from "../shared/wire.ts";
import { directoryPath } from "./PiEnv.ts";
import { PiSessions } from "./PiSessions.ts";
import { type ProjectTrustError, projectTrust, setProjectTrust } from "./ProjectTrust.ts";

/** Pi's trust outcome for a directory, with the directory as this module spells it. */
export interface DirectoryTrust {
  readonly cwd: string;
  readonly trust: ProjectTrust;
}

/** The directory's probe gave no command list; `detail` is Pi's reason. */
export class DirectoryCommandsError extends Data.TaggedError("DirectoryCommandsError")<{
  readonly detail: string;
}> {}

export class DirectoryFacts extends Context.Service<
  DirectoryFacts,
  {
    /** What Pi will do with the directory's protected resources when a session starts there. */
    readonly trust: (raw: string) => Effect.Effect<DirectoryTrust>;
    /** The directory's cached model catalog, loading it on first use; `refresh` re-runs the probe. */
    readonly catalog: (
      raw: string,
      options?: { readonly refresh?: boolean },
    ) => Effect.Effect<ModelCatalog>;
    /** Global resources only, for machine-wide settings. */
    readonly global: Effect.Effect<ModelCatalog>;
    /** Slash commands from the directory's cached probe, for a session not yet started. */
    readonly commands: (
      raw: string,
    ) => Effect.Effect<ReadonlyArray<SlashCommand>, DirectoryCommandsError>;
    /** Save Pi's trust decision for sessions started from now; answers with fresh trust and catalog. */
    readonly setTrust: (
      raw: string,
      trusted: boolean,
    ) => Effect.Effect<DirectoryTrust & { readonly catalog: ModelCatalog }, ProjectTrustError>;
    /** Pi's resources changed (credentials, defaults, packages, MCP config); every catalog must re-probe. */
    readonly invalidate: Effect.Effect<void>;
    /** Fires after each invalidation; every client re-requests its pickers. */
    readonly changes: Stream.Stream<void>;
  }
>()("piano/DirectoryFacts") {}

export const DirectoryFactsLive = Layer.effect(
  DirectoryFacts,
  Effect.gen(function* () {
    const sessions = yield* PiSessions;
    // null is the global catalog, separate even from a probe of the same cwd.
    const cache = new Map<string | null, ModelCatalog>();
    const locks = new Map<string | null, Semaphore.Semaphore>();
    const changes = yield* PubSub.sliding<void>(1);
    let epoch = 0;
    const locked = Effect.fn("DirectoryFacts.locked")(function* (
      key: string | null,
      refresh = false,
    ) {
      let lock = locks.get(key);
      if (!lock) {
        lock = yield* Semaphore.make(1);
        locks.set(key, lock);
      }
      return yield* Semaphore.withPermits(
        lock,
        1,
      )(
        Effect.suspend(() =>
          !refresh && cache.has(key) ? Effect.succeed(cache.get(key)!) : load(key),
        ),
      );
    });

    const load: (key: string | null) => Effect.Effect<ModelCatalog> = Effect.fn(
      "DirectoryFacts.load",
    )(
      function* (key: string | null) {
        const loadingEpoch = epoch;
        const cwd = key ?? homedir();
        const probe = yield* sessions.probe(cwd, { globalSettingsOnly: key === null });
        // An invalidation while Pi was starting must not return or cache old defaults.
        if (loadingEpoch !== epoch) return yield* load(key);
        const catalog: ModelCatalog = {
          cwd,
          models: probe.models,
          commands: probe.commands,
          defaultModel: probe.defaultModel,
          defaultThinkingLevel: probe.defaultThinkingLevel,
          fetchedAt: new Date().toISOString(),
        };
        cache.set(key, catalog);
        return catalog;
      },
      (effect, key) =>
        effect.pipe(
          Effect.catchTag("PiSessionError", (e) => {
            const failed: ModelCatalog = {
              cwd: key ?? homedir(),
              models: [],
              fetchedAt: new Date().toISOString(),
              error: e.detail,
            };
            return Effect.succeed(failed);
          }),
          // A failed probe is not cached, so the next request retries it.
          Effect.tap((c) =>
            Effect.sync(() => {
              if (c.error) cache.delete(key);
            }),
          ),
          Effect.tap((c) =>
            c.error
              ? Effect.logWarning(`model catalog: ${c.error}`)
              : Effect.logInfo(
                  `${c.models.length} models available, default ${c.defaultModel ?? "(none)"}`,
                ),
          ),
        ),
    );

    const invalidate = Effect.sync(() => {
      epoch++;
      cache.clear();
    }).pipe(Effect.andThen(PubSub.publish(changes, undefined)), Effect.asVoid);
    const trust = (raw: string) => {
      const cwd = directoryPath(raw);
      return Effect.map(projectTrust(cwd), (trust): DirectoryTrust => ({ cwd, trust }));
    };
    const catalog = (raw: string, options?: { readonly refresh?: boolean }) =>
      locked(directoryPath(raw), options?.refresh);

    return DirectoryFacts.of({
      trust,
      catalog,
      global: locked(null),
      commands: Effect.fn("DirectoryFacts.commands")(function* (raw) {
        const probed = yield* locked(directoryPath(raw));
        if (probed.error) return yield* new DirectoryCommandsError({ detail: probed.error });
        return probed.commands ?? [];
      }),
      setTrust: Effect.fn("DirectoryFacts.setTrust")(function* (raw, trusted) {
        const cwd = directoryPath(raw);
        yield* setProjectTrust(cwd, trusted);
        // Pi resolves trust from the nearest saved ancestor, so a decision here can change any
        // directory beneath it: every catalog re-probes, not only this one.
        yield* invalidate;
        const { trust: fresh } = yield* trust(cwd);
        return { cwd, trust: fresh, catalog: yield* locked(cwd) };
      }),
      invalidate,
      changes: Stream.fromPubSub(changes),
    });
  }),
);
