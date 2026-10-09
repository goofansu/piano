import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DefaultPackageManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { Effect } from "effect";
import { RadiusSetup, RadiusSetupEnvironment, RadiusSetupLive } from "../server/RadiusSetup.ts";

const PACKAGE = "npm:@earendil-works/pi-radius-web-search";
const URL = "https://radius.pi.dev/mcp";
const json = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const save = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value, null, 2));
type Installer = typeof RadiusSetupEnvironment.Service.install;
async function fixture(run: (setup: RadiusSetup["Service"], directory: string) => Effect.Effect<void, unknown>, install?: Installer) {
  const directory = mkdtempSync(join(tmpdir(), "piano-radius-"));
  try {
    await Effect.runPromise(Effect.gen(function* () { yield* run(yield* RadiusSetup, directory); }).pipe(
      Effect.provide(RadiusSetupLive), Effect.scoped,
      Effect.provideService(RadiusSetupEnvironment, { directory: () => directory, install: install ?? (async () => { throw new Error("Unexpected install"); }) }),
    ));
  } finally { rmSync(directory, { recursive: true, force: true }); }
}
const settled = (setup: RadiusSetup["Service"]) => Effect.gen(function* () {
  for (;;) {
    const state = yield* setup.state;
    if (state.installation.status !== "running") return state;
    yield* Effect.sleep(1);
  }
}).pipe(Effect.timeout("5 seconds"));

// The network/package manager process is the fake boundary. Pi still owns settings
// persistence and package discovery; no fixture writes the user's agent directory.
async function installed(source: string, directory: string) {
  const path = join(directory, "npm/node_modules/@earendil-works/pi-radius-web-search");
  mkdirSync(path, { recursive: true });
  save(join(path, "package.json"), { name: "@earendil-works/pi-radius-web-search", version: "1.0.0", pi: { extensions: [] } });
  const settings = SettingsManager.create(directory, directory, { projectTrusted: false });
  new DefaultPackageManager({ cwd: directory, agentDir: directory, settingsManager: settings }).addSourceToSettings(source);
  await settings.flush();
  assert.deepEqual(settings.drainErrors(), []);
}

test("INV-01/11/12: Radius MCP uses provider auth, preserves unrelated configuration and remains configuration-only", async () => {
  await fixture((setup, directory) => Effect.gen(function* () {
    const file = join(directory, "mcp.json");
    save(file, { autoEnableCodemode: false, custom: { untouched: true }, mcpServers: {
      other: { command: "do-not-run", env: { TOKEN: "private-other-token" } },
      personal: { url: `${URL}/`, headers: { Authorization: "private-old-token", "X-Custom": "keep" }, oauth: { clientId: "old" }, exposure: "deferred", toolExposure: { "delete_*": "hidden" }, timeout: 30 },
    } });
    assert.equal((yield* setup.state).mcp.status, "missing");
    assert.equal((yield* setup.configureMcp).mcp.status, "ready");
    const actual = json(file);
    assert.deepEqual(actual, { autoEnableCodemode: false, custom: { untouched: true }, mcpServers: {
      other: { command: "do-not-run", env: { TOKEN: "private-other-token" } },
      personal: { url: URL, headers: { "X-Custom": "keep" }, auth: { provider: "radius" }, exposure: "deferred", toolExposure: { "delete_*": "hidden" }, timeout: 30 },
    } });
    const before = readFileSync(file, "utf8");
    yield* setup.configureMcp;
    assert.equal(readFileSync(file, "utf8"), before);
    assert(!JSON.stringify(yield* setup.state).includes("private-"));
    // Only global config is considered; even a project entry cannot redirect a token.
    mkdirSync(join(directory, ".pi"));
    save(join(directory, ".pi/mcp.json"), { mcpServers: { personal: { url: "https://untrusted.invalid/mcp" } } });
    assert.equal((yield* setup.state).mcp.status, "ready");
  }));
});

