/**
 * What Pi will do in a directory: its project trust, its model catalog and its slash commands.
 * Every caller names a directory in its own spelling (`~/x`, `/home/me/x/`); this module turns it
 * into one path before reading or caching, so one directory has one cache entry. Pi stays the
 * authority (INV-12): trust is read and saved through Pi's own store, and the catalog and
 * commands come from a one-shot Pi probe, cached per directory until something that changes
 * Pi's resources (trust, credentials, defaults, packages, MCP config) invalidates it.
 */
import { homedir } from "node:os";
import { Context, Data, Effect, Layer, PubSub, Semaphore, Stream } from "effect";
import type { ModelCatalog, ModelChoice, ProjectTrust, SlashCommand, ThinkingLevel } from "../shared/wire.ts";
import { directoryPath, enabledModelPatterns } from "./PiEnv.ts";
import { type PiSessionError, PiSessions } from "./PiSessions.ts";
import { type ProjectTrustError, projectTrust, setProjectTrust } from "./ProjectTrust.ts";
import { SessionHosts } from "./SessionHosts.ts";

/** Pi's trust outcome for a directory, with the directory as this module spells it. */
export interface DirectoryTrust {
  readonly cwd: string;
  readonly trust: ProjectTrust;
}

/** `stopped`: the named session is no longer running. `unavailable`: Pi gave no command list. */
export class DirectoryCommandsError extends Data.TaggedError("DirectoryCommandsError")<{
  readonly reason: "stopped" | "unavailable";
  readonly detail: string;
}> {}

export class DirectoryFacts extends Context.Service<
  DirectoryFacts,
  {
    /** What Pi will do with the directory's protected resources when a session starts there. */
    readonly trust: (raw: string) => Effect.Effect<DirectoryTrust>;
    /** The directory's cached model catalog, loading it on first use; `refresh` re-runs the probe. */
    readonly catalog: (raw: string, options?: { readonly refresh?: boolean }) => Effect.Effect<ModelCatalog>;
    /** Global resources only, for machine-wide settings. */
    readonly global: Effect.Effect<ModelCatalog>;
    /**
     * Slash commands. A live session answers from its own child; without `sessionId` the
     * directory's probe does. Discovery never opens a saved session or starts a second writer.
     */
    readonly commands: (raw: string, sessionId?: string) => Effect.Effect<ReadonlyArray<SlashCommand>, DirectoryCommandsError | PiSessionError>;
    /** Save Pi's trust decision for sessions started from now; answers with fresh trust and catalog. */
    readonly setTrust: (raw: string, trusted: boolean) => Effect.Effect<DirectoryTrust & { readonly catalog: ModelCatalog }, ProjectTrustError>;
    /** Pi's resources changed (credentials, defaults, packages, MCP config); every catalog must re-probe. */
    readonly invalidate: Effect.Effect<void>;
    /** Fires after each invalidation; every client re-requests its pickers. */
    readonly changes: Stream.Stream<void>;
  }
>()("piano/DirectoryFacts") {}

function patternMatcher(patterns: string[]): (ref: string, id: string) => boolean {
  const tests = patterns.map((p) => {
    const lowered = p.toLowerCase();
    if (lowered.includes("*")) {
      const re = new RegExp(`^${lowered.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`);
      return (ref: string, id: string) => re.test(ref) || re.test(id);
    }
    return (ref: string, id: string) => ref === lowered || id === lowered;
  });
  return (ref, id) => tests.some((t) => t(ref.toLowerCase(), id.toLowerCase()));
}

const LEVELS: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

/** The same rule Pi applies (pi-ai getSupportedThinkingLevels): a non-reasoning model only has off; a level mapped to null is out; xhigh and max need an explicit mapping. */
function supportedThinkingLevels(m: { reasoning: boolean; thinkingLevelMap?: Record<string, string | null | undefined> }): ThinkingLevel[] {
  if (!m.reasoning) return ["off"];
  return LEVELS.filter((level) => {
    const mapped = m.thinkingLevelMap?.[level];
    if (mapped === null) return false;
    if (level === "xhigh" || level === "max") return mapped !== undefined;
    return true;
  });
}

