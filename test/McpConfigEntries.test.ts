import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { McpServerConfig } from "@earendil-works/pi-coding-agent";
import { Effect, Layer } from "effect";
import { DirectoryFacts, DirectoryFactsLive } from "../server/DirectoryFacts.ts";
import {
  authOf,
  type McpAuth,
  type McpCatalogCommandEntry,
  type McpCatalogEntry,
  McpConfigEntries,
  withProviderAuth,
} from "../server/McpConfigEntries.ts";
import { PiSessions } from "../server/PiSessions.ts";

const URL = "https://example.test/mcp";
const DOCS: McpCatalogEntry = { id: "docs", name: "Docs", url: URL };
const COMMAND = "/opt/notes/bin/notes";
const NOTES: McpCatalogCommandEntry = {
  id: "notes",
  name: "Notes",
  command: COMMAND,
  args: ["mcp"],
};
const json = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const save = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value, null, 2));

/** Pi's real loader and writer over a temp agent directory. The real DirectoryFacts runs over a
 * counting probe: a re-probe is the observable effect of invalidation. */
async function fixture(
  run: (
    entries: McpConfigEntries,
    file: string,
    probes: () => Effect.Effect<number>,
  ) => Effect.Effect<void, unknown>,
) {
  const directory = mkdtempSync(join(tmpdir(), "piano-mcp-config-"));
  let count = 0;
  const sessions = Layer.succeed(
    PiSessions,
    PiSessions.of({
      open: () => Effect.die("unused"),
      history: undefined as never,
      probe: () =>
        Effect.sync(() => {
          count++;
          return { models: [], commands: [] };
        }),
    }),
  );
  const cwd = "/nonexistent/piano-mcp-config-catalog";
  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const facts = yield* DirectoryFacts;
        // Loads the catalog (cached unless invalidated) and reports how many probes have run.
        const probes = () => Effect.map(facts.catalog(cwd), () => count);
        yield* run(yield* McpConfigEntries(directory), join(directory, "mcp.json"), probes);
      }).pipe(Effect.provide(DirectoryFactsLive.pipe(Layer.provide(sessions))), Effect.scoped),
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("INV-12: conflicting, malformed and deliberately disabled configuration is blocked and never overwritten", async () => {
  await fixture((entries, file) =>
    Effect.gen(function* () {
      const directory = join(file, "..");
      for (const [text, detail] of [
        ['{"private-malformed-token":', /invalid entries/],
        [
          JSON.stringify({ mcpServers: { docs: { url: "https://other.invalid/mcp" } } }),
          /Another MCP server is named docs/,
        ],
        [
          JSON.stringify({ mcpServers: { one: { url: URL }, two: { url: `${URL}/` } } }),
          /Several MCP entries use Docs's endpoint/,
        ],
        [
          JSON.stringify({ mcpServers: { docs: { url: URL, enabled: false } } }),
          /disabled or hidden/,
        ],
        [
          JSON.stringify({ mcpServers: { docs: { url: URL, exposure: "hidden" } } }),
          /disabled or hidden/,
        ],
      ] as const) {
        writeFileSync(file, text);
        const observed = entries.observe(DOCS);
        assert.equal(observed.status, "blocked");
        assert.match(observed.status === "blocked" ? observed.detail : "", detail);
        assert(!JSON.stringify(observed).includes("private-"));
        assert.equal(
          (yield* Effect.result(entries.save(DOCS, () => ({ url: URL }))))._tag,
          "Failure",
        );
        assert.equal(readFileSync(file, "utf8"), text);
      }
      // A disabled entry is still the reviewed entry: it carries a removal identity.
      const disabled = entries.observe(DOCS);
      assert(
        disabled.status === "blocked" && disabled.entry?.name === "docs" && disabled.removalKey,
      );

      // Pi's switch for all MCP blocks even a missing entry, and an unreadable settings file could hide it.
      save(file, {});
      for (const settings of [JSON.stringify({ extensions: ["-builtin:mcp"] }), "{malformed"]) {
        writeFileSync(join(directory, "settings.json"), settings);
        assert.equal(entries.observe(DOCS).status, "blocked");
        assert.equal(
          (yield* Effect.result(entries.save(DOCS, () => ({ url: URL }))))._tag,
          "Failure",
        );
        assert.deepEqual(json(file), {});
      }
      rmSync(join(directory, "settings.json"));
      assert.deepEqual(entries.observe(DOCS), { status: "missing" });
    }),
  );
});