test("Radius setup refuses conflicts, malformed files and deliberate disabled policies without overwriting them", async () => {
  await fixture((setup, directory) => Effect.gen(function* () {
    const file = join(directory, "mcp.json");
    for (const text of [
      '{"private-malformed-token":',
      JSON.stringify({ mcpServers: { radius: { url: "https://other.invalid/mcp" } } }),
      JSON.stringify({ mcpServers: { one: { url: URL }, two: { url: URL } } }),
      JSON.stringify({ mcpServers: { radius: { url: URL, enabled: false } } }),
      JSON.stringify({ mcpServers: { radius: { url: URL, exposure: "hidden" } } }),
    ]) {
      writeFileSync(file, text);
      assert.equal((yield* setup.state).mcp.status, "blocked");
      assert.equal((yield* Effect.result(setup.configureMcp))._tag, "Failure");
      assert.equal(readFileSync(file, "utf8"), text);
      assert(!JSON.stringify(yield* setup.state).includes("private-"));
    }
    save(file, {});
    save(join(directory, "settings.json"), { extensions: ["-builtin:mcp"] });
    assert.equal((yield* setup.state).mcp.status, "blocked");
    assert.equal((yield* Effect.result(setup.configureMcp))._tag, "Failure");
    rmSync(join(directory, "settings.json"));
    assert.equal((yield* setup.configureMcp).mcp.status, "ready");
    assert.deepEqual(json(file), { mcpServers: { radius: { url: URL, auth: { provider: "radius" } } } });
  }));
});

test("INV-02/11: installation survives observers, deduplicates requests and preserves pinned sources and unrelated settings", async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const sources: string[] = [];
  await fixture((setup, directory) => Effect.gen(function* () {
    save(join(directory, "settings.json"), { defaultProvider: "fake", packages: ["/unrelated-package", `${PACKAGE}@1.0.0`] });
    assert.equal((yield* setup.installWebSearch).installation.status, "running");
    assert.equal((yield* setup.installWebSearch).installation.status, "running");
    assert.equal((yield* setup.state).installation.status, "running");
    release();
    const state = yield* settled(setup);
    assert.equal(state.installation.status, "success");
    assert.equal(state.webSearch.status, "ready");
    assert.deepEqual(sources, [`${PACKAGE}@1.0.0`]);
    assert.deepEqual(json(join(directory, "settings.json")), { defaultProvider: "fake", packages: ["/unrelated-package", `${PACKAGE}@1.0.0`] });
    yield* setup.installWebSearch;
    assert.equal(sources.length, 1);
  }), async (source, directory) => { sources.push(source); await gate; await installed(source, directory); });
});

test("Installation failures are sanitized and retryable; success requires observed package persistence", async () => {
  let attempts = 0;
  await fixture((setup, directory) => Effect.gen(function* () {
    yield* setup.installWebSearch;
    const failure = yield* settled(setup);
    assert.equal(failure.installation.status, "error");
    assert(!JSON.stringify(failure).includes("private-"));
    yield* setup.installWebSearch;
    assert.equal((yield* settled(setup)).installation.status, "error", "exit success without a package is not installed");
    yield* setup.installWebSearch;
    assert.equal((yield* settled(setup)).webSearch.status, "ready");
    assert.equal(attempts, 3);
    save(join(directory, "settings.json"), { packages: [{ source: PACKAGE, extensions: [] }] });
    const filtered = readFileSync(join(directory, "settings.json"), "utf8");
    assert.equal((yield* setup.state).webSearch.status, "blocked");
    assert.equal((yield* Effect.result(setup.installWebSearch))._tag, "Failure");
    assert.equal(readFileSync(join(directory, "settings.json"), "utf8"), filtered);
    writeFileSync(join(directory, "settings.json"), "malformed-private-token");
    assert.equal((yield* setup.state).webSearch.status, "blocked");
  }), async (source, directory) => {
    attempts++;
    if (attempts === 1) throw new Error("private-installer-token");
    if (attempts === 3) await installed(source, directory);
  });
});

test("INV-02: stopping the service aborts only its installer and waits for cleanup", async () => {
  let aborted = false;
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  await fixture(setup => Effect.gen(function* () {
    yield* setup.installWebSearch;
    yield* Effect.promise(() => ready);
  }), (_source, _directory, signal) => new Promise<void>((_resolve, reject) => {
    signal.addEventListener("abort", () => { aborted = true; reject(new Error("cancelled")); }, { once: true });
    started();
  }));
  assert.equal(aborted, true);
});
