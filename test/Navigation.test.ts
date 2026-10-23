import assert from "node:assert/strict";
import { test } from "node:test";
import type { ClientMessage, ServerMessage } from "../shared/wire.ts";
import { createClient } from "../web/src/lib/client.ts";
import { type AddressBar, createNavigation, initialView } from "../web/src/lib/navigation.ts";
import { parseRoute } from "../web/src/lib/routes.ts";
import type { ConnectionHandlers } from "../web/src/lib/ws.ts";
import { initialState } from "../web/src/store.ts";
import { sessionReference } from "./fixtures/sessionReference.ts";

/** An address bar with a history stack: push, replace, back and forward, like the browser's. */
function addressBar(start: string) {
  const entries = [start];
  let index = 0;
  const titles: string[] = [];
  let popped: (() => void) | undefined;
  const bar: AddressBar = {
    location: () => {
      const url = new URL(entries[index], "http://piano.test");
      return { pathname: url.pathname, search: url.search };
    },
    push: (path) => {
      entries.splice(index + 1, Infinity, path);
      index++;
    },
    replace: (path) => {
      entries[index] = path;
    },
    setTitle: (title) => titles.push(title),
    onPop: (listener) => {
      popped = listener;
      return () => {
        popped = undefined;
      };
    },
  };
  const go = (delta: number) => {
    index += delta;
    popped?.();
  };
  return {
    bar,
    entries,
    path: () => entries[index],
    title: () => titles.at(-1),
    back: () => go(-1),
    forward: () => go(1),
  };
}

/** A page at `url`: the client seeded as App seeds it, navigation over a fake address bar, the test playing the server. */
function page(url: string) {
  const address = addressBar(url);
  const sent: ClientMessage[] = [];
  let handlers: ConnectionHandlers | undefined;
  let ids = 0;
  const client = createClient({
    initial: { ...initialState, view: initialView(parseRoute(address.bar.location())) },
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
    newSelectionId: () => `sel${++ids}`,
  });
  let moves = 0;
  const navigation = createNavigation({ client, address: address.bar, moved: () => moves++ });
  client.start();
  navigation.start();
  handlers!.onStatus(true);
  const server = (m: ServerMessage) => handlers!.onMessage(m);
  const registry = () =>
    server({
      _tag: "registry",
      folders: [],
      projects: [{ id: "p1", name: "Launch" }],
      sessionReferences: [
        sessionReference("/scratch", "a", { title: "Alpha" }),
        sessionReference("/scratch", "b", { title: "Beta" }),
      ],
    });
  const selected = (sessionId: string) =>
    server({
      _tag: "selected",
      cwd: "/scratch",
      sessionId,
      selectionId: client.getState().selectionId!,
      hosted: true,
      cursor: { cwd: "/scratch", sessionId, generation: "g1", sequence: 1 },
      snapshot: { state: { sessionId, isStreaming: false }, messages: [], dialogs: [] },
    });
  const selects = () => sent.filter((m) => m._tag === "select").map((m) => m.sessionId);
  return {
    ...address,
    client,
    navigation,
    server,
    registry,
    selected,
    selects,
    moves: () => moves,
  };
}

test("a session URL waits for the registry, then selects that session without moving the address", () => {
  const p = page("/s/a");
  assert.equal(
    p.client.getState().view.kind,
    "session",
    "the New page is never shown for a session URL",
  );
  assert.deepEqual(p.selects(), [], "nothing to select before the registry names the directory");
  assert.equal(p.title(), undefined);
  p.registry();
  assert.deepEqual(p.selects(), ["a"]);
  p.selected("a");
  assert.deepEqual(p.entries, ["/s/a"], "the address is replaced in place, never pushed");
  assert.equal(p.title(), "Alpha - Piano");
});

test("an unknown session keeps its URL and shows Session not found", () => {
  const p = page("/s/gone");
  p.registry();
  assert.deepEqual(p.client.getState().view, { kind: "missing-session", sessionId: "gone" });
  assert.deepEqual(p.selects(), []);
  assert.deepEqual(p.entries, ["/s/gone"]);
  assert.equal(p.title(), "Session not found - Piano");
});

test("aliases are replaced and real moves are pushed, with a title for each screen", () => {
  const p = page("/");
  p.registry();
  assert.deepEqual(p.entries, ["/new"], "the bare root is an alias for /new");
  assert.equal(p.title(), "New session - Piano");

  p.navigation.select("/scratch", "a");
  p.selected("a");
  assert.deepEqual(p.entries, ["/new", "/s/a"]);
  assert.equal(p.title(), "Alpha - Piano");

  p.navigation.openSettings("radius");
  assert.deepEqual(
    p.entries,
    ["/new", "/s/a", "/settings/radius"],
    "Settings is one history entry",
  );
  assert.equal(p.title(), "Settings - Piano");
  p.navigation.openNew(undefined, "p1");
  assert.equal(p.navigation.getState().settings, null);
  assert.deepEqual(
    p.entries,
    ["/new", "/s/a", "/settings/radius", "/projects/p1/new"],
    "leaving Settings for the New page is one entry, not two",
  );
  assert.equal(p.title(), "Launch - Piano");

  const bare = page("/settings");
  assert.deepEqual(bare.navigation.getState().settings, "providers");
  assert.deepEqual(bare.entries, ["/settings/providers"], "/settings is an alias for Providers");
});