export const DirectoryFactsLive = Layer.effect(
  DirectoryFacts,
  Effect.gen(function* () {
    const sessions = yield* PiSessions;
    const hosts = yield* SessionHosts;
    // null is the global catalog, separate even from a probe of the same cwd.
    const cache = new Map<string | null, ModelCatalog>();
    const locks = new Map<string | null, Semaphore.Semaphore>();
    const changes = yield* PubSub.sliding<void>(1);
    let epoch = 0;
    const locked = Effect.fn("DirectoryFacts.locked")(function* (key: string | null, refresh = false) {
      let lock = locks.get(key);
      if (!lock) { lock = yield* Semaphore.make(1); locks.set(key, lock); }
      return yield* Semaphore.withPermits(lock, 1)(Effect.suspend(() =>
        !refresh && cache.has(key) ? Effect.succeed(cache.get(key)!) : load(key)));
    });

    const load: (key: string | null) => Effect.Effect<ModelCatalog> = Effect.fn("DirectoryFacts.load")(function* (key: string | null) {
      const loadingEpoch = epoch;
      const cwd = key ?? homedir();
      const probe = yield* sessions.probe(cwd, { globalSettingsOnly: key === null });
      // An invalidation while Pi was starting must not return or cache old defaults.
      if (loadingEpoch !== epoch) return yield* load(key);
      const isEnabled = patternMatcher(key === null ? [] : enabledModelPatterns(cwd));
      const models: ModelChoice[] = probe.models.map((m) => {
        const ref = `${m.provider}/${m.id}`;
        return {
          ref,
          provider: m.provider,
          id: m.id,
          name: m.name,
          reasoning: !!m.reasoning,
          contextWindow: m.contextWindow,
          enabled: isEnabled(ref, m.id),
          thinkingLevels: supportedThinkingLevels(m),
        };
      });
      const catalog: ModelCatalog = {
        cwd, models, commands: probe.commands,
        defaultModel: probe.defaultModel,
        defaultThinkingLevel: probe.defaultThinkingLevel,
        fetchedAt: new Date().toISOString(),
      };
      cache.set(key, catalog);
      return catalog;
    }, (effect, key) => effect.pipe(
      Effect.catchTag("PiSessionError", (e) => {
        const failed: ModelCatalog = { cwd: key ?? homedir(), models: [], fetchedAt: new Date().toISOString(), error: e.detail };
        return Effect.succeed(failed);
      }),
      // A failed probe is not cached, so the next request retries it.
      Effect.tap((c) => Effect.sync(() => { if (c.error) cache.delete(key); })),
      Effect.tap((c) =>
        c.error
          ? Effect.logWarning(`model catalog: ${c.error}`)
          : Effect.logInfo(`${c.models.length} models available, default ${c.defaultModel ?? "(none)"}`),
      ),
    ));

    const invalidate = Effect.sync(() => { epoch++; cache.clear(); }).pipe(Effect.andThen(PubSub.publish(changes, undefined)), Effect.asVoid);
    const trust = (raw: string) => {
      const cwd = directoryPath(raw);
      return Effect.map(projectTrust(cwd), (trust): DirectoryTrust => ({ cwd, trust }));
    };
    const catalog = (raw: string, options?: { readonly refresh?: boolean }) => locked(directoryPath(raw), options?.refresh);

    return DirectoryFacts.of({
      trust,
      catalog,
      global: locked(null),
      commands: Effect.fn("DirectoryFacts.commands")(function* (raw, sessionId) {
        const cwd = directoryPath(raw);
        if (sessionId) {
          const session = yield* hosts.get(cwd, sessionId);
          if (!session) return yield* new DirectoryCommandsError({ reason: "stopped", detail: "Session is no longer running. Reopen the suggestions." });
          const result = yield* session.act({ _tag: "commands" });
          if (result?._tag === "commands") return result.commands;
          return yield* new DirectoryCommandsError({ reason: "unavailable", detail: "Command catalog unavailable." });
        }
        const probed = yield* locked(cwd);
        if (probed.error) return yield* new DirectoryCommandsError({ reason: "unavailable", detail: probed.error });
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
