import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { Effect, Layer } from "effect";
import { DirectoryFacts, DirectoryFactsLive } from "../server/DirectoryFacts.ts";
import { PiSessions } from "../server/PiSessions.ts";
import { ProviderLogin, ProviderLoginLive, ProviderLoginRuntime } from "../server/ProviderLogin.ts";
import type { ProviderLoginState } from "../shared/wire.ts";

type Login = NonNullable<NonNullable<ReturnType<ModelRuntime["getProvider"]>>["auth"]["oauth"]>["login"];
const until = (login: ProviderLogin["Service"], predicate: (state: ProviderLoginState) => boolean) => Effect.gen(function* () {
  for (;;) {
    const state = yield* login.state;
    if (state && predicate(state)) return state;
    yield* Effect.sleep(1);
  }
}).pipe(Effect.timeout("3 seconds"));

type Probes = { catalog: DirectoryFacts["Service"]; count: () => number };
async function fixture(flow: Login, run: (login: ProviderLogin["Service"], authPath: string, probes: Probes) => Effect.Effect<void, unknown>) {
  const root = mkdtempSync(join(tmpdir(), "piano-login-"));
  const authPath = join(root, "auth.json");
  writeFileSync(authPath, JSON.stringify({ openai: { type: "api_key", key: "existing-key" } }));
  const runtime = await ModelRuntime.create({ authPath, modelsPath: null, modelsStorePath: join(root, "models-cache.json"), refreshOnCreate: false });
  const radius = runtime.getProvider("radius")!;
  runtime.registerNativeProvider({ ...radius, auth: { oauth: { ...radius.auth.oauth!, login: flow } } });
  // The real DirectoryFacts over a counting probe: a re-probe is the observable effect of invalidation.
  let count = 0;
  const sessions = Layer.succeed(PiSessions, PiSessions.of({
    open: () => Effect.die("unused"),
    probe: () => Effect.sync(() => { count++; return { models: [], commands: [] }; }),
  }));
  try {
    await Effect.runPromise(Effect.gen(function* () { yield* run(yield* ProviderLogin, authPath, { catalog: yield* DirectoryFacts, count: () => count }); }).pipe(
      Effect.provide(ProviderLoginLive.pipe(Layer.provideMerge(DirectoryFactsLive), Layer.provide(sessions))), Effect.scoped,
      Effect.provideService(ProviderLoginRuntime, { create: async () => runtime, deviceId: () => "f24f9f2a-a49e-46d0-99a3-402c03b548f5" }),
    ));
  } finally { rmSync(root, { recursive: true, force: true }); }
}

test("INV-01/11/12: OAuth interactions relay through Pi, persist credentials through Pi and never expose tokens", async () => {
  await fixture(async interaction => {
    const method = await interaction.prompt({ type: "select", message: "Method", options: [{ id: "device", label: "Device code" }] });
    assert.equal(method, "device");
    interaction.notify({ type: "device_code", userCode: "ABCD", verificationUri: "https://example.invalid/login" });
    const answer = await interaction.prompt({ type: "manual_code", message: "Paste code" });
    assert.equal(answer, "one-use-code");
    return { type: "oauth", access: "private-access-token", refresh: "private-refresh-token", expires: Date.now() + 3600_000 };
  }, (login, authPath) => Effect.gen(function* () {
    const providers = yield* login.providers;
    assert.deepEqual(providers.map(p => [p.id, p.name]), [
      ["anthropic", "Anthropic"],
      ["github-copilot", "GitHub Copilot"],
      ["kimi-coding", "Kimi For Coding"],
      ["meta", "Meta"],
      ["openai", "OpenAI"],
      ["openrouter", "OpenRouter"],
      ["radius", "Radius"],
      ["xai", "xAI"],
    ]);
    assert.equal(providers.find(p => p.id === "radius")?.signedIn, false);
    assert(!providers.some(p => p.id === "deepseek"));
    const started = yield* login.start("radius");
    assert.equal(started.status, "running");
    // One lane for every provider: they share a loopback callback port.
    assert.match((yield* Effect.flip(login.start("anthropic"))).detail, /already in progress/);
    const method = yield* until(login, s => !!s.prompt);
    assert.deepEqual(method.prompt?.options, [{ id: "device", label: "Device code" }]);
    yield* login.answer(started.id, method.prompt!.id, "device");
    const code = yield* until(login, s => s.prompt?.type === "manual_code");
    assert.equal(code.userCode, "ABCD");
    assert.equal(code.url, "https://example.invalid/login");
    yield* login.answer(started.id, code.prompt!.id, "one-use-code");
    const done = yield* until(login, s => s.status === "success");
    assert(!JSON.stringify(done).includes("private-"));
    assert(!done.prompt && !done.url && !done.userCode);
    const stored = JSON.parse(readFileSync(authPath, "utf8"));
    assert.equal(stored.radius.access, "private-access-token");
    assert.equal(stored.openai.key, "existing-key");
    const refreshed = yield* login.providers;
    assert.equal(refreshed.find(p => p.id === "radius")?.signedIn, true);
    assert.equal(refreshed.find(p => p.id === "openai")?.signedIn, false);
    assert(!JSON.stringify(refreshed).includes("private-"));
    yield* login.signOut("radius");
    assert.equal((yield* login.providers).find(p => p.id === "radius")?.signedIn, false);
    assert.deepEqual(JSON.parse(readFileSync(authPath, "utf8")), { openai: { type: "api_key", key: "existing-key" } });
    assert.equal(yield* login.state, null);
  }));
});

