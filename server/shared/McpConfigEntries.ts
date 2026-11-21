import { createHash } from "node:crypto";
import { join } from "node:path";
import {
  type McpServerConfig,
  type McpServerEntry,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { Data, Effect } from "effect";
// Pi's MCP config helpers are private imports; replace when a public API exists.
import { validateMcpServerConfig } from "../../node_modules/@earendil-works/pi-coding-agent/dist/core/mcp-servers.js";
import {
  addMcpServerConfig,
  loadMcpConfig,
  removeMcpServerConfig,
} from "../../node_modules/@earendil-works/pi-coding-agent/dist/extensions/mcp/config.js";
import type { McpField } from "../../shared/mcpFields.ts";
import { DirectoryFacts } from "./DirectoryFacts.ts";

export interface McpCatalogEntry {
  readonly id: string;
  readonly name: string;
  readonly url: string;
}

export type McpConfigObservation =
  | { readonly status: "missing"; readonly entry?: undefined; readonly removalKey?: undefined }
  | { readonly status: "ready"; readonly entry: McpServerEntry; readonly removalKey: string }
  | {
      readonly status: "blocked";
      readonly detail: string;
      readonly entry?: McpServerEntry;
      readonly removalKey?: string;
    };

export type McpAuth =
  | { readonly _tag: "stdio" }
  | { readonly _tag: "provider"; readonly provider: string; readonly competing: boolean }
  | { readonly _tag: "header" }
  | { readonly _tag: "oauth"; readonly url: string };

export const isAuthorization = (header: string) => header.toLowerCase() === "authorization";

const offIn = (name: string) =>
  `MCP ${name} is disabled or hidden in Pi. Enable it in Pi before continuing.`;
export const switchedOff = (entry: McpServerEntry, name: string) =>
  entry.config.enabled === false || entry.config.exposure === "hidden" ? offIn(name) : undefined;

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
  readonly field?: string;
}> {}

export interface McpNamedConfig {
  readonly name: string;
  readonly config: unknown;
}

export interface McpConfigEntries {
  readonly list: () => McpServerEntry[];
  readonly problem: () => string | undefined;
  readonly named: (name: string) => McpServerEntry | undefined;
  readonly add: (servers: readonly McpNamedConfig[]) => Effect.Effect<void, McpConfigEntryError>;
  readonly prepare: (server: McpNamedConfig) => McpServerEntry;
  readonly prepareUpdate: (
    name: string,
    removalKey: string,
    rename: string | undefined,
    configure: (existing: McpServerConfig) => McpServerConfig,
  ) => McpServerEntry;
  readonly update: (
    name: string,
    removalKey: string,
    rename: string | undefined,
    configure: (existing: McpServerConfig) => McpServerConfig,
  ) => Effect.Effect<McpServerEntry, McpConfigEntryError>;
  readonly removeNamed: (
    name: string,
    removalKey: string,
    before?: (entry: McpServerEntry) => void,
  ) => Effect.Effect<McpServerEntry, McpConfigEntryError>;
  readonly find: (catalog: McpCatalogEntry) => McpServerEntry | undefined;
  readonly observe: (catalog: McpCatalogEntry) => McpConfigObservation;
  readonly save: (
    catalog: McpCatalogEntry,
    configure: (existing: McpServerEntry | undefined) => McpServerConfig | undefined,
  ) => Effect.Effect<void, McpConfigEntryError>;
  readonly remove: (
    catalog: McpCatalogEntry,
    removalKey: string,
    before?: (entry: McpServerEntry) => void,
  ) => Effect.Effect<McpServerEntry, McpConfigEntryError>;
}

const normalize = (url: string) => url.replace(/\/+$/, "");
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
    if (settings.drainErrors().length)
      throw new Error("Check Pi's settings.json for invalid entries before continuing.");
    return disabled;
  };
  const observe = (catalog: McpCatalogEntry): McpConfigObservation => {
    try {
      const entry = find(catalog);
      const identity = entry && { entry, removalKey: removalKey(entry) };
      const off = builtinDisabled()
        ? offIn(catalog.name)
        : entry && switchedOff(entry, catalog.name);
      if (off) return { status: "blocked", ...identity, detail: off };
      return identity ? { status: "ready", ...identity } : { status: "missing" };
    } catch (cause) {
      return { status: "blocked", detail: message(cause, "Check Pi's global MCP configuration.") };
    }
  };
  const writing = <A>(change: (write: (run: () => void) => void) => A, fallback: string) =>
    Effect.suspend(() => {
      let wrote = false;
      return Effect.try({
        try: () =>
          change((run) => {
            wrote = true;
            run();
          }),
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
  const refuse = (detail: string, field?: McpField) =>
    new McpConfigEntryError({ detail, ...(field ? { field } : {}) });
  const validated = (name: string, raw: unknown) => {
    if (!name.trim()) throw refuse("Enter a name.", "name");
    const result = validateMcpServerConfig(name, raw);
    if (typeof result === "string")
      throw refuse(result, result.startsWith("invalid server name") ? "name" : "config");
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
  const entryOf = (name: string, config: McpServerConfig): McpServerEntry => ({
    name,
    config,
    source: file,
    scope: "global",
  });
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