test("INV-01/12: only the global file counts, so a project entry cannot claim or redirect the catalog entry", async () => {
  await fixture((entries, file) =>
    Effect.gen(function* () {
      const directory = join(file, "..");
      mkdirSync(join(directory, ".pi"));
      save(join(directory, ".pi/mcp.json"), {
        mcpServers: { docs: { url: "https://untrusted.invalid/mcp" }, again: { url: URL } },
      });
      assert.deepEqual(entries.observe(DOCS), { status: "missing" });
      yield* entries.save(DOCS, () => ({ url: URL }));
      assert.deepEqual(json(file), { mcpServers: { docs: { url: URL } } });
      assert.equal(entries.observe(DOCS).status, "ready");
    }),
  );
});

test("INV-12: saving merges under the existing name, keeps unrelated configuration and invalidates only after a write", async () => {
  await fixture((entries, file, probes) =>
    Effect.gen(function* () {
      save(file, {
        custom: { untouched: true },
        mcpServers: { other: { command: "do-not-run" }, mine: { url: `${URL}/`, timeout: 30 } },
      });
      assert.equal(yield* probes(), 1);
      const before = readFileSync(file, "utf8");
      // The caller is satisfied with the existing entry: nothing is written and the catalog stays cached.
      yield* entries.save(DOCS, () => undefined);
      assert.equal(readFileSync(file, "utf8"), before);
      assert.equal(yield* probes(), 1);

      yield* entries.save(DOCS, (existing) => ({
        ...existing?.config,
        url: URL,
        auth: { provider: "docs" },
      }));
      assert.deepEqual(json(file), {
        custom: { untouched: true },
        mcpServers: {
          other: { command: "do-not-run" },
          mine: { url: URL, timeout: 30, auth: { provider: "docs" } },
        },
      });
      assert.equal(yield* probes(), 2, "a write re-probes every directory's catalog");
      const ready = entries.observe(DOCS);
      assert(ready.status === "ready" && ready.entry.name === "mine");
    }),
  );
});

test("INV-01/10: removal targets only the reviewed entry, refuses stale identities and verifies the result", async () => {
  await fixture((entries, file, probes) =>
    Effect.gen(function* () {
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

      for (const text of [
        JSON.stringify({ mcpServers: { docs: { url: "https://unrelated.invalid" } } }),
        "{malformed",
      ]) {
        writeFileSync(file, text);
        assert.equal((yield* Effect.result(entries.remove(DOCS, latest)))._tag, "Failure");
        assert.equal(readFileSync(file, "utf8"), text);
      }
    }),
  );
});

test("INV-12: a local command setup is matched by command and arguments, whatever its entry is named", async () => {
  await fixture((entries, file) =>
    Effect.gen(function* () {
      save(file, {
        custom: { untouched: true },
        mcpServers: {
          // The user renamed the entry and configured it; the other entry runs the CLI differently.
          mine: { command: COMMAND, args: ["mcp"], env: { NOTES_PROFILE: "work" } },
          "notes-dev": { command: COMMAND, args: ["mcp", "--dev"] },
          docs: { url: URL },
        },
      });
      const renamed = entries.observe(NOTES);
      assert(renamed.status === "ready" && renamed.entry.name === "mine");
      // Transports do not cross: an endpoint entry is not this setup, and a command entry is not Docs's.
      const endpoint = entries.observe(DOCS);
      assert(endpoint.status === "ready" && endpoint.entry.name === "docs");

      // Saving merges into the matched entry, under its name, keeping what the user configured.
      yield* entries.save(NOTES, (existing) => ({
        ...existing?.config,
        command: COMMAND,
        args: ["mcp"],
        timeout: 30,
      }));
      assert.deepEqual(json(file).mcpServers.mine, {
        command: COMMAND,
        args: ["mcp"],
        env: { NOTES_PROFILE: "work" },
        timeout: 30,
      });

      // Removal takes the reviewed entry only; the near miss and the endpoint entry stay.
      const key = entries.observe(NOTES).removalKey!;
      assert.equal((yield* entries.remove(NOTES, key)).name, "mine");
      assert.deepEqual(json(file), {
        custom: { untouched: true },
        mcpServers: {
          "notes-dev": { command: COMMAND, args: ["mcp", "--dev"] },
          docs: { url: URL },
        },
      });

      // What is left runs other arguments, so the setup is missing and installs under its catalog name.
      assert.deepEqual(entries.observe(NOTES), { status: "missing" });
      yield* entries.save(NOTES, (existing) =>
        existing ? undefined : { command: COMMAND, args: ["mcp"] },
      );
      assert.deepEqual(json(file).mcpServers.notes, { command: COMMAND, args: ["mcp"] });
      const installed = entries.observe(NOTES);
      assert(installed.status === "ready" && installed.entry.name === "notes");
    }),
  );
});

