import assert from "node:assert/strict";
import { test } from "node:test";
import type { ClientMessage, ModelCatalog, ServerMessage } from "../shared/wire.ts";
import { createClient, type NotifyLevel } from "../web/src/lib/client.ts";
import { type Catalogs, createModelCatalogs } from "../web/src/lib/modelCatalogs.ts";
import type { ConnectionHandlers } from "../web/src/lib/ws.ts";
import { initialState } from "../web/src/store.ts";

const catalog = (fetchedAt: string, extra: Partial<ModelCatalog> = {}): ModelCatalog => ({
  cwd: "/scratch",
  models: [
    {
      ref: "anthropic/opus",
      provider: "anthropic",
      id: "opus",
      contextWindow: 200_000,
      thinkingLevels: ["off", "high"],
      reasoning: true,
    },
  ],
  fetchedAt,
  ...extra,
});

/** The page's client over a fake transport, with model catalogs following it as App wires them. */
function page(stored: Catalogs = {}, save: () => Promise<unknown> = async () => ({})) {
  const writes: Catalogs[] = [];
  const notes: Array<[string, NotifyLevel | undefined]> = [];
  const sent: ClientMessage[] = [];
  let handlers: ConnectionHandlers | undefined;
  const catalogs = createModelCatalogs({
    storage: { read: () => stored, write: (c) => writes.push(c) },
    notify: (message, level) => notes.push([message, level]),
    saveDefaults: save,
  });
  const client = createClient({
    initial: { ...initialState, catalogs: { ...catalogs.seed() } },
    connect: (h) => {
      handlers = h;
      return {
        send: (m) => {
          sent.push(m);
          return "sent";
        },
        close: () => {},
      };
    },
    notify: () => {},
    lastDirectory: { read: () => null, write: () => {} },
  });
  client.start();
  catalogs.follow(client);
  const view = () => catalogs.view(catalogs.getState(), "/scratch");
  return {
    catalogs,
    view,
    writes,
    notes,
    refreshes: () => sent.filter((m) => m._tag === "models").filter((m) => m.refresh),
    status: (connected: boolean) => handlers!.onStatus(connected),
    server: (m: ServerMessage) => handlers!.onMessage(m),
  };
}

test("a stored catalog is available before Pi answers", () => {
  const p = page({ "/scratch": catalog("t0") });
  assert.equal(p.view().catalog?.fetchedAt, "t0");
  p.status(true);
  assert.equal(p.view().catalog?.fetchedAt, "t0", "connecting keeps it until Pi replaces it");
});

test("a refresh ends only on its correlated catalog, even with an unchanged timestamp", () => {
  const p = page({ "/scratch": catalog("t0") });
  p.status(true);
  p.view().refresh!();
  assert.equal(p.refreshes().length, 1);
  assert.equal(p.view().refreshing, true);
  p.view().refresh!();
  assert.equal(p.refreshes().length, 1, "a pending refresh is not asked twice");
  p.server({ _tag: "models", catalog: { ...catalog("t9"), cwd: "/elsewhere" } });
  assert.equal(p.view().refreshing, true, "another directory's catalog does not end it");
  p.server({ _tag: "models", catalog: catalog("t1") });
  assert.equal(p.view().refreshing, true, "a background catalog is not completion");
  const requestId = p.refreshes()[0].requestId;
  p.server({ _tag: "models", requestId, catalog: catalog("t9", { cwd: "/elsewhere" }) });
  assert.equal(p.view().refreshing, true, "even a matching ID must name the directory");
  p.server({ _tag: "models", requestId, catalog: catalog("t0") });
  assert.equal(p.view().refreshing, false);
  assert.equal(p.view().catalog?.fetchedAt, "t0");
  assert.equal(p.writes.at(-1)?.["/scratch"].fetchedAt, "t0");
});

