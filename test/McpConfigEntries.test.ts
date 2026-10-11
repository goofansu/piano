import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Effect, Layer } from "effect";
import { DirectoryFacts, DirectoryFactsLive } from "../server/DirectoryFacts.ts";
import { type McpCatalogEntry, McpConfigEntries } from "../server/McpConfigEntries.ts";
import { PiSessions } from "../server/PiSessions.ts";

const URL = "https://example.test/mcp";
const DOCS: McpCatalogEntry = { id: "docs", name: "Docs", url: URL };
const json = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const save = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value, null, 2));

/** Pi's real loader and writer over a temp agent directory. The real DirectoryFacts runs over a
 * counting probe: a re-probe is the observable effect of invalidation. */
async function fixture(run: (entries: McpConfigEntries, file: string, probes: () => Effect.Effect<number>) => Effect.Effect<void, unknown>) {
  const directory = mkdtempSync(join(tmpdir(), "piano-mcp-config-"));
  let count = 0;
  const sessions = Layer.succeed(PiSessions, PiSessions.of({
    open: () => Effect.die("unused"),
    probe: () => Effect.sync(() => { count++; return { models: [], commands: [] }; }),
  }));
  const cwd = "/nonexistent/piano-mcp-config-catalog";
  try {
    await Effect.runPromise(Effect.gen(function* () {
      const facts = yield* DirectoryFacts;
      // Loads the catalog (cached unless invalidated) and reports how many probes have run.
      const probes = () => Effect.map(facts.catalog(cwd), () => count);
      yield* run(yield* McpConfigEntries(directory), join(directory, "mcp.json"), probes);
    }).pipe(Effect.provide(DirectoryFactsLive.pipe(Layer.provide(sessions))), Effect.scoped));
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

test("INV-12: conflicting, malformed and deliberately disabled configuration is blocked and never overwritten", async () => {
  await fixture((entries, file) => Effect.gen(function* () {
    const directory = join(file, "..");
    for (const [text, detail] of [
      ['{"private-malformed-token":', /invalid entries/],
      [JSON.stringify({ mcpServers: { docs: { url: "https://other.invalid/mcp" } } }), /Another MCP server is named docs/],
      [JSON.stringify({ mcpServers: { one: { url: URL }, two: { url: `${URL}/` } } }), /Several MCP entries use Docs's endpoint/],
      [JSON.stringify({ mcpServers: { docs: { url: URL, enabled: false } } }), /disabled or hidden/],
      [JSON.stringify({ mcpServers: { docs: { url: URL, exposure: "hidden" } } }), /disabled or hidden/],
    ] as const) {
      writeFileSync(file, text);
      const observed = entries.observe(DOCS);
      assert.equal(observed.status, "blocked");
      assert.match(observed.status === "blocked" ? observed.detail : "", detail);
      assert(!JSON.stringify(observed).includes("private-"));
      assert.equal((yield* Effect.result(entries.save(DOCS, () => ({ url: URL }))))._tag, "Failure");
      assert.equal(readFileSync(file, "utf8"), text);
    }
    // A disabled entry is still the reviewed entry: it carries a removal identity.
    const disabled = entries.observe(DOCS);
    assert(disabled.status === "blocked" && disabled.entry?.name === "docs" && disabled.removalKey);

    // Pi's switch for all MCP blocks even a missing entry, and an unreadable settings file could hide it.
    save(file, {});
    for (const settings of [JSON.stringify({ extensions: ["-builtin:mcp"] }), "{malformed"]) {
      writeFileSync(join(directory, "settings.json"), settings);
      assert.equal(entries.observe(DOCS).status, "blocked");
      assert.equal((yield* Effect.result(entries.save(DOCS, () => ({ url: URL }))))._tag, "Failure");
      assert.deepEqual(json(file), {});
    }
    rmSync(join(directory, "settings.json"));
    assert.deepEqual(entries.observe(DOCS), { status: "missing" });
  }));
});

test("INV-01/12: only the global file counts, so a project entry cannot claim or redirect the catalog entry", async () => {
  await fixture((entries, file) => Effect.gen(function* () {
    const directory = join(file, "..");
    mkdirSync(join(directory, ".pi"));
    save(join(directory, ".pi/mcp.json"), { mcpServers: { docs: { url: "https://untrusted.invalid/mcp" }, again: { url: URL } } });
    assert.deepEqual(entries.observe(DOCS), { status: "missing" });
    yield* entries.save(DOCS, () => ({ url: URL }));
    assert.deepEqual(json(file), { mcpServers: { docs: { url: URL } } });
    assert.equal(entries.observe(DOCS).status, "ready");
  }));
});

test("INV-12: saving merges under the existing name, keeps unrelated configuration and invalidates only after a write", async () => {
  await fixture((entries, file, probes) => Effect.gen(function* () {
    save(file, { custom: { untouched: true }, mcpServers: { other: { command: "do-not-run" }, mine: { url: `${URL}/`, timeout: 30 } } });
    assert.equal(yield* probes(), 1);
    const before = readFileSync(file, "utf8");
    // The caller is satisfied with the existing entry: nothing is written and the catalog stays cached.
    yield* entries.save(DOCS, () => undefined);
    assert.equal(readFileSync(file, "utf8"), before);
    assert.equal(yield* probes(), 1);

    yield* entries.save(DOCS, existing => ({ ...existing?.config, url: URL, auth: { provider: "docs" } }));
    assert.deepEqual(json(file), { custom: { untouched: true }, mcpServers: { other: { command: "do-not-run" }, mine: { url: URL, timeout: 30, auth: { provider: "docs" } } } });
    assert.equal(yield* probes(), 2, "a write re-probes every directory's catalog");
    const ready = entries.observe(DOCS);
    assert(ready.status === "ready" && ready.entry.name === "mine");
  }));
});

test("INV-01/10: removal targets only the reviewed entry, refuses stale identities and verifies the result", async () => {
  await fixture((entries, file, probes) => Effect.gen(function* () {
    const other = { command: "do-not-run", env: { TOKEN: "private-other" } };
    save(file, { custom: "keep", mcpServers: { mine: { url: URL, enabled: false }, other } });
    const reviewed = entries.observe(DOCS).removalKey!;
    assert(reviewed);
    // Another tab or editor changed the entry after the confirmation opened.
    save(file, { custom: "keep", mcpServers: { mine: { url: URL, exposure: "hidden" }, other } });
    yield* probes();
    const stale = yield* Effect.flip(entries.remove(DOCS, reviewed));
    assert.match(stale.detail, /changed since confirmation/);
    assert(json(file).mcpServers.mine);
    assert.equal(yield* probes(), 1, "a refused removal writes nothing");

    const latest = entries.observe(DOCS).removalKey!;
    assert.notEqual(latest, reviewed);
    assert.equal((yield* entries.remove(DOCS, latest)).name, "mine");
    assert.deepEqual(json(file), { custom: "keep", mcpServers: { other } });
    assert.deepEqual(entries.observe(DOCS), { status: "missing" });
    assert.equal(yield* probes(), 2);
    assert.equal((yield* Effect.result(entries.remove(DOCS, latest)))._tag, "Failure");

    for (const text of [JSON.stringify({ mcpServers: { docs: { url: "https://unrelated.invalid" } } }), "{malformed"]) {
      writeFileSync(file, text);
      assert.equal((yield* Effect.result(entries.remove(DOCS, latest)))._tag, "Failure");
      assert.equal(readFileSync(file, "utf8"), text);
    }
  }));
});
