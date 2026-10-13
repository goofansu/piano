import assert from "node:assert/strict";
import { test } from "node:test";
import type { OAuthProvider, ServerMessage } from "../shared/wire.ts";
import type { ObservationEnvironment } from "../web/src/lib/observation.ts";
import { createProviderAccounts, signedInToRadius } from "../web/src/lib/providerAccounts.ts";

/** Timers that never fire on their own and a focus nobody gives, so every read here is one the test caused. */
const environment: ObservationEnvironment = {
  setTimeout: () => undefined,
  clearTimeout: () => {},
  onFocus: () => () => {},
  hidden: () => false,
};

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

const radius = (signedIn: boolean): OAuthProvider[] => [
  { id: "anthropic", name: "Anthropic", signedIn: true },
  { id: "radius", name: "Radius", signedIn },
];

/** Pi's provider endpoint, answered by the test one read at a time; it ignores aborts, like a response already on the wire. */
function pi() {
  const reads: ((providers: OAuthProvider[]) => void)[] = [];
  const logouts: { provider: string; done: () => void }[] = [];
  return {
    reads,
    logouts,
    load: () => new Promise<readonly OAuthProvider[]>((resolve) => reads.push(resolve)),
    logout: (provider: string) => new Promise<void>((done) => logouts.push({ provider, done })),
  };
}

/** The socket as the page's client exposes it: connection status and server frames. */
function socket() {
  let connected = false;
  const listeners = new Set<() => void>();
  const messages = new Set<(message: ServerMessage) => void>();
  return {
    source: {
      getState: () => ({ connected }),
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      listen: (listener: (message: ServerMessage) => void) => {
        messages.add(listener);
        return () => messages.delete(listener);
      },
    },
    status: (next: boolean) => {
      connected = next;
      for (const listener of listeners) listener();
    },
    server: (message: ServerMessage) => {
      for (const listener of messages) listener(message);
    },
  };
}

test("another tab's sign-in reaches this page through catalogs_invalidated", async () => {
  const server = pi();
  const ws = socket();
  const accounts = createProviderAccounts({ ...server, environment });
  accounts.follow(ws.source);
  assert.equal(server.reads.length, 0, "nothing is read before the socket connects");
  ws.status(true);
  server.reads[0]!(radius(false));
  await settle();
  assert.equal(signedInToRadius(accounts.getState(), true), false);

  ws.server({ _tag: "catalogs_invalidated" });
  assert.equal(server.reads.length, 2);
  server.reads[1]!(radius(true));
  await settle();
  assert.equal(signedInToRadius(accounts.getState(), true), true);
  assert.equal(signedInToRadius(accounts.getState(), false), false, "disconnected is signed out");
});

test("a sign-out supersedes a read that started before it, so the old sign-in never returns", async () => {
  const server = pi();
  const ws = socket();
  const accounts = createProviderAccounts({ ...server, environment });
  accounts.follow(ws.source);
  ws.status(true);
  server.reads[0]!(radius(true));
  await settle();

  void accounts.refresh();
  const signingOut = accounts.signOut("radius");
  assert.deepEqual(
    server.logouts.map((l) => l.provider),
    ["radius"],
  );
  server.logouts[0]!.done();
  await settle();
  // The read the sign-out made, then the late answer to the one it superseded.
  server.reads[2]!(radius(false));
  server.reads[1]!(radius(true));
  await signingOut;
  await settle();
  assert.equal(signedInToRadius(accounts.getState(), true), false);
});

test("a sign-in made here is read even while a read from before it is in flight", async () => {
  const server = pi();
  const ws = socket();
  const accounts = createProviderAccounts({ ...server, environment });
  accounts.follow(ws.source);
  ws.status(true);
  const signedIn = accounts.signedIn();
  server.reads[1]!(radius(true));
  server.reads[0]!(radius(false));
  await signedIn;
  await settle();
  assert.equal(signedInToRadius(accounts.getState(), true), true);
});