test("a failed refresh keeps the last good catalog and allows exactly one explicit retry", () => {
  const p = page({ "/scratch": catalog("t0") });
  p.status(true);
  p.view().refresh!();
  const requestId = p.refreshes()[0].requestId;
  const writesBefore = p.writes.length;
  const failure = { _tag: "models_failed", cwd: "/scratch", requestId, message: "Busy" } as const;
  p.server({ ...failure, cwd: "/elsewhere" });
  p.server({ ...failure, requestId: "older" });
  assert.equal(p.view().refreshing, true);
  assert.deepEqual(p.notes, []);
  p.server(failure);
  assert.equal(p.view().refreshing, false);
  assert.equal(p.view().catalog?.fetchedAt, "t0");
  assert.equal(p.writes.length, writesBefore, "failures do not persist catalogs");
  assert.deepEqual(p.notes, [["Busy", "error"]]);
  assert.equal(p.refreshes().length, 1, "no automatic retry");
  p.view().refresh!();
  p.view().refresh!();
  assert.equal(p.refreshes().length, 2);
  const retryId = p.refreshes()[1].requestId;
  assert.notEqual(retryId, requestId);
  p.server(failure);
  p.server({ _tag: "models", requestId, catalog: catalog("t1") });
  assert.equal(p.view().refreshing, true, "old failure and success cannot settle retry");
  assert.deepEqual(p.notes, [["Busy", "error"]], "late failure is not reported twice");
  p.server({ _tag: "models", requestId: retryId, catalog: catalog("t2") });
  assert.equal(p.view().refreshing, false);
  assert.equal(p.view().catalog?.fetchedAt, "t2");
  assert.equal(p.writes.at(-1)?.["/scratch"].fetchedAt, "t2");
});

test("a dropped connection ends a pending refresh without replaying it on reconnect", () => {
  const p = page({ "/scratch": catalog("t0") });
  p.status(true);
  p.view().refresh!();
  assert.equal(p.view().refreshing, true);
  const requestId = p.refreshes()[0].requestId;
  p.status(false);
  assert.equal(p.view().refreshing, false);
  p.view().refresh!();
  assert.equal(p.refreshes().length, 1, "offline refresh does not send");
  p.status(true);
  assert.equal(p.refreshes().length, 1, "reconnect does not replay explicit refresh");
  p.view().refresh!();
  assert.equal(p.refreshes().length, 2);
  const retryId = p.refreshes()[1].requestId;
  assert.notEqual(retryId, requestId);
  p.server({ _tag: "models_failed", cwd: "/scratch", requestId, message: "Late failure" });
  p.server({ _tag: "models", requestId, catalog: catalog("t1") });
  assert.equal(p.view().refreshing, true);
  p.server({ _tag: "models", requestId: retryId, catalog: catalog("t2") });
  assert.equal(p.view().refreshing, false);
});

test("an errored catalog is shown but never stored", () => {
  const p = page();
  p.status(true);
  p.server({ _tag: "models", catalog: catalog("t1") });
  p.server({
    _tag: "models",
    catalog: { ...catalog("t2", { error: "Pi failed" }), cwd: "/broken" },
  });
  assert.equal(p.catalogs.view(p.catalogs.getState(), "/broken").catalog?.error, "Pi failed");
  const last = p.writes.at(-1)!;
  assert.deepEqual(Object.keys(last), ["/scratch"]);
});

test("a failed save reports its failure once", async () => {
  const p = page({ "/scratch": catalog("t0") }, () => Promise.reject(new Error("Pi is busy")));
  const saving = p.view().saveDefaults("anthropic/opus", "high");
  assert.equal(p.view().saving, true);
  await saving;
  assert.equal(p.view().saving, false);
  assert.deepEqual(p.notes, [["Pi is busy", "error"]]);
});

test("a save stays pending until a catalog shows the saved defaults", async () => {
  const p = page({
    "/scratch": catalog("t0", { defaultThinkingLevel: "off" }),
    "/older": {
      ...catalog("t0", { defaultModel: "anthropic/opus", defaultThinkingLevel: "high" }),
      cwd: "/older",
    },
  });
  p.status(true);
  await p.view().saveDefaults("anthropic/opus", "high");
  assert.equal(p.view().saving, true, "Pi answered before its catalog; /older predates the save");
  p.server({
    _tag: "models",
    catalog: catalog("t1", { defaultModel: "anthropic/opus", defaultThinkingLevel: "high" }),
  });
  assert.equal(p.view().saving, false);
  assert.deepEqual(p.notes, [], "the picker's own default is the confirmation");
});
