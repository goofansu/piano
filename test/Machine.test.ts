import assert from "node:assert/strict";
import { test } from "node:test";
import type { ModelCatalog } from "../shared/wire.ts";
import { sessionCommands, workspaceFile } from "../web/src/lib/api.ts";
import { createClient } from "../web/src/lib/client.ts";
import {
  machineAddress,
  machineLocation,
  machinePath,
  peerApiPath,
} from "../web/src/lib/machine.ts";
import { createMachineStores } from "../web/src/lib/machineStores.ts";
import { createDrafts, sessionDraftKey } from "../web/src/lib/messageDraft.ts";
import { createModelCatalogs } from "../web/src/lib/modelCatalogs.ts";
import { createQuestionReplies } from "../web/src/lib/piDialogs.ts";
import { parseRoute, routePath } from "../web/src/lib/routes.ts";
import type { ConnectionHandlers } from "../web/src/lib/ws.ts";
import { initialState } from "../web/src/store.ts";

test("machine-qualified session navigation survives reload; late navigation keeps its owner", () => {
  let path = "/m/eng-1/s/same-id";
  const writes: string[] = [];
  let pop = () => {};
  const remote = machineAddress("eng-1", {
    location: () => ({ pathname: path, search: "" }),
    push: (p) => {
      writes.push(p);
    },
    replace: (p) => {
      writes.push(p);
    },
    setTitle: () => {},
    onPop: (fn) => {
      pop = fn;
      return () => {};
    },
  });
  assert.deepEqual(parseRoute(remote.location()), { kind: "session", sessionId: "same-id" });
  assert.equal(machinePath("eng-1", routePath(parseRoute(remote.location()))), path);
  let calls = 0;
  remote.onPop(() => calls++);
  path = "/s/same-id";
  pop();
  assert.equal(calls, 0, "local back/forward cannot select a remote session");
  remote.push("/s/other-id");
  assert.deepEqual(writes, ["/m/eng-1/s/other-id"]);
  assert.equal(machineLocation("/m/not%20configured/s/id").id, "");
  assert.equal(machineLocation("/new").id, "local");
});

test("same cwd/session IDs retain separate page-memory drafts, questions and model catalogs", () => {
  const localCatalog: ModelCatalog = { cwd: "/same", models: [], fetchedAt: "local" };
  const local = {
    drafts: createDrafts(),
    questions: createQuestionReplies(),
    catalogs: createModelCatalogs({
      storage: { read: () => ({ "/same": localCatalog }), write: () => {} },
      notify: () => {},
      saveDefaults: async () => {},
    }),
  };
  const forMachine = createMachineStores(local, () => {});
  const remote = forMachine("eng-1");
  const key = sessionDraftKey({ cwd: "/same", sessionId: "same-id" });
  local.drafts.setText(key, "LOCAL-DRAFT");
  assert.equal(remote.drafts.get(key).text, "");
  remote.drafts.setText(key, "REMOTE-DRAFT");
  assert.equal(forMachine("local").drafts.get(key).text, "LOCAL-DRAFT");
  assert.equal(forMachine("eng-1").drafts.get(key).text, "REMOTE-DRAFT");
  assert.deepEqual(remote.catalogs.seed(), {});
  assert.equal(local.catalogs.seed()["/same"].fetchedAt, "local");
  assert.notEqual(remote.questions, local.questions);
  let events!: ConnectionHandlers;
  const client = createClient({
    initial: initialState,
    notify: () => {},
    connect: (handlers) => {
      events = handlers;
      return { send: () => "sent", close: () => {} };
    },
    lastDirectory: { read: () => null, write: () => {} },
  });
  const close = client.start();
  const unfollow = remote.catalogs.follow(client);
  events.onMessage({ _tag: "models", catalog: { cwd: "/same", models: [], fetchedAt: "remote" } });
  assert.equal(remote.catalogs.getState().catalogs["/same"].fetchedAt, "remote");
  assert.equal(local.catalogs.getState().catalogs["/same"].fetchedAt, "local");
  unfollow();
  events.onMessage({ _tag: "models", catalog: { cwd: "/same", models: [], fetchedAt: "late" } });
  assert.equal(
    remote.catalogs.getState().catalogs["/same"].fetchedAt,
    "remote",
    "a detached client cannot overwrite a returning machine's cache",
  );
  assert.equal(local.catalogs.getState().catalogs["/same"].fetchedAt, "local");
  close();
  assert.notEqual(
    createMachineStores(local, () => {})("eng-1"),
    remote,
    "a page reload has no remote draft storage",
  );
});

test("HTTP request captures its peer; unsupported remote reads never fall through to Local", async (t) => {
  const urls: string[] = [];
  let finish!: (response: Response) => void;
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  globalThis.fetch = async (input) => {
    urls.push(String(input));
    return new Promise<Response>((resolve) => {
      finish = resolve;
    });
  };
  const pending = sessionCommands("same-workspace", "same-id", { machineId: "eng-1" });
  assert.deepEqual(urls, [
    "/peer/eng-1/api/session/commands?workspaceId=same-workspace&sessionId=same-id",
  ]);
  await assert.rejects(
    workspaceFile("same-workspace", "secret.txt", { machineId: "eng-1" }),
    /Unavailable/,
  );
  assert.equal(urls.length, 1);
  finish(
    new Response(JSON.stringify({ commands: [] }), {
      headers: { "content-type": "application/json" },
    }),
  );
  assert.deepEqual(await pending, []);
  assert.equal(peerApiPath("local", "/api/workspace/file"), "/api/workspace/file");
  assert.throws(() => peerApiPath("unknown", "/api/settings"), /Unavailable/);
});
