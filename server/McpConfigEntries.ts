/** One catalog entry in Pi's global `mcp.json`: finding it, adding or merging it, and removing it.
 * Pi owns the file format and its loader; this module wraps Pi's helpers with the rules both
 * machine-wide setups share (INV-01/12): match a catalog entry by endpoint, refuse duplicates
 * and name clashes, report Pi's disable switches, bind removal to the configuration the user
 * reviewed, and read how Pi authenticates an entry. Callers keep their own policy for what a ready
 * entry must contain. */
import { createHash } from "node:crypto";
import { join } from "node:path";
import {
  type McpServerConfig,
  type McpServerEntry,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { Data, Effect } from "effect";
// Pi 1.4.0 exports neither its MCP configuration loader nor its writer. This is the only import of
// these pinned compatibility dependencies; McpConfigEntries tests exercise the installed helpers.
// Recheck on every Pi upgrade and replace with a public interface when one exists. Do not
// reproduce Pi's loader or move configuration into Registry (INV-01/12).
import { validateMcpServerConfig } from "../node_modules/@earendil-works/pi-coding-agent/dist/core/mcp-servers.js";
import {
  addMcpServerConfig,
  loadMcpConfig,
  removeMcpServerConfig,
} from "../node_modules/@earendil-works/pi-coding-agent/dist/extensions/mcp/config.js";
import { DirectoryFacts } from "./DirectoryFacts.ts";

/** What a setup offers: `id` is the entry's default name, `name` its label, `url` its endpoint.
 * A configured entry is matched by its endpoint, so a renamed entry is still the same setup. */
export interface McpCatalogEntry {
  readonly id: string;
  readonly name: string;
  readonly url: string;
}

/** The entry as Pi would load it. `removalKey` identifies the reviewed configuration. */
export type McpConfigObservation =
  | { readonly status: "missing"; readonly entry?: undefined; readonly removalKey?: undefined }
  | { readonly status: "ready"; readonly entry: McpServerEntry; readonly removalKey: string }
  | {
      readonly status: "blocked";
      readonly detail: string;
      readonly entry?: McpServerEntry;
      readonly removalKey?: string;
    };

/** How Pi authenticates an entry, in Pi's order: a stdio server needs nothing; an HTTP server sends
 * a `/login` provider's token when `auth` names one, else its own `Authorization` header, else
 * signs in with MCP OAuth at its URL. `competing` marks a provider entry that also carries OAuth
 * settings or an `Authorization` header: credentials that would compete with the provider's. */
export type McpAuth =
  | { readonly _tag: "stdio" }
  | { readonly _tag: "provider"; readonly provider: string; readonly competing: boolean }
  | { readonly _tag: "header" }
  | { readonly _tag: "oauth"; readonly url: string };

const isAuthorization = (header: string) => header.toLowerCase() === "authorization";

export const authOf = (config: McpServerConfig): McpAuth => {
  if (!("url" in config)) return { _tag: "stdio" };
  const header = Object.keys(config.headers ?? {}).some(isAuthorization);
  if (config.auth)
    return {
      _tag: "provider",
      provider: config.auth.provider,
      competing: header || !!config.oauth,
    };
  return header ? { _tag: "header" } : { _tag: "oauth", url: config.url };
};

/** `config` (or a new entry) at `url`, authenticated by `provider` alone: the user's other keys
 * are kept; OAuth settings and `Authorization` headers are dropped. */
export const withProviderAuth = (
  config: McpServerConfig | undefined,
  url: string,
  provider: string,
): McpServerConfig => {
  const next: McpServerConfig = { ...config, url, auth: { provider } };
  if ("url" in next) {
    delete next.oauth;
    if (next.headers)
      next.headers = Object.fromEntries(
        Object.entries(next.headers).filter(([key]) => !isAuthorization(key)),
      );
  }
  return next;
};

export class McpConfigEntryError extends Data.TaggedError("McpConfigEntryError")<{
  readonly detail: string;
  /** The form field the refusal belongs to, when a user's input caused it. */
  readonly field?: string;
}> {}

/** A named entry to write, in Pi's `mcpServers` shape as the user or a form supplied it. */
export interface McpNamedConfig {
  readonly name: string;
  readonly config: unknown;
}

export interface McpConfigEntries {
  /** Every global entry in file order. Throws when Pi's configuration is unreadable. */
  readonly list: () => McpServerEntry[];
  /** Why no entry can be used or changed: Pi's MCP switched off, or an unreadable file. */
  readonly problem: () => string | undefined;
  /** The global entry named `name`. Throws when Pi's configuration is unreadable. */
  readonly named: (name: string) => McpServerEntry | undefined;
  /** Adds entries under new names, each validated by Pi, all or none: a taken or repeated name,
   * or an invalid configuration, writes nothing. */
  readonly add: (servers: readonly McpNamedConfig[]) => Effect.Effect<void, McpConfigEntryError>;
  /** The entry `add` would write for `server`, validated by Pi and checked against taken names,
   * without writing it. */
  readonly prepare: (server: McpNamedConfig) => McpServerEntry;
  /** The entry `update` would write, without writing it. */
  readonly prepareUpdate: (
    name: string,
    removalKey: string,
    rename: string | undefined,
    configure: (existing: McpServerConfig) => McpServerConfig,
  ) => McpServerEntry;
  /** Replaces the entry named `name` with `configure(existing)`, under `rename` when given, only
   * while it still matches the reviewed `removalKey`. Pi validates the result. */
  readonly update: (
    name: string,
    removalKey: string,
    rename: string | undefined,
    configure: (existing: McpServerConfig) => McpServerConfig,
  ) => Effect.Effect<McpServerEntry, McpConfigEntryError>;
  /** Removes the entry named `name` only while it still matches the reviewed `removalKey`.
   * `before` runs on the confirmed entry ahead of the write; when it throws, the entry stays. */
  readonly removeNamed: (
    name: string,
    removalKey: string,
    before?: (entry: McpServerEntry) => void,
  ) => Effect.Effect<McpServerEntry, McpConfigEntryError>;
  /** The global entry for `catalog`, matched by endpoint, else by its default name.
   * Throws when Pi's configuration is unreadable or the match is ambiguous. */
  readonly find: (catalog: McpCatalogEntry) => McpServerEntry | undefined;
  readonly observe: (catalog: McpCatalogEntry) => McpConfigObservation;
  /** Writes `configure(existing)` under the existing name, or the default name when missing.
   * `configure` returns undefined when the entry already satisfies the caller; nothing is written. */
  readonly save: (
    catalog: McpCatalogEntry,
    configure: (existing: McpServerEntry | undefined) => McpServerConfig | undefined,
  ) => Effect.Effect<void, McpConfigEntryError>;
  /** Removes the entry only when it still matches the reviewed `removalKey`, and checks it is gone.
   * `before` runs on the confirmed entry ahead of the write; when it throws, the entry stays. */
  readonly remove: (
    catalog: McpCatalogEntry,
    removalKey: string,
    before?: (entry: McpServerEntry) => void,
  ) => Effect.Effect<McpServerEntry, McpConfigEntryError>;
}

const normalize = (url: string) => url.replace(/\/+$/, "");
/** The same setup as `catalog`, whatever the entry is named. */
export const isTarget = (config: McpServerConfig, catalog: McpCatalogEntry) =>
  "url" in config && normalize(config.url) === normalize(catalog.url);
export const removalKey = (entry: McpServerEntry) =>
  createHash("sha256")
    .update(JSON.stringify([entry.name, entry.config]))
    .digest("hex");
const message = (cause: unknown, fallback: string) =>
  cause instanceof Error ? cause.message : fallback;

export const McpConfigEntries = Effect.fn("McpConfigEntries")(function* (
  directory: string,
): Effect.fn.Return<McpConfigEntries, never, DirectoryFacts> {
  const facts = yield* DirectoryFacts;
  const file = join(directory, "mcp.json");
  // Only the global file: Piano writes nowhere else, and a project entry must not redirect a credential.
  const globalEntries = () => {
    const loaded = loadMcpConfig({ agentDir: directory, cwd: directory, projectTrusted: false });
    if (loaded.errors.length)
      throw new Error("Check Pi's global mcp.json for invalid entries before continuing.");
    return loaded.servers.filter((entry) => entry.scope === "global");
  };
  const find = (catalog: McpCatalogEntry) => {
    const entries = globalEntries();
    const matches = entries.filter((entry) => isTarget(entry.config, catalog));
    if (matches.length > 1)
      throw new Error(
        `Several MCP entries use ${catalog.name}'s endpoint. Keep one in Pi's mcp.json before continuing.`,
      );
    const entry = matches[0] ?? entries.find((entry) => entry.name === catalog.id);
    if (entry && !matches.length)
      throw new Error(
        `Another MCP server is named ${catalog.id}. Rename it in Pi before continuing.`,
      );
    return entry;
  };
  const builtinDisabled = () => {
    const settings = SettingsManager.create(directory, directory, { projectTrusted: false });
    const disabled = settings.getGlobalSettings().extensions?.includes("-builtin:mcp");
    // An unreadable settings file would hide a deliberate `-builtin:mcp`.
    if (settings.drainErrors().length)
      throw new Error("Check Pi's settings.json for invalid entries before continuing.");
    return disabled;
  };
  const observe = (catalog: McpCatalogEntry): McpConfigObservation => {
    try {
      const entry = find(catalog);
      const identity = entry && { entry, removalKey: removalKey(entry) };
      if (
        builtinDisabled() ||
        entry?.config.enabled === false ||
        entry?.config.exposure === "hidden"
      ) {
        return {
          status: "blocked",
          ...identity,
          detail: `MCP ${catalog.name} is disabled or hidden in Pi. Enable it in Pi before continuing.`,
        };
      }
      return identity ? { status: "ready", ...identity } : { status: "missing" };
    } catch (cause) {
      return { status: "blocked", detail: message(cause, "Check Pi's global MCP configuration.") };
    }
  };
  /** Runs one synchronous read/merge/write, with no await at which another Piano tab can replace
   * the entry. A change to the file can change every directory's tools and commands, so DirectoryFacts
   * is invalidated once a write was attempted, and only then. */
  const writing = <A>(change: (write: (run: () => void) => void) => A, fallback: string) =>
    Effect.suspend(() => {
      let wrote = false;
      return Effect.try({
        try: () =>
          change((run) => {
            wrote = true;
            run();
          }),
        // A refusal of the user's input keeps its field; anything else reads as the operation's failure.
        catch: (cause) =>
          cause instanceof McpConfigEntryError
            ? cause
            : new McpConfigEntryError({ detail: message(cause, fallback) }),
      }).pipe(Effect.ensuring(Effect.suspend(() => (wrote ? facts.invalidate : Effect.void))));
    });

  const problem = () => {
    try {
      globalEntries();
      return builtinDisabled()
        ? "MCP is switched off in Pi's settings. Enable it in Pi before continuing."
        : undefined;
    } catch (cause) {
      return message(cause, "Check Pi's global MCP configuration.");
    }
  };
  const named = (name: string) => globalEntries().find((entry) => entry.name === name);
  const refuse = (detail: string, field?: string) =>
    new McpConfigEntryError({ detail, ...(field ? { field } : {}) });
  /** Pi's own validation of one entry, as its loader applies it. */
  const validated = (name: string, raw: unknown) => {
    if (!name.trim()) throw refuse("Enter a name.", "name");
    const result = validateMcpServerConfig(name, raw);
    if (typeof result === "string")
      throw refuse(result, result.startsWith("invalid server name") ? "name" : "config");
    // Pi would start an empty command and fail later; the dialog's field is where to say so.
    if ("command" in result && !result.command.trim()) throw refuse("Enter a command.", "config");
    return result;
  };
  const taken = (name: string, except?: string) => {
    if (name !== except && named(name))
      throw refuse(`Another MCP server is named ${name}.`, "name");
  };
  const reviewed = (name: string, key: string) => {
    const entry = named(name);
    if (!entry || removalKey(entry) !== key)
      throw new Error("Configuration changed since confirmation.");
    return entry;
  };
  /** Pi's loader shape for a validated entry, in the only file Piano writes. */
  const entryOf = (name: string, config: McpServerConfig): McpServerEntry => ({
    name,
    config,
    source: file,
    scope: "global",
  });
  /** Runs a check that writes nothing, refusing as `writing` does. */
  const checking = <A>(run: () => A, fallback: string) => {
    try {
      const blocked = problem();
      if (blocked) throw new Error(blocked);
      return run();
    } catch (cause) {
      throw cause instanceof McpConfigEntryError
        ? cause
        : new McpConfigEntryError({ detail: message(cause, fallback) });
    }
  };
  return {
    find,
    observe,
    list: globalEntries,
    prepare: ({ name, config }) =>
      checking(() => {
        taken(name);
        return entryOf(name, validated(name, config));
      }, "Could not read the MCP configuration."),
    prepareUpdate: (name, key, rename, configure) =>
      checking(() => {
        const existing = reviewed(name, key);
        const next = rename ?? name;
        taken(next, name);
        return entryOf(next, validated(next, configure(existing.config)));
      }, "Could not read the MCP configuration."),
    problem,
    named,
    add: (servers) =>
      writing((write) => {
        const blocked = problem();
        if (blocked) throw new Error(blocked);
        const names = new Set<string>();
        const entries = servers.map(({ name, config }) => {
          if (names.has(name)) throw refuse(`${name} is listed twice.`, "name");
          names.add(name);
          taken(name);
          return { name, config: validated(name, config) };
        });
        write(() => {
          for (const { name, config } of entries) addMcpServerConfig(file, name, config);
        });
        for (const { name } of entries)
          if (!named(name)) throw new Error("Configuration was not saved.");
      }, "Could not save the MCP configuration."),
    update: (name, key, rename, configure) =>
      writing((write) => {
        const blocked = problem();
        if (blocked) throw new Error(blocked);
        const existing = reviewed(name, key);
        const next = rename ?? name;
        taken(next, name);
        const config = validated(next, configure(existing.config));
        write(() => {
          if (next !== name) removeMcpServerConfig(file, name);
          addMcpServerConfig(file, next, config);
        });
        const saved = named(next);
        if (!saved || (next !== name && named(name)))
          throw new Error("Configuration was not saved.");
        return saved;
      }, "Could not save the MCP configuration."),
    removeNamed: (name, key, before) =>
      writing((write) => {
        const entry = reviewed(name, key);
        before?.(entry);
        write(() => removeMcpServerConfig(file, name));
        if (named(name)) throw new Error("Removal not verified.");
        return entry;
      }, "Could not remove the MCP configuration."),
    save: (catalog, configure) =>
      writing((write) => {
        const before = observe(catalog);
        if (before.status === "blocked") throw new Error(before.detail);
        const existing = before.status === "ready" ? before.entry : undefined;
        const config = configure(existing);
        // Pi's helper retains unrelated entries, keys and indentation.
        if (config) write(() => addMcpServerConfig(file, existing?.name ?? catalog.id, config));
        if (observe(catalog).status !== "ready") throw new Error("Configuration was not saved.");
      }, "Could not save the MCP configuration."),
    remove: (catalog, key, before) =>
      writing((write) => {
        const entry = find(catalog);
        if (!entry || removalKey(entry) !== key)
          throw new Error("Configuration changed since confirmation.");
        before?.(entry);
        write(() => removeMcpServerConfig(file, entry.name));
        if (find(catalog)) throw new Error("Removal not verified.");
        return entry;
      }, "Could not remove the MCP configuration."),
  };
});
