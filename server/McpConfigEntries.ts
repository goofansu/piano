/** One catalog entry in Pi's global `mcp.json`: finding it, adding or merging it, and removing it.
 * Pi owns the file format and its loader; this module wraps Pi's helpers with the rules both
 * machine-wide setups share (INV-01/12): match by endpoint, refuse duplicates and name clashes,
 * report Pi's disable switches, and bind removal to the configuration the user reviewed.
 * Callers keep their own policy for what a ready entry must contain. */
import { createHash } from "node:crypto";
import { join } from "node:path";
import { type McpServerConfig, type McpServerEntry, SettingsManager } from "@earendil-works/pi-coding-agent";
import { Data, Effect } from "effect";
// Pi 1.1.0 exports neither its MCP configuration loader nor its writer. This is the only import of
// these pinned compatibility dependencies; McpConfigEntries tests exercise the installed helpers.
// Recheck on every Pi upgrade and replace with a public interface when one exists. Do not
// reproduce Pi's loader or move configuration into Registry (INV-01/12).
import { addMcpServerConfig, loadMcpConfig, removeMcpServerConfig } from "../node_modules/@earendil-works/pi-coding-agent/dist/extensions/mcp/config.js";
import { DirectoryFacts } from "./DirectoryFacts.ts";

/** What a setup offers: `id` is the entry's default name, `name` its label, `url` its endpoint. */
export interface McpCatalogEntry {
  readonly id: string;
  readonly name: string;
  readonly url: string;
}

/** The entry as Pi would load it. `removalKey` identifies the reviewed configuration. */
export type McpConfigObservation =
  | { readonly status: "missing"; readonly entry?: undefined; readonly removalKey?: undefined }
  | { readonly status: "ready"; readonly entry: McpServerEntry; readonly removalKey: string }
  | { readonly status: "blocked"; readonly detail: string; readonly entry?: McpServerEntry; readonly removalKey?: string };

export class McpConfigEntryError extends Data.TaggedError("McpConfigEntryError")<{ readonly detail: string }> {}

export interface McpConfigEntries {
  /** The global entry for `catalog`, matched by endpoint, else by its default name. Throws when
   * Pi's configuration is unreadable or the match is ambiguous. */
  readonly find: (catalog: McpCatalogEntry) => McpServerEntry | undefined;
  readonly observe: (catalog: McpCatalogEntry) => McpConfigObservation;
  /** Writes `configure(existing)` under the existing name, or the default name when missing.
   * `configure` returns undefined when the entry already satisfies the caller; nothing is written. */
  readonly save: (catalog: McpCatalogEntry, configure: (existing: McpServerEntry | undefined) => McpServerConfig | undefined) => Effect.Effect<void, McpConfigEntryError>;
  /** Removes the entry only when it still matches the reviewed `removalKey`, and checks it is gone. */
  readonly remove: (catalog: McpCatalogEntry, removalKey: string) => Effect.Effect<McpServerEntry, McpConfigEntryError>;
}

const normalize = (url: string) => url.replace(/\/+$/, "");
const removalKey = (entry: McpServerEntry) => createHash("sha256").update(JSON.stringify([entry.name, entry.config])).digest("hex");
const message = (cause: unknown, fallback: string) => cause instanceof Error ? cause.message : fallback;

export const McpConfigEntries = Effect.fn("McpConfigEntries")(function* (directory: string): Effect.fn.Return<McpConfigEntries, never, DirectoryFacts> {
  const facts = yield* DirectoryFacts;
  const file = join(directory, "mcp.json");
  // Only the global file: Piano writes nowhere else, and a project entry must not redirect a credential.
  const globalEntries = () => {
    const loaded = loadMcpConfig({ agentDir: directory, cwd: directory, projectTrusted: false });
    if (loaded.errors.length) throw new Error("Check Pi's global mcp.json for invalid entries before continuing.");
    return loaded.servers.filter(entry => entry.scope === "global");
  };
  const find = (catalog: McpCatalogEntry) => {
    const entries = globalEntries();
    const matches = entries.filter(entry => "url" in entry.config && normalize(entry.config.url) === normalize(catalog.url));
    if (matches.length > 1) throw new Error(`Several MCP entries use ${catalog.name}'s endpoint. Keep one in Pi's mcp.json before continuing.`);
    const entry = matches[0] ?? entries.find(entry => entry.name === catalog.id);
    if (entry && !matches.length) throw new Error(`Another MCP server is named ${catalog.id}. Rename it in Pi before continuing.`);
    return entry;
  };
  const builtinDisabled = () => {
    const settings = SettingsManager.create(directory, directory, { projectTrusted: false });
    const disabled = settings.getGlobalSettings().extensions?.includes("-builtin:mcp");
    // An unreadable settings file would hide a deliberate `-builtin:mcp`.
    if (settings.drainErrors().length) throw new Error("Check Pi's settings.json for invalid entries before continuing.");
    return disabled;
  };
  const observe = (catalog: McpCatalogEntry): McpConfigObservation => {
    try {
      const entry = find(catalog);
      const identity = entry && { entry, removalKey: removalKey(entry) };
      if (builtinDisabled() || entry?.config.enabled === false || entry?.config.exposure === "hidden") {
        return { status: "blocked", ...identity, detail: `${catalog.name} MCP is disabled or hidden in Pi. Enable it in Pi before continuing.` };
      }
      return identity ? { status: "ready", ...identity } : { status: "missing" };
    } catch (cause) {
      return { status: "blocked", detail: message(cause, "Check Pi's global MCP configuration.") };
    }
  };
  /** Runs one synchronous read/merge/write, with no await at which another Piano tab can replace
   * the entry. A change to the file can change every directory's tools and commands, so DirectoryFacts
   * is invalidated once a write was attempted, and only then. */
  const writing = <A>(change: (write: (run: () => void) => void) => A, fallback: string) => Effect.suspend(() => {
    let wrote = false;
    return Effect.try({
      try: () => change(run => { wrote = true; run(); }),
      catch: cause => new McpConfigEntryError({ detail: message(cause, fallback) }),
    }).pipe(Effect.ensuring(Effect.suspend(() => wrote ? facts.invalidate : Effect.void)));
  });

  return {
    find,
    observe,
    save: (catalog, configure) => writing(write => {
      const before = observe(catalog);
      if (before.status === "blocked") throw new Error(before.detail);
      const existing = before.status === "ready" ? before.entry : undefined;
      const config = configure(existing);
      // Pi's helper retains unrelated entries, keys and indentation.
      if (config) write(() => addMcpServerConfig(file, existing?.name ?? catalog.id, config));
      if (observe(catalog).status !== "ready") throw new Error("Configuration was not saved.");
    }, "Could not save the MCP configuration."),
    remove: (catalog, key) => writing(write => {
      const entry = find(catalog);
      if (!entry || removalKey(entry) !== key) throw new Error("Configuration changed since confirmation.");
      write(() => removeMcpServerConfig(file, entry.name));
      if (find(catalog)) throw new Error("Removal not verified.");
      return entry;
    }, "Could not remove the MCP configuration."),
  };
});
