import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadPeerConfigs } from "../server/PeerConfig.ts";
import type { ModelCatalog } from "../shared/wire.ts";
import { sessionCommands, workspaceFile } from "../web/src/lib/api.ts";
import { createClient } from "../web/src/lib/client.ts";
import {
  machineAddress,
  machineLocation,
  machinePath,
  machineSocketUrl,
  peerApiPath,
} from "../web/src/lib/machine.ts";
import { createMachineStores } from "../web/src/lib/machineStores.ts";
import { createDrafts, sessionDraftKey } from "../web/src/lib/messageDraft.ts";
import { createModelCatalogs } from "../web/src/lib/modelCatalogs.ts";
import { createQuestionReplies } from "../web/src/lib/piDialogs.ts";
import { remoteImageUrl } from "../web/src/lib/remoteImages.ts";
import { parseRoute, routePath } from "../web/src/lib/routes.ts";
import type { ConnectionHandlers } from "../web/src/lib/ws.ts";
import { initialState } from "../web/src/store.ts";

test("remote thumbnails and full-image links accept only exact peer-owned projection URLs", () => {
  const hash = "a".repeat(64);
  const target = { workspaceId: "same-workspace", sessionId: "same-session" };
  const url = `/api/image-previews/${hash}`;
  assert.equal(remoteImageUrl("local", url), url);
  for (const id of ["eng-1", "eng-2"])
    assert.equal(
      remoteImageUrl(id, url, target),
      `/peer/${id}/api/peer/image-preview?workspaceId=same-workspace&sessionId=same-session&hash=${hash}`,
    );
  for (const invalid of [
    `https://host${url}`,
    `//host${url}`,
    url + "?x=1",
    url + "#x",
    "/api/image-previews/../x",
    url.replace("/api", "%2Fapi"),
    "data:image/png;base64,aA==",
  ])
    assert.equal(remoteImageUrl("eng-1", invalid, target), "", invalid);
  assert.equal(remoteImageUrl("eng-1", url), "");
  assert.equal(remoteImageUrl("eng-1", url, { ...target, sessionId: "../x" }), "");
});

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
  const second = forMachine("eng-2");
  const key = sessionDraftKey({ cwd: "/same", sessionId: "same-id" });
  local.drafts.setText(key, "LOCAL-DRAFT");
  assert.equal(remote.drafts.get(key).text, "");
  remote.drafts.setText(key, "REMOTE-DRAFT");
  assert.equal(forMachine("local").drafts.get(key).text, "LOCAL-DRAFT");
  assert.equal(forMachine("eng-1").drafts.get(key).text, "REMOTE-DRAFT");
  assert.equal(second.drafts.get(key).text, "");
  second.drafts.setText(key, "SECOND-DRAFT");
  assert.equal(remote.drafts.get(key).text, "REMOTE-DRAFT");
  assert.equal(forMachine("eng-2").drafts.get(key).text, "SECOND-DRAFT");
  assert.deepEqual(remote.catalogs.seed(), {});
  assert.deepEqual(second.catalogs.seed(), {});
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
  let secondEvents!: ConnectionHandlers;
  const secondClient = createClient({
    initial: initialState,
    notify: () => {},
    connect: (handlers) => {
      secondEvents = handlers;
      return { send: () => "sent", close: () => {} };
    },
    lastDirectory: { read: () => null, write: () => {} },
  });
  const closeSecond = secondClient.start();
  const unfollowSecond = second.catalogs.follow(secondClient);
  secondEvents.onMessage({
    _tag: "models",
    catalog: { cwd: "/same", models: [], fetchedAt: "second" },
  });
  assert.equal(second.catalogs.getState().catalogs["/same"].fetchedAt, "second");
  assert.equal(remote.catalogs.getState().catalogs["/same"].fetchedAt, "remote");
  unfollow();
  events.onMessage({ _tag: "models", catalog: { cwd: "/same", models: [], fetchedAt: "late" } });
  assert.equal(
    remote.catalogs.getState().catalogs["/same"].fetchedAt,
    "remote",
    "a detached client cannot overwrite a returning machine's cache",
  );
  assert.equal(local.catalogs.getState().catalogs["/same"].fetchedAt, "local");
  assert.equal(
    second.catalogs.getState().catalogs["/same"].fetchedAt,
    "second",
    "late first-peer catalog cannot cross to the second peer",
  );
  unfollowSecond();
  closeSecond();
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

test("a machine ID startup configuration accepts is one the browser can address, and only those", () => {
  const root = mkdtempSync(join(tmpdir(), "piano-machine-id-"));
  const file = join(root, "peers.json");
  const accepts = (id: string) => {
    writeFileSync(
      file,
      JSON.stringify({
        id,
        name: "Remote",
        endpoint: "https://peer.example",
        origin: "https://peer.example",
      }),
    );
    try {
      return loadPeerConfigs(file).length === 1;
    } catch {
      return false;
    }
  };
  try {
    for (const id of [
      "eng-1",
      "a",
      "0x9",
      "a".repeat(64),
      "eng--1",
      "-eng",
      "eng-",
      "Eng",
      "a".repeat(65),
    ]) {
      const configured = accepts(id);
      const addressed = machineLocation(`/m/${id}/s/same-id`).id === id;
      assert.equal(
        addressed,
        configured,
        `${id}: configured ${configured}, addressed ${addressed}`,
      );
    }
    assert.ok(accepts("a".repeat(64)) && !accepts("eng--1"), "the table covers both outcomes");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Local keeps this Piano's own socket; a remote's goes through the gateway, wss under https", () => {
  const http = { protocol: "http:", host: "127.0.0.1:7070" };
  const https = { protocol: "https:", host: "piano.example" };
  assert.equal(machineSocketUrl("local", http), "ws://127.0.0.1:7070/ws");
  assert.equal(machineSocketUrl("local", https), "wss://piano.example/ws");
  assert.equal(machineSocketUrl("eng-1", http), "ws://127.0.0.1:7070/peer/eng-1/ws");
  assert.equal(machineSocketUrl("eng-1", https), "wss://piano.example/peer/eng-1/ws");
});