test("INV-04: Pi's per-prompt signal closes that prompt; sign-out waits for sign-in; cancelling preserves existing credentials", async () => {
  const callback = new AbortController();
  await fixture(async interaction => {
    await interaction.prompt({ type: "manual_code", message: "Pending callback", signal: callback.signal }).catch(() => undefined);
    return interaction.prompt({ type: "text", message: "Next step" }).then(() => { throw new Error("Should not complete"); });
  }, (login, authPath) => Effect.gen(function* () {
    const started = yield* login.start("radius");
    const first = yield* until(login, s => !!s.prompt);
    assert((yield* Effect.result(login.signOut("radius")))._tag === "Failure");
    callback.abort();
    const next = yield* until(login, s => s.prompt?.message === "Next step");
    assert.notEqual(next.prompt!.id, first.prompt!.id);
    yield* login.cancel(started.id);
    assert.equal((yield* login.state)?.status, "cancelled");
    assert.deepEqual(JSON.parse(readFileSync(authPath, "utf8")), { openai: { type: "api_key", key: "existing-key" } });
  }));
});

test("INV-01/11/12: sign-out requires an OAuth credential and sign-in requires signing out first", async () => {
  await fixture(async () => ({ type: "oauth", access: "private-access", refresh: "private-refresh", expires: Date.now() + 3600_000 }), (login, authPath) => Effect.gen(function* () {
    assert((yield* Effect.result(login.signOut("not-a-provider")))._tag === "Failure");
    assert((yield* Effect.result(login.signOut("openai")))._tag === "Failure");
    yield* login.start("radius");
    yield* until(login, s => s.status === "success");
    yield* login.start("radius");
    const blocked = yield* until(login, s => s.status === "error");
    assert.match(blocked.message!, /Sign out/);
    const competing = yield* Effect.all([
      Effect.result(login.signOut("radius")),
      Effect.result(login.start("radius")),
      Effect.result(login.signOut("radius")),
    ], { concurrency: "unbounded" });
    assert.deepEqual(competing.map(result => result._tag), ["Success", "Failure", "Failure"]);
    yield* login.start("radius");
    yield* until(login, s => s.status === "success");
    assert.equal((yield* login.providers).find(p => p.id === "radius")?.signedIn, true);
    assert.equal(JSON.parse(readFileSync(authPath, "utf8")).openai.key, "existing-key");
  }));
});

test("INV-11: unknown providers and provider failures cannot disclose token response bodies", async () => {
  await fixture(async () => { throw new Error("Token exchange: secret-response-token"); }, login => Effect.gen(function* () {
    yield* login.start("openai-codex");
    const legacy = yield* until(login, s => s.status === "error");
    assert.match(legacy.message!, /does not support OAuth/);
    yield* login.start("not-a-provider");
    const unknown = yield* until(login, s => s.status === "error");
    assert.match(unknown.message!, /does not support OAuth/);
    yield* login.start("radius");
    const failed = yield* until(login, s => s.status === "error");
    assert(!JSON.stringify(failed).includes("secret-response-token"));
  }));
});

test("INV-01/02: completing sign-in or sign-out invalidates the model catalog in the server, without a client poll", async () => {
  await fixture(async () => ({ type: "oauth", access: "private-access", refresh: "private-refresh", expires: Date.now() + 3600_000 }), (login, _authPath, { catalog, count }) => Effect.gen(function* () {
    const cwd = "/nonexistent/piano-login-catalog";
    yield* catalog.catalog(cwd);
    yield* catalog.catalog(cwd);
    assert.equal(count(), 1, "a cached catalog is not re-probed");
    // Watch only the service state, never the HTTP route that used to invalidate on GET.
    yield* login.start("radius");
    yield* until(login, s => s.status === "success");
    yield* catalog.catalog(cwd);
    assert.equal(count(), 2, "sign-in completion re-probes the catalog");
    yield* login.signOut("radius");
    yield* catalog.catalog(cwd);
    assert.equal(count(), 3, "sign-out re-probes the catalog");
    // A failed sign-out changes no credentials and leaves the cache alone.
    assert((yield* Effect.result(login.signOut("radius")))._tag === "Failure");
    yield* catalog.catalog(cwd);
    assert.equal(count(), 3);
  }));
});