test("a project's address opens its home; its New page has an address of its own", () => {
  const p = page("/projects/p1");
  assert.deepEqual(p.client.getState().view, { kind: "project", projectId: "p1" });
  p.registry();
  assert.deepEqual(p.entries, ["/projects/p1"]);
  assert.equal(p.title(), "Launch - Piano");

  p.navigation.openNew(undefined, "p1");
  assert.deepEqual(p.entries, ["/projects/p1", "/projects/p1/new"]);
  assert.equal(p.client.getState().view.kind, "new");
  p.back();
  assert.deepEqual(p.client.getState().view, { kind: "project", projectId: "p1" });
  assert.equal(p.title(), "Launch - Piano");

  p.navigation.select("/scratch", "a");
  p.selected("a");
  p.navigation.openProject("p1");
  assert.deepEqual(p.entries, ["/projects/p1", "/s/a", "/projects/p1"]);
  assert.deepEqual(p.client.getState().view, { kind: "project", projectId: "p1" });

  const fresh = page("/projects/p1/new");
  assert.deepEqual(fresh.client.getState().view, { kind: "new", projectId: "p1" });
});

test("a project's settings page has its own address and title, and Back returns to its home", () => {
  const p = page("/projects/p1");
  p.registry();
  p.navigation.openProjectSettings("p1");
  assert.deepEqual(p.entries, ["/projects/p1", "/projects/p1/settings"]);
  assert.deepEqual(p.client.getState().view, { kind: "project-settings", projectId: "p1" });
  assert.equal(p.title(), "Launch settings - Piano");
  p.back();
  assert.deepEqual(p.client.getState().view, { kind: "project", projectId: "p1" });

  const direct = page("/projects/p1/settings");
  assert.deepEqual(direct.client.getState().view, { kind: "project-settings", projectId: "p1" });
});

test("back and forward apply the address bar's route; back onto the same New page keeps its directory", () => {
  const p = page("/new");
  p.registry();
  p.navigation.openNew("/scratch");
  p.navigation.openSettings();
  assert.deepEqual(p.entries, ["/new", "/settings/providers"]);
  p.back();
  assert.equal(p.navigation.getState().settings, null);
  assert.deepEqual(p.client.getState().view, {
    kind: "new",
    cwd: "/scratch",
    projectId: undefined,
  });
  assert.equal(p.title(), "New session - Piano");

  p.navigation.select("/scratch", "a");
  p.selected("a");
  p.navigation.openSettings("radius");
  assert.deepEqual(p.entries, ["/new", "/s/a", "/settings/radius"]);
  p.back();
  assert.equal(p.navigation.getState().settings, null);
  assert.deepEqual(p.selects(), ["a"], "the session already on screen is not selected again");
  assert.equal(p.title(), "Alpha - Piano");
  p.back();
  assert.deepEqual(
    p.client.getState().view,
    { kind: "new", cwd: undefined, projectId: undefined },
    "a different page opens New afresh",
  );
  p.forward();
  assert.deepEqual(p.selects(), ["a", "a"]);
  p.forward();
  assert.equal(p.navigation.getState().settings, "radius");
  assert.deepEqual(
    p.entries,
    ["/new", "/s/a", "/settings/radius"],
    "history moves never add entries",
  );
  assert.ok(p.moves() > 0);
});

test("a session's panels close when another session is selected, and opening one leaves Settings", () => {
  const p = page("/new");
  p.registry();
  p.navigation.select("/scratch", "a");
  p.selected("a");
  p.navigation.openSettings();
  p.navigation.openPanel("changes");
  assert.deepEqual(p.navigation.getState(), {
    settings: null,
    settingsRequest: 1,
    sidebar: "changes",
    pullRequest: false,
    palette: false,
  });
  assert.equal(p.path(), "/s/a");
  p.navigation.openPanel({ kind: "file", path: "docs/guide.md" });
  assert.deepEqual(p.navigation.getState().sidebar, { kind: "file", path: "docs/guide.md" });
  assert.equal(p.path(), "/s/a", "a file preview never puts its path in the address bar");

  p.navigation.openPanel("pr");
  assert.equal(p.navigation.getState().pullRequest, true);
  assert.deepEqual(
    p.navigation.getState().sidebar,
    { kind: "file", path: "docs/guide.md" },
    "the PR opens over the nonmodal sidebar without replacing it",
  );
  p.navigation.closePullRequest();
  assert.deepEqual(p.navigation.getState().sidebar, { kind: "file", path: "docs/guide.md" });

  p.navigation.openPanel("pr");
  p.navigation.select("/scratch", "b");
  p.selected("b");
  assert.equal(p.navigation.getState().sidebar, null);
  assert.equal(p.navigation.getState().pullRequest, false);
  p.navigation.openPanel("changes");
  p.navigation.openPanel("pr");
  p.navigation.openNew();
  assert.equal(p.navigation.getState().sidebar, null, "the New page has no session panel");
  assert.equal(p.navigation.getState().pullRequest, false);
});

test("each request to open Settings is counted, so a repeat reveals its section again", () => {
  const p = page("/new");
  p.registry();
  const requests = () => p.navigation.getState().settingsRequest;
  assert.equal(requests(), 0, "no Settings route, nothing asked for");
  p.navigation.openSettings("radius");
  const first = requests();
  assert.ok(first > 0);
  p.navigation.openSettings("radius");
  assert.equal(
    requests(),
    first + 1,
    "asking for the section already open is a request of its own",
  );
  p.navigation.closeSettings();
  p.back();
  assert.equal(p.navigation.getState().settings, "radius", "history returns to the section");
  assert.ok(requests() > first + 1, "applying a settings route is a request too");
  const deepLink = page("/settings/radius");
  deepLink.registry();
  assert.equal(deepLink.navigation.getState().settings, "radius");
  assert.ok(deepLink.navigation.getState().settingsRequest > 0, "a cold deep link asks once");
});
