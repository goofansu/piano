import assert from "node:assert/strict";
import { test } from "node:test";
import type { ClientMessage, ServerMessage } from "../shared/wire.ts";
import { createClient } from "../web/src/lib/client.ts";
import {
  type AddressBar,
  createNavigation,
  initialView,
  type SurfaceMemory,
  tabKey,
} from "../web/src/lib/navigation.ts";
import {
  createPreference,
  type Preference,
  type PreferenceStorage,
} from "../web/src/lib/preference.ts";
import { parseRoute } from "../web/src/lib/routes.ts";
import type { ConnectionHandlers } from "../web/src/lib/ws.ts";
import { initialState, sessionKey } from "../web/src/store.ts";
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
    titles,
    back: () => go(-1),
    forward: () => go(1),
  };
}

/** A page at `url`: the client seeded as App seeds it, navigation over a fake address bar, the test playing the server. */
function page(url: string, memory?: SurfaceMemory, rail?: Preference<boolean>) {
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
  let reads = 0;
  const navigation = createNavigation({
    client: {
      ...client,
      getState: () => {
        reads++;
        return client.getState();
      },
    },
    address: address.bar,
    memory,
    rail,
    moved: () => moves++,
  });
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
    reads: () => reads,
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

test("archiving or deleting a previously viewed session keeps the project home and its draft directory", () => {
  for (const action of ["archive_session", "delete_session"] as const) {
    const p = page("/s/a");
    p.registry();
    p.selected("a");
    const selectionId = p.client.getState().selectionId!;
    p.navigation.openProject("p1");
    p.client.dispatch({ type: "new_directory", cwd: "/scratch" });
    p.client.send({ _tag: action, cwd: "/scratch", sessionId: "a" });
    p.server({
      _tag: "registry",
      folders: [],
      projects: [{ id: "p1", name: "Launch" }],
      sessionReferences:
        action === "archive_session"
          ? [sessionReference("/scratch", "a", { projectId: "p1", archived: true })]
          : [],
    });
    // The server may still hold the old selection after the browser leaves the session.
    p.server({
      _tag: "selected",
      selectionId,
      cwd: "/scratch",
      sessionId: null,
      hosted: false,
      cursor: null,
      snapshot: { state: { sessionId: "", isStreaming: false }, messages: [], dialogs: [] },
    });
    assert.deepEqual(p.client.getState().view, {
      kind: "project",
      projectId: "p1",
      cwd: "/scratch",
    });
    assert.equal(p.path(), "/projects/p1");
    assert.equal(p.title(), "Launch - Piano");
  }
});

test("the Projects index has its own address and title, and a row's move to a home is one entry", () => {
  const p = page("/projects");
  assert.deepEqual(p.client.getState().view, { kind: "projects" });
  p.registry();
  assert.deepEqual(p.entries, ["/projects"]);
  assert.equal(p.title(), "Projects - Piano");

  p.navigation.openProject("p1");
  assert.deepEqual(p.entries, ["/projects", "/projects/p1"]);
  assert.equal(p.title(), "Launch - Piano");
  p.back();
  assert.deepEqual(p.client.getState().view, { kind: "projects" });
  assert.equal(p.title(), "Projects - Piano");

  p.navigation.openSettings("mcp");
  p.navigation.openProjects();
  assert.equal(p.navigation.getState().settings, null, "opening the index leaves Settings");
  assert.deepEqual(p.entries, ["/projects", "/settings/mcp", "/projects"]);
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

/** The Surface area as the user sees it: its tabs in order and the one shown, or null while hidden. */
function shownTabs(navigation: ReturnType<typeof createNavigation>) {
  const { surface, area } = navigation.getState();
  return surface
    ? { tabs: surface.tabs.map(tabKey), active: surface.active, area }
    : { tabs: [], active: null, area };
}

/** A browser tab's sessionStorage, which outlives a reload of the page. */
function tabMemory(): SurfaceMemory {
  let value: string | null = null;
  return {
    read: () => value,
    write: (next) => {
      value = next;
    },
  };
}

test("a reload brings back the session's open tabs, the one shown and its area", () => {
  const memory = tabMemory();
  const before = page("/s/a", memory);
  before.registry();
  before.selected("a");
  before.navigation.openChanges();
  before.navigation.openFile("docs/guide.md");
  before.navigation.openFile("README.md");
  before.navigation.selectTab("file:docs/guide.md");
  before.navigation.showAgent();

  const after = page("/s/a", memory);
  assert.deepEqual(shownTabs(after.navigation), { tabs: [], active: null, area: "agent" });
  after.registry();
  after.selected("a");
  assert.deepEqual(shownTabs(after.navigation), {
    tabs: ["changes", "file:docs/guide.md", "file:README.md"],
    active: "file:docs/guide.md",
    area: "agent",
  });

  after.navigation.closeTab("changes");
  const again = page("/s/a", memory);
  again.registry();
  again.selected("a");
  assert.deepEqual(
    shownTabs(again.navigation).tabs,
    ["file:docs/guide.md", "file:README.md"],
    "a closed tab stays closed",
  );
});

test("a reload brings back only the session last shown, and nothing once a page replaced it", () => {
  const memory = tabMemory();
  const p = page("/s/a", memory);
  p.registry();
  p.selected("a");
  p.navigation.openChanges();
  p.navigation.select("/scratch", "b");
  p.selected("b");
  p.navigation.select("/scratch", "a");
  p.selected("a");
  assert.deepEqual(
    shownTabs(p.navigation).tabs,
    [],
    "coming back to a session without a reload starts on its Agent area",
  );

  p.navigation.openFile("README.md");
  const other = page("/s/b", memory);
  other.registry();
  other.selected("b");
  assert.deepEqual(shownTabs(other.navigation).tabs, [], "another session's tabs stay its own");

  const q = page("/s/a", memory);
  q.registry();
  q.selected("a");
  q.navigation.openFile("README.md");
  q.navigation.openNew();
  const fresh = page("/s/a", memory);
  fresh.registry();
  fresh.selected("a");
  assert.deepEqual(shownTabs(fresh.navigation).tabs, [], "leaving for the New page forgets them");
});

test("every move among a session's areas leaves Settings, so the move shows", () => {
  const p = page("/new");
  p.registry();
  p.navigation.select("/scratch", "a");
  p.selected("a");
  p.navigation.openChanges();
  p.navigation.openFile("docs/guide.md");
  const overSettings = (move: () => void) => {
    p.navigation.openSettings("radius");
    move();
    return p.navigation.getState();
  };

  p.navigation.setSingle(true);
  const agent = overSettings(() => p.navigation.showAgent());
  assert.equal(agent.settings, null);
  assert.equal(shownTabs(p.navigation).area, "agent");

  const closed = overSettings(() => p.navigation.closeTab("file:docs/guide.md"));
  assert.equal(closed.settings, null);
  assert.deepEqual(shownTabs(p.navigation).tabs, ["changes"]);
});

test("a session's surfaces close when another session is selected, and opening one leaves Settings", () => {
  const p = page("/new");
  p.registry();
  p.navigation.select("/scratch", "a");
  p.selected("a");
  p.navigation.openSettings();
  p.navigation.openChanges();
  assert.equal(p.navigation.getState().settings, null);
  assert.deepEqual(shownTabs(p.navigation), {
    tabs: ["changes"],
    active: "changes",
    area: "surface",
  });
  p.navigation.openFile("docs/guide.md");
  assert.equal(p.path(), "/s/a", "a file preview never puts its path in the address bar");

  p.navigation.openPullRequest();
  assert.equal(p.navigation.getState().pullRequest, true);
  assert.equal(
    shownTabs(p.navigation).active,
    "file:docs/guide.md",
    "the PR opens over the nonmodal Surface area without replacing it",
  );
  p.navigation.closePullRequest();

  p.navigation.openPullRequest();
  p.navigation.select("/scratch", "b");
  p.selected("b");
  assert.deepEqual(
    shownTabs(p.navigation),
    { tabs: [], active: null, area: "agent" },
    "another session starts on its Agent area with no tabs",
  );
  assert.equal(p.navigation.getState().pullRequest, false);
  p.navigation.openChanges();
  p.navigation.openPullRequest();
  p.navigation.openNew();
  assert.equal(p.navigation.getState().surface, null, "the New page has no Surface area");
  assert.equal(p.navigation.getState().pullRequest, false);
});

test("choosing Changes again shows its one tab in place: no toggle, no duplicate, no history entry", () => {
  const p = page("/new");
  p.registry();
  p.navigation.select("/scratch", "a");
  p.selected("a");
  const entries = p.entries.length;
  p.navigation.openChanges();
  const first = p.navigation.getState().surfaceRequest;
  p.navigation.openChanges();
  assert.deepEqual(shownTabs(p.navigation), {
    tabs: ["changes"],
    active: "changes",
    area: "surface",
  });
  assert.ok(
    p.navigation.getState().surfaceRequest > first,
    "a repeat is still a request, so the tab takes focus",
  );
  assert.equal(p.entries.length, entries, "showing a surface is local view state, not a route");

  p.navigation.openFile("README.md");
  p.navigation.openChanges();
  assert.deepEqual(
    shownTabs(p.navigation),
    { tabs: ["changes", "file:README.md"], active: "changes", area: "surface" },
    "Changes shows beside the open file's tab, not in place of it",
  );
});

/** What sits on the Agent area's right side by side: the session rail, the Surface area, or nothing. */
function rightSide(navigation: ReturnType<typeof createNavigation>) {
  const { layout } = navigation.getState();
  return layout.rail ? "rail" : layout.surface ? "surface" : null;
}

/** A browser's localStorage for one preference, which outlives every page. */
function railStorage(): PreferenceStorage {
  const values = new Map<string, string>();
  return {
    read: (key) => values.get(key) ?? null,
    write: (key, value) => {
      values.set(key, value);
    },
    onChange: () => () => {},
  };
}

const railPreference = (storage: PreferenceStorage) =>
  createPreference<boolean>({ key: "rail", decode: (raw) => raw === "true", storage });

test("side by side, the session rail and the Surface area share the right side: whichever came in last shows", () => {
  const p = page("/s/a");
  p.registry();
  p.selected("a");
  assert.equal(rightSide(p.navigation), null, "the rail starts off");

  p.navigation.toggleRail();
  assert.equal(rightSide(p.navigation), "rail");

  p.navigation.openChanges();
  assert.equal(rightSide(p.navigation), "surface", "a surface coming in hides the session rail");
  assert.equal(p.navigation.getState().rail, true, "hidden, the session rail stays on");

  p.navigation.closeTab("changes");
  assert.equal(
    rightSide(p.navigation),
    "rail",
    "the last tab closing brings the session rail back",
  );

  p.navigation.openFile("README.md");
  p.navigation.toggleRail();
  assert.equal(
    rightSide(p.navigation),
    "rail",
    "turned on over a surface, the session rail covers it",
  );
  assert.deepEqual(shownTabs(p.navigation).tabs, ["file:README.md"], "the covered tabs wait");

  p.navigation.toggleRail();
  assert.equal(rightSide(p.navigation), "surface", "turned off, the covered surface returns");

  p.navigation.toggleRail();
  p.navigation.selectTab("file:README.md");
  assert.equal(rightSide(p.navigation), "surface", "showing a tab uncovers the surface");
  p.navigation.toggleRail();
  assert.equal(rightSide(p.navigation), "rail");
  p.navigation.toggleRail();
  assert.equal(rightSide(p.navigation), "surface");
  assert.equal(p.navigation.getState().rail, false);
});

test("the session rail is one choice for every session, and the browser remembers it", () => {
  const storage = railStorage();
  const before = page("/s/a", undefined, railPreference(storage));
  before.registry();
  before.selected("a");
  before.navigation.toggleRail();
  before.navigation.select("/scratch", "b");
  before.selected("b");
  assert.equal(rightSide(before.navigation), "rail", "another session shows its the session rail");

  const after = page("/s/a", undefined, railPreference(storage));
  after.registry();
  after.selected("a");
  assert.equal(rightSide(after.navigation), "rail", "a new page starts with the session rail on");
  after.navigation.toggleRail();

  const off = page("/s/a", undefined, railPreference(storage));
  off.registry();
  off.selected("a");
  assert.equal(rightSide(off.navigation), null);
});

test("a reload keeps the session rail over the tabs it covered, unless it was turned off meanwhile", () => {
  const memory = tabMemory();
  const storage = railStorage();
  const before = page("/s/a", memory, railPreference(storage));
  before.registry();
  before.selected("a");
  before.navigation.openChanges();
  before.navigation.toggleRail();
  assert.equal(rightSide(before.navigation), "rail");

  const after = page("/s/a", memory, railPreference(storage));
  after.registry();
  after.selected("a");
  assert.equal(rightSide(after.navigation), "rail", "the rail still covers the tabs");
  assert.deepEqual(shownTabs(after.navigation).tabs, ["changes"], "the covered tabs wait");
  after.navigation.toggleRail();
  assert.equal(rightSide(after.navigation), "surface", "turned off, the covered tabs return");

  // Another tab of this browser turned the rail off (`storage` now says so) while this one was
  // away with the tabs covered: the tabs show, since no rail covers them.
  const away = tabMemory();
  const left = page("/s/a", away, railPreference(railStorage()));
  left.registry();
  left.selected("a");
  left.navigation.openChanges();
  left.navigation.toggleRail();
  assert.equal(rightSide(left.navigation), "rail");
  const off = page("/s/a", away, railPreference(storage));
  off.registry();
  off.selected("a");
  assert.equal(rightSide(off.navigation), "surface", "nothing is covered by a rail that is off");
});

test("one area at a time the session rail never shows, and comes back once the session is wide", () => {
  const p = page("/s/a");
  p.registry();
  p.selected("a");
  p.navigation.toggleRail();
  assert.equal(rightSide(p.navigation), "rail");

  p.navigation.setSingle(true);
  assert.deepEqual(p.navigation.getState().layout, {
    single: true,
    agent: true,
    surface: false,
    rail: false,
    agentTab: false,
  });

  p.navigation.setSingle(false);
  assert.equal(rightSide(p.navigation), "rail", "the switch was kept");
});

test("a reload drops a the session rail tab kept by an older Piano and keeps the other tabs", () => {
  const memory = tabMemory();
  memory.write(
    JSON.stringify({
      owner: sessionKey({ cwd: "/scratch", sessionId: "a" }),
      surface: { tabs: ["changes", "details"], active: "changes" },
      area: "surface",
    }),
  );
  const p = page("/s/a", memory);
  p.registry();
  p.selected("a");
  assert.deepEqual(shownTabs(p.navigation), {
    tabs: ["changes"],
    active: "changes",
    area: "surface",
  });
});

test("each new view is added at the end, Changes included; reopening one keeps its place", () => {
  const p = page("/new");
  p.registry();
  p.navigation.select("/scratch", "a");
  p.selected("a");
  p.navigation.openFile("docs/a.md");
  p.navigation.openChanges();
  p.navigation.openFile("docs/b.md");
  assert.deepEqual(shownTabs(p.navigation).tabs, ["file:docs/a.md", "changes", "file:docs/b.md"]);
  p.navigation.openChanges();
  p.navigation.openFile("docs/a.md");
  assert.deepEqual(shownTabs(p.navigation), {
    tabs: ["file:docs/a.md", "changes", "file:docs/b.md"],
    active: "file:docs/a.md",
    area: "surface",
  });
  p.navigation.closeTab("changes");
  p.navigation.openChanges();
  assert.deepEqual(
    shownTabs(p.navigation).tabs,
    ["file:docs/a.md", "file:docs/b.md", "changes"],
    "a closed view opened again is new, so it joins the end",
  );
});

test("files open as tabs once each; closing a tab shows its neighbour, the last hides the area", () => {
  const p = page("/new");
  p.registry();
  p.navigation.select("/scratch", "a");
  p.selected("a");
  p.navigation.openChanges();
  p.navigation.openFile("docs/a.md");
  p.navigation.openFile("docs/b.md");
  p.navigation.openFile("docs/a.md");
  assert.deepEqual(
    shownTabs(p.navigation),
    {
      tabs: ["changes", "file:docs/a.md", "file:docs/b.md"],
      active: "file:docs/a.md",
      area: "surface",
    },
    "an open file is shown again, never opened twice",
  );
  p.navigation.selectTab("file:docs/b.md");
  p.navigation.closeTab("file:docs/b.md");
  assert.deepEqual(shownTabs(p.navigation).active, "file:docs/a.md");
  p.navigation.closeTab("changes");
  assert.deepEqual(
    shownTabs(p.navigation),
    { tabs: ["file:docs/a.md"], active: "file:docs/a.md", area: "surface" },
    "closing a tab that is not shown leaves the shown one",
  );
  p.navigation.closeTab("file:docs/a.md");
  assert.deepEqual(shownTabs(p.navigation), { tabs: [], active: null, area: "agent" });
});

test("a file opens as one tab however its path is spelled", () => {
  const p = page("/new");
  p.registry();
  p.navigation.select("/scratch", "a");
  p.selected("a");
  p.navigation.openFile("README.md");
  p.navigation.openFile("/scratch/README.md");
  p.navigation.openFile("./README.md");
  p.navigation.openFile("docs/../README.md");
  p.navigation.openFile("docs//guide.md");
  assert.deepEqual(shownTabs(p.navigation).tabs, ["file:README.md", "file:docs/guide.md"]);
  p.navigation.openFile("/elsewhere/../scratch/docs/guide.md");
  p.navigation.openFile("/scratchpad/notes.md");
  p.navigation.openFile("../outside.md");
  assert.deepEqual(
    shownTabs(p.navigation),
    {
      tabs: [
        "file:README.md",
        "file:docs/guide.md",
        "file:/scratchpad/notes.md",
        "file:../outside.md",
      ],
      active: "file:../outside.md",
      area: "surface",
    },
    "a path outside the session's directory keeps its own spelling",
  );
});

test("one area at a time, closing a file opened from the Agent area returns there", () => {
  const p = page("/new");
  p.registry();
  p.navigation.select("/scratch", "a");
  p.selected("a");
  p.navigation.setSingle(true);
  p.navigation.openChanges();
  p.navigation.showAgent();
  assert.deepEqual(
    shownTabs(p.navigation),
    { tabs: ["changes"], active: "changes", area: "agent" },
    "Agent keeps Changes for later",
  );
  p.navigation.openFile("docs/a.md");
  p.navigation.closeTab("file:docs/a.md");
  assert.deepEqual(shownTabs(p.navigation), {
    tabs: ["changes"],
    active: "changes",
    area: "agent",
  });

  p.navigation.openChanges();
  p.navigation.openFile("docs/b.md");
  p.navigation.closeTab("file:docs/b.md");
  assert.deepEqual(
    shownTabs(p.navigation),
    { tabs: ["changes"], active: "changes", area: "surface" },
    "opened from Changes, back to Changes",
  );
  p.navigation.showAgent();
  p.navigation.selectTab("changes");
  assert.equal(shownTabs(p.navigation).area, "surface", "the Changes tab shows it again");
});

test("a file remembers the area it was opened from when the layout narrows", () => {
  const p = page("/new");
  p.registry();
  p.navigation.select("/scratch", "a");
  p.selected("a");
  p.navigation.openChanges();
  p.navigation.openFile("docs/a.md", "agent");
  p.navigation.openFile("docs/b.md", "surface");
  p.navigation.setSingle(true);
  p.navigation.closeTab("file:docs/b.md");
  assert.deepEqual(
    shownTabs(p.navigation),
    { tabs: ["changes", "file:docs/a.md"], active: "file:docs/a.md", area: "surface" },
    "opened from a file, back to the Surface area",
  );
  p.navigation.closeTab("file:docs/a.md");
  assert.deepEqual(
    shownTabs(p.navigation),
    { tabs: ["changes"], active: "changes", area: "agent" },
    "opened from the transcript side by side, back to Agent one area at a time",
  );
});

test("one area at a time, a file opened again returns to the area of its latest link", () => {
  const p = page("/new");
  p.registry();
  p.navigation.select("/scratch", "a");
  p.selected("a");
  p.navigation.setSingle(true);
  p.navigation.openFile("docs/a.md", "agent");
  p.navigation.openFile("docs/b.md", "surface");
  p.navigation.showAgent();
  p.navigation.openFile("docs/b.md", "agent");
  assert.deepEqual(
    shownTabs(p.navigation),
    { tabs: ["file:docs/a.md", "file:docs/b.md"], active: "file:docs/b.md", area: "surface" },
    "the open file's one tab shows again",
  );
  p.navigation.closeTab("file:docs/b.md");
  assert.deepEqual(
    shownTabs(p.navigation),
    { tabs: ["file:docs/a.md"], active: "file:docs/a.md", area: "agent" },
    "its latest link was in the transcript, so back to Agent",
  );
});

test("every tab closes at every width; one area at a time, closing the last returns to Agent", () => {
  const p = page("/new");
  p.registry();
  p.navigation.select("/scratch", "a");
  p.selected("a");
  p.navigation.openChanges();
  p.navigation.openFile("docs/a.md");
  p.navigation.setSingle(true);
  p.navigation.closeTab("file:docs/a.md");
  assert.deepEqual(
    shownTabs(p.navigation),
    { tabs: ["changes"], active: "changes", area: "agent" },
    "a file opened from the transcript returns there",
  );
  p.navigation.selectTab("changes");
  p.navigation.closeTab("changes");
  assert.deepEqual(
    shownTabs(p.navigation),
    { tabs: [], active: null, area: "agent" },
    "one area at a time, Changes closes too",
  );
});

test("side by side both areas show while there are tabs; one area at a time, the one moved to", () => {
  const p = page("/new");
  p.registry();
  p.navigation.select("/scratch", "a");
  p.selected("a");
  const shown = () => {
    const { agent, surface } = p.navigation.getState().layout;
    return { agent, surface };
  };
  assert.deepEqual(shown(), { agent: true, surface: false }, "no tabs: only the Agent area");
  p.navigation.openChanges();
  assert.deepEqual(shown(), { agent: true, surface: true }, "side by side");
  p.navigation.setSingle(true);
  assert.deepEqual(shown(), { agent: false, surface: true }, "narrow: Changes, just opened");
  p.navigation.showAgent();
  assert.deepEqual(shown(), { agent: true, surface: false }, "narrow: back on Agent");
  p.navigation.setSingle(false);
  assert.deepEqual(shown(), { agent: true, surface: true }, "wide again: both");
  p.navigation.closeTab("changes");
  p.navigation.setSingle(true);
  assert.deepEqual(shown(), { agent: true, surface: false }, "nothing open stays on Agent");
});

test("the layout and Settings leave the session's tabs as they were", () => {
  const p = page("/new");
  p.registry();
  p.navigation.select("/scratch", "a");
  p.selected("a");
  p.navigation.openChanges();
  p.navigation.setSingle(true);
  p.navigation.showAgent();
  p.navigation.openSettings();
  p.navigation.closeSettings();
  p.navigation.setSingle(false);
  assert.deepEqual(
    shownTabs(p.navigation).tabs,
    ["changes"],
    "Changes chosen one at a time shows beside Agent",
  );
});

test("a Surface tab is on screen only while nothing covers it", () => {
  const p = page("/new", undefined, railPreference(railStorage()));
  p.registry();
  p.navigation.select("/scratch", "a");
  p.selected("a");
  const shownTab = () => p.navigation.getState().shownTab;
  assert.equal(shownTab(), null, "no tabs");
  p.navigation.openChanges();
  assert.equal(shownTab(), "changes");
  p.navigation.openSettings();
  assert.equal(shownTab(), null, "Settings covers the session");
  p.navigation.closeSettings();
  assert.equal(shownTab(), "changes");
  p.navigation.toggleRail();
  assert.equal(shownTab(), null, "the rail, turned on last, covers the Surface area");
  p.navigation.toggleRail();
  p.navigation.setSingle(true);
  assert.equal(shownTab(), "changes", "one area at a time, Changes just opened");
  p.navigation.showAgent();
  assert.equal(shownTab(), null, "one area at a time, the Agent area shows instead");
  p.navigation.openFile("README.md");
  assert.equal(shownTab(), "file:README.md");
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

test("a move that changes nothing notifies no one and leaves the address bar alone", () => {
  const p = page("/new");
  p.registry();
  let notified = 0;
  p.navigation.subscribe(() => notified++);
  const before = {
    state: p.navigation.getState(),
    titles: p.titles.length,
    entries: [...p.entries],
    reads: p.reads(),
  };
  p.navigation.setSingle(false);
  p.navigation.setSingle(false);
  p.navigation.setPalette(false);
  p.navigation.closePullRequest();
  p.navigation.closeSettings();
  p.navigation.showAgent();
  assert.equal(notified, 0, "an unchanged move notified a subscriber");
  assert.equal(p.navigation.getState(), before.state, "the state keeps its identity");
  assert.equal(p.titles.length, before.titles, "no title written");
  assert.deepEqual(p.entries, before.entries, "no history entry");
  assert.equal(p.reads(), before.reads, "an unchanged move read the client, so it settled");
  assert.equal(
    p.moves(),
    2,
    "a request to see an area or leave Settings is a move, changed or not",
  );
  p.navigation.setSingle(true);
  assert.equal(notified, 1, "a move that changed the layout notifies once");
  assert.equal(p.navigation.getState().single, true);
  p.navigation.openSettings("radius");
  assert.equal(notified, 2);
  assert.equal(p.path(), "/settings/radius", "a real move still syncs the address");
});

test("selecting another session with the same areas notifies no navigation subscriber", () => {
  const p = page("/new");
  p.registry();
  p.navigation.select("/scratch", "a");
  p.selected("a");
  let notified = 0;
  p.navigation.subscribe(() => notified++);
  const before = p.navigation.getState();
  p.navigation.select("/scratch", "b");
  p.selected("b");
  assert.equal(p.client.getState().session?.sessionId, "b", "the client store carries the change");
  assert.equal(p.path(), "/s/b", "the address follows the client");
  assert.equal(p.navigation.getState(), before, "the areas are as they were: no new state");
  assert.equal(
    notified,
    0,
    "a session change with unchanged areas notified a navigation subscriber",
  );
});