test("INV-12: a home-relative local command matches Pi's expanded executable and arguments", async () => {
  await fixture((entries, file) =>
    Effect.gen(function* () {
      save(file, {
        mcpServers: { mine: { command: "~/.paper/bin/paper", args: ["mcp", "~/designs"] } },
      });
      const target = {
        id: "paper",
        name: "Paper",
        command: join(homedir(), ".paper/bin/paper"),
        args: ["mcp", join(homedir(), "designs")],
      };
      const observed = entries.observe(target);
      assert(observed.status === "ready" && observed.entry.name === "mine");
      yield* entries.remove(target, observed.removalKey);
      assert.deepEqual(json(file).mcpServers, {});
    }),
  );
});

test("INV-12: several entries running a local command, and another server under its name, are refused", async () => {
  await fixture((entries, file) =>
    Effect.gen(function* () {
      for (const [servers, detail] of [
        [
          { one: { command: COMMAND, args: ["mcp"] }, two: { command: COMMAND, args: ["mcp"] } },
          /Several MCP entries use Notes's command/,
        ],
        [{ notes: { command: "/opt/other/bin/notes", args: ["mcp"] } }, /named notes/],
        [{ notes: { command: COMMAND, args: ["mcp", "--dev"] } }, /named notes/],
        [{ notes: { url: URL } }, /named notes/],
      ] as const) {
        save(file, { mcpServers: servers });
        const text = readFileSync(file, "utf8");
        const observed = entries.observe(NOTES);
        assert.equal(observed.status, "blocked");
        assert.match(observed.status === "blocked" ? observed.detail : "", detail);
        assert.equal(
          (yield* Effect.result(entries.save(NOTES, () => ({ command: COMMAND, args: ["mcp"] }))))
            ._tag,
          "Failure",
        );
        assert.equal(
          readFileSync(file, "utf8"),
          text,
          "nothing the user configured is overwritten",
        );
      }
    }),
  );
});

test("INV-12: Pi's auth order is provider, then Authorization header, then OAuth; provider auth drops competing credentials", () => {
  const cases: [string, McpServerConfig, McpAuth][] = [
    ["stdio", { command: "run", env: { TOKEN: "x" } }, { _tag: "stdio" }],
    ["plain HTTP", { url: URL }, { _tag: "oauth", url: URL }],
    ["OAuth settings", { url: URL, oauth: { clientId: "c" } }, { _tag: "oauth", url: URL }],
    ["other headers", { url: URL, headers: { "X-Key": "k" } }, { _tag: "oauth", url: URL }],
    ["header in any case", { url: URL, headers: { AUTHORIZATION: "t" } }, { _tag: "header" }],
    [
      "provider",
      { url: URL, auth: { provider: "radius" } },
      { _tag: "provider", provider: "radius", competing: false },
    ],
    [
      "provider with a header",
      { url: URL, auth: { provider: "radius" }, headers: { authorization: "t" } },
      { _tag: "provider", provider: "radius", competing: true },
    ],
    [
      "provider with OAuth settings",
      { url: URL, auth: { provider: "radius" }, oauth: { clientId: "c" } },
      { _tag: "provider", provider: "radius", competing: true },
    ],
  ];
  for (const [name, config, auth] of cases) assert.deepEqual(authOf(config), auth, name);

  const configured = withProviderAuth(
    {
      url: `${URL}/`,
      headers: { Authorization: "old", "X-Custom": "keep" },
      oauth: { clientId: "old" },
      timeout: 30,
    },
    URL,
    "radius",
  );
  assert.deepEqual(configured, {
    url: URL,
    headers: { "X-Custom": "keep" },
    auth: { provider: "radius" },
    timeout: 30,
  });
  assert.deepEqual(authOf(configured), { _tag: "provider", provider: "radius", competing: false });
  assert.deepEqual(withProviderAuth(undefined, URL, "radius"), {
    url: URL,
    auth: { provider: "radius" },
  });
});
