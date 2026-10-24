import assert from "node:assert/strict";
import { test } from "node:test";
import type { FolderView, SessionEvent } from "../shared/wire.ts";
import type { PreferenceStorage } from "../web/src/lib/preference.ts";
import type { SessionEntry } from "../web/src/lib/sessionCatalog.ts";
import {
  createSidebarList,
  PINNED,
  type SidebarClock,
  type SidebarList,
  sidebarPreferences,
} from "../web/src/lib/sidebarList.ts";
import type { GroupBy, SidebarView } from "../web/src/lib/sidebarView.ts";
import { type AppState, initialState, reduce, sessionKey } from "../web/src/store.ts";
import { sessionReference } from "./fixtures/sessionReference.ts";

const folder = (path: string, worktrees: string[] = [path]): FolderView => ({
  path,
  name: path.slice(1),
  worktrees: worktrees.map((p) => ({
    workspace: { id: `ws:${p}`, folder: path, path: p },
    trust: { required: false, trusted: true },
    branch: "main",
    path: p,
    root: p === path,
    status: "current",
  })),
  discovery: { status: "ready", observedAt: "", currentPath: path, worktrees: [] },
});
const loaded: AppState = { ...initialState, registryLoaded: true };
const registry: AppState = {
  ...loaded,
  folders: [folder("/repo", ["/repo", "/work/repo.feature"]), folder("/other")],
  projects: [{ id: "p1", name: "Launch" }],
  sessionReferences: [sessionReference("/work/repo.feature", "s1", { projectId: "p1" })],
};
const view = (groupBy: GroupBy): SidebarView => ({ groupBy, sortBy: "name" });
const GROUPINGS: GroupBy[] = ["folder", "project", "date", "none"];
const titles = (items: ReadonlyArray<{ title?: string }>) => items.map((s) => s.title);
const selecting = (state: AppState, cwd: string, sessionId: string | null): AppState => ({
  ...state,
  selecting: { cwd, sessionId },
});

/** Local storage for one page; `writes` counts what the list stored. */
function memoryStorage(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  const storage: PreferenceStorage = {
    read: (key) => items.get(key) ?? null,
    write: (key, value) => void items.set(key, value),
    onChange: () => () => {},
  };
  return { items, storage };
}

/** A clock the test moves; `fire` runs the wake-up that is due, as the page's timer would. */
function fakeClock(start: Date) {
  let now = start;
  let timer: { at: number; wake: () => void } | null = null;
  const resumes = new Set<() => void>();
  const clock: SidebarClock = {
    now: () => now,
    wakeAfter: (ms, wake) => {
      const pending = { at: now.getTime() + ms, wake };
      timer = pending;
      return () => {
        if (timer === pending) timer = null;
      };
    },
    onResume: (wake) => {
      resumes.add(wake);
      return () => resumes.delete(wake);
    },
  };
  return {
    clock,
    /** Moves to `to`, running the timer if it falls due on the way. */
    advance: (to: Date) => {
      now = to;
      if (timer && timer.at <= to.getTime()) timer.wake();
    },
    /** Jumps without the timer, as sleep or a clock change does; only a resume notices. */
    jump: (to: Date) => {
      now = to;
    },
    resume: () => {
      for (const wake of resumes) wake();
    },
    pendingAt: () => timer?.at ?? null,
  };
}

function sidebar(stored: Record<string, string> = {}, now = new Date(2026, 9, 2)) {
  const { items, storage } = memoryStorage(stored);
  const time = fakeClock(now);
  const model = createSidebarList({ clock: time.clock, preferences: sidebarPreferences(storage) });
  let changes = 0;
  model.subscribe(() => changes++);
  return { model, items, time, changes: () => changes };
}

/** Each section's key and whether it is open, Pinned first. */
const openness = (list: SidebarList) => [
  ...(list.pinned ? [[list.pinned.key, list.pinned.open]] : []),
  ...(list.body?.kind === "sections"
    ? list.body.sections.map((s) => [s.key, "open" in s ? s.open : null])
    : []),
];
const isOpen = (list: SidebarList, key: string) =>
  openness(list).find(([k]) => k === key)?.[1] ?? null;

test("sidebar list: sequenced transcript, tool and usage updates reuse even a collapsed selected folder", () => {
  for (const groupBy of GROUPINGS) {
    const { model } = sidebar();
    const chosen = view(groupBy);
    const identity = { cwd: "/work/repo.feature", sessionId: "s1" };
    let state = reduce(
      { ...registry, connected: true },
      { type: "selecting", selectionId: "selection", ...identity },
    );
    state = reduce(state, {
      type: "server",
      message: {
        _tag: "selected",
        selectionId: "selection",
        ...identity,
        hosted: true,
        cursor: { ...identity, generation: "host", sequence: 0 },
        snapshot: { state: { sessionId: "s1", isStreaming: true }, messages: [], dialogs: [] },
      },
    });
    model.sync(state, chosen);
    model.toggle("/repo", false);
    const before = state;
    const list = model.list(state, chosen);
    const events: SessionEvent[] = [
      { _tag: "message_update", message: { id: "reply", role: "assistant", text: "partial" } },
      { _tag: "message_update", message: { id: "reply", role: "assistant", text: "more text" } },
      {
        _tag: "tool_update",
        tool: {
          id: "tool",
          name: "bash",
          args: "{}",
          status: "running",
          text: "output",
          outputKind: "latest-update",
        },
      },
      {
        _tag: "state",
        state: { sessionId: "s1", isStreaming: true, cost: 0.42, statsUpdatedAt: 1 },
      },
    ];
    for (const [index, event] of events.entries()) {
      state = reduce(state, {
        type: "server",
        message: {
          _tag: "session",
          selectionId: "selection",
          cursor: { ...identity, generation: "host", sequence: index + 1 },
          event,
        },
      });
      assert.notEqual(state, before);
      assert.equal(state.session?.cursor?.sequence, index + 1, "the reducer applied the event");
      for (const key of ["sessionReferences", "folders", "projects", "hosts", "done"] as const)
        assert.equal(state[key], before[key], key);
      model.sync(state, chosen);
      assert.equal(model.list(state, chosen), list, `${groupBy}: ${event._tag}`);
    }
    assert.equal(state.session?.pending?.text, "more text");
    assert.equal(state.session?.tools?.[0]?.text, "output");
    assert.equal(state.session?.state.cost, 0.42);
    if (groupBy === "folder") assert.equal(isOpen(list, "/repo"), false);
  }
});

test("sidebar list: cached rows still follow every catalog fact", () => {
  const a = sessionReference("/repo", "a", { title: "Alpha" });
  const b = sessionReference("/closed", "b", { title: "Beta", projectId: "p1" });
  const state: AppState = {
    ...registry,
    sessionReferences: [a, b],
  };
  const rows = (list: SidebarList): SessionEntry[] =>
    list.body?.kind === "sections" ? list.body.sections.flatMap((s) => s.sessions) : [];
  const cases: Array<{
    name: string;
    patch: Partial<AppState>;
    check: (list: SidebarList) => void;
  }> = [
    {
      name: "title and order",
      patch: { sessionReferences: [{ ...a, title: "Zulu" }, b] },
      check: (list) => assert.deepEqual(titles(rows(list)), ["Beta", "Zulu"]),
    },
    {
      name: "availability",
      patch: { sessionReferences: [{ ...a, unavailable: "history" }, b] },
      check: (list) => assert.equal(rows(list)[0]?.disabled, true),
    },
    {
      name: "pins",
      patch: { sessionReferences: [{ ...a, pinned: true }, b] },
      check: (list) => {
        assert.deepEqual(titles(list.pinned?.sessions ?? []), ["Alpha"]);
        assert.deepEqual(titles(rows(list)), ["Beta"]);
      },
    },
    {
      name: "archives",
      patch: { sessionReferences: [{ ...a, archived: true }, b] },
      check: (list) => assert.deepEqual(titles(rows(list)), ["Beta"]),
    },
    {
      name: "project membership",
      patch: { sessionReferences: [a, { ...b, projectId: undefined }] },
      check: (list) => assert.deepEqual(titles(rows(list)), ["Alpha"]),
    },
    {
      name: "project rename",
      patch: { projects: [{ id: "p1", name: "Renamed" }] },
      check: (list) => assert.equal(rows(list)[1]?.project?.name, "Renamed"),
    },
    {
      name: "folder removal",
      patch: { folders: [] },
      check: (list) => assert.deepEqual(titles(rows(list)), ["Beta"]),
    },
    {
      name: "host activity",
      patch: { hosts: [{ cwd: a.cwd, sessionId: a.sessionId, streaming: true }] },
      check: (list) => assert.equal(rows(list)[0]?.activity, "working"),
    },
    {
      name: "done markers",
      patch: { done: [sessionKey(a)] },
      check: (list) => assert.equal(rows(list)[0]?.activity, "done"),
    },
    {
      name: "registry readiness",
      patch: { registryLoaded: false },
      check: (list) => assert.equal(list.body?.kind, "loading"),
    },
  ];
  for (const { name, patch, check } of cases) {
    const { model } = sidebar();
    const chosen = view("none");
    const before = model.list(state, chosen);
    const after = model.list({ ...state, ...patch }, chosen);
    assert.notEqual(after, before, name);
    check(after);
  }
});

test("sidebar list: selection follows cwd and session id, not the snapshot or selecting object", () => {
  const { model } = sidebar();
  const chosen = view("none");
  const state = {
    ...registry,
    sessionReferences: [
      sessionReference("/repo", "a"),
      sessionReference("/other", "a"),
      sessionReference("/other", "b"),
    ],
  };
  const selectedKeys = (list: SidebarList) =>
    list.body?.kind === "sections"
      ? list.body.sections.flatMap((s) => s.sessions.filter((r) => r.selected).map(sessionKey))
      : [];
  let previous = model.list(state, chosen);
  assert.deepEqual(selectedKeys(previous), []);
  for (const [cwd, sessionId] of [
    ["/repo", "a"],
    ["/other", "a"],
    ["/other", "b"],
  ] as const) {
    const pending = selecting(state, cwd, sessionId);
    const list = model.list(pending, chosen);
    assert.notEqual(list, previous);
    assert.deepEqual(selectedKeys(list), [sessionKey({ cwd, sessionId })]);
    assert.equal(model.list(selecting(state, cwd, sessionId), chosen), list);
    const selected: AppState = {
      ...pending,
      selecting: null,
      session: {
        cwd,
        sessionId,
        hosted: true,
        cursor: null,
        state: { sessionId, isStreaming: false },
        messages: [],
        dialogs: [],
      },
    };
    assert.equal(model.list(selected, chosen), list, "the selected snapshot has the same identity");
    previous = list;
  }
  assert.deepEqual(
    selectedKeys(model.list(state, chosen)),
    [],
    "leaving the session clears selection",
  );
});

test("sidebar list: view and open preferences invalidate an otherwise unchanged list", () => {
  const { model } = sidebar();
  const state: AppState = {
    ...registry,
    sessionReferences: [
      sessionReference("/repo", "a", { title: "Alpha", updatedAt: "2026-10-01T01:00:00Z" }),
      sessionReference("/repo", "b", { title: "Beta", updatedAt: "2026-10-01T02:00:00Z" }),
      sessionReference("/repo", "p", { title: "Pinned", pinned: true }),
    ],
  };
  const byName = view("none");
  const names = (chosen: SidebarView) => {
    const list = model.list(state, chosen);
    return list.body?.kind === "sections" ? titles(list.body.sections[0]!.sessions) : [];
  };
  assert.deepEqual(names(byName), ["Alpha", "Beta"]);
  assert.deepEqual(names({ ...byName, sortBy: "recent" }), ["Beta", "Alpha"]);
  const byFolder = view("folder");
  assert.equal(isOpen(model.list(state, byFolder), "/repo"), false);
  model.toggle("/repo", true);
  assert.equal(isOpen(model.list(state, byFolder), "/repo"), true);
  assert.equal(model.list(state, byFolder).pinned?.open, true);
  model.toggle(PINNED, false);
  assert.equal(model.list(state, byFolder).pinned?.open, false);
});

test("sidebar list: before the registry arrives every grouping is loading, with no Pinned section", () => {
  const { model } = sidebar();
  const state: AppState = {
    ...initialState,
    folders: [folder("/repo")],
    sessionReferences: [sessionReference("/repo", "p", { pinned: true })],
  };
  for (const groupBy of GROUPINGS)
    assert.deepEqual(model.list(state, view(groupBy)), {
      pinned: null,
      body: { kind: "loading" },
    });
});

test("sidebar list: an empty registry says what to do next, per grouping; pinned rows stand in for it", () => {
  const { model } = sidebar();
  const noSessions = "No sessions yet. Start one and it appears here.";
  const expected: Record<GroupBy, string> = {
    folder: "No folders yet. Start a session in any folder and it appears here.",
    project: noSessions,
    date: noSessions,
    none: noSessions,
  };
  for (const groupBy of GROUPINGS)
    assert.deepEqual(model.list(loaded, view(groupBy)), {
      pinned: null,
      body: { kind: "empty", text: expected[groupBy] },
    });
  // An open folder without sessions is a folder group, not the empty state.
  const withFolder: AppState = { ...loaded, folders: [folder("/repo")] };
  assert.deepEqual(openness(model.list(withFolder, view("folder"))), [["/repo", false]]);
  assert.equal(model.list(withFolder, view("date")).body?.kind, "empty");

  // Its folder was closed, so no regular group lists it.
  const pinnedOnly: AppState = {
    ...loaded,
    sessionReferences: [sessionReference("/closed/app", "p", { title: "Pinned", pinned: true })],
  };
  for (const groupBy of GROUPINGS) {
    const list = model.list(pinnedOnly, view(groupBy));
    assert.deepEqual(titles(list.pinned?.sessions ?? []), ["Pinned"]);
    assert.equal(list.body, null, groupBy);
  }
});

test("sidebar list: a pinned session shows only under Pinned, even when its folder is closed", () => {
  const { model } = sidebar();
  const state: AppState = {
    ...loaded,
    folders: [folder("/repo")],
    sessionReferences: [
      sessionReference("/repo", "pinned-open", { title: "Pinned open", pinned: true }),
      sessionReference("/repo", "unfiled", { title: "Unfiled" }),
      sessionReference("/closed/app", "pinned-closed", { title: "Pinned closed", pinned: true }),
    ],
  };
  const rows = (groupBy: GroupBy) => {
    const list = model.list(state, view(groupBy));
    return {
      pinned: titles(list.pinned?.sessions ?? []),
      sections:
        list.body?.kind === "sections"
          ? list.body.sections.map((s) => [s.key, titles(s.sessions)])
          : list.body,
    };
  };
  assert.deepEqual(rows("folder"), {
    pinned: ["Pinned closed", "Pinned open"],
    sections: [["/repo", ["Unfiled"]]],
  });
  assert.deepEqual(rows("none").sections, [["list", ["Unfiled"]]]);
  assert.deepEqual(rows("date").sections, [["date:Yesterday", ["Unfiled"]]]);
});

test("sidebar list: a project without members is listed with the No project group, not the empty state", () => {
  const { model } = sidebar();
  const state: AppState = { ...loaded, projects: [{ id: "launch", name: "Launch" }] };
  const list = model.list(state, view("project"));
  assert.equal(list.body?.kind, "sections");
  if (list.body?.kind === "sections")
    assert.deepEqual(
      list.body.sections.map((s) => [s.key, s.kind === "project" ? s.project?.name : s.kind]),
      [
        ["project:launch", "Launch"],
        ["project:", undefined],
      ],
    );
  assert.equal(model.list({ ...state, projects: [] }, view("project")).body?.kind, "empty");
});

test("sidebar list: selecting a session opens the section holding it: its folder (from any worktree), its project, or Pinned", () => {
  const pinned: AppState = {
    ...registry,
    sessionReferences: [
      ...registry.sessionReferences,
      sessionReference("/other", "s2", { title: "Pinned plan", pinned: true }),
    ],
  };
  const { model, items } = sidebar({ "piano.pinnedOpen": "false" });
  const feature = selecting(pinned, "/work/repo.feature", "s1");
  model.sync(feature, view("folder"));
  assert.equal(isOpen(model.list(feature, view("folder")), "/repo"), true);
  model.sync(feature, view("project"));
  assert.equal(isOpen(model.list(feature, view("project")), "project:p1"), true);

  // A new session, or one never filed, belongs to No project.
  for (const sessionId of ["unfiled", null]) {
    const other = selecting(pinned, "/other", sessionId);
    model.sync(other, view("project"));
    assert.equal(isOpen(model.list(other, view("project")), "project:"), true, `${sessionId}`);
  }

  // A pinned session lives only in Pinned, so Pinned opens, not its folder or project.
  const before = openness(model.list(pinned, view("folder")));
  assert.equal(isOpen(model.list(pinned, view("folder")), PINNED), false);
  const pinnedSelected = selecting(pinned, "/other", "s2");
  model.sync(pinnedSelected, view("folder"));
  const after = model.list(pinnedSelected, view("folder"));
  assert.equal(after.pinned?.open, true, "selecting a pinned session opens Pinned");
  assert.deepEqual(
    openness(after).filter(([k]) => k !== PINNED),
    before.filter(([k]) => k !== PINNED),
    "no other section changes",
  );
  assert.equal(items.get("piano.pinnedOpen"), "true", "and stays open on the next load");

  // Under date or no grouping Pinned is still the session's section.
  model.toggle(PINNED, false);
  model.sync(pinnedSelected, view("date"));
  assert.equal(model.list(pinnedSelected, view("date")).pinned?.open, true);
});

test("sidebar list: a registry refresh never reopens a section the user collapsed; a new selection, grouping or owner does", () => {
  const { model, changes } = sidebar();
  const selected = selecting(registry, "/work/repo.feature", "s1");
  model.sync(selected, view("folder"));
  model.toggle("/repo", false);
  const collapsed = model.list(selected, view("folder"));
  assert.equal(isOpen(collapsed, "/repo"), false);

  // Streaming output and other registry updates hand the list the same selection again (d8fafa0).
  const seen = changes();
  const refreshed: AppState = {
    ...selected,
    folders: [...registry.folders],
    sessionReferences: [...registry.sessionReferences],
  };
  model.sync(refreshed, view("folder"));
  model.sync(refreshed, view("folder"));
  assert.equal(isOpen(model.list(refreshed, view("folder")), "/repo"), false);
  assert.equal(changes(), seen, "a repeat changes nothing, so nothing is stored or rendered again");
  // Leaving for a grouping without an owner, or an unregistered folder, and back does not reopen it.
  model.sync(refreshed, view("none"));
  model.sync(selecting(registry, "/unregistered", "s3"), view("folder"));
  model.sync(refreshed, view("folder"));
  assert.equal(isOpen(model.list(refreshed, view("folder")), "/repo"), false);

  const another = selecting(registry, "/repo", "s9");
  model.sync(another, view("folder"));
  assert.equal(isOpen(model.list(another, view("folder")), "/repo"), true, "another session");

  model.toggle("project:p1", false);
  model.sync(another, view("project"));
  model.sync(selected, view("project"));
  assert.equal(isOpen(model.list(selected, view("project")), "project:p1"), true, "a regrouping");

  model.toggle("project:p1", false);
  const filedElsewhere: AppState = {
    ...selected,
    projects: [...registry.projects, { id: "p2", name: "Other" }],
    sessionReferences: [sessionReference("/work/repo.feature", "s1", { projectId: "p2" })],
  };
  model.sync(filedElsewhere, view("project"));
  const moved = model.list(filedElsewhere, view("project"));
  assert.equal(isOpen(moved, "project:p2"), true, "moving the session opens its new project");
  assert.equal(isOpen(moved, "project:p1"), false);
});

test("sidebar list: keys stay the same across a grouping switch, so sections keep how the user left them", () => {
  const { model, items } = sidebar({ "piano.openProjects": JSON.stringify(["/other"]) });
  const state: AppState = {
    ...registry,
    sessionReferences: [
      ...registry.sessionReferences,
      sessionReference("/repo", "pin", { pinned: true }),
    ],
  };
  model.toggle("project:p1", true);
  model.toggle(PINNED, false);
  model.toggle("/repo", true);
  model.toggle("/other", false);
  const byFolder = openness(model.list(state, view("folder")));
  const byProject = openness(model.list(state, view("project")));
  for (const groupBy of ["date", "none", "project", "folder"] as const)
    model.list(state, view(groupBy));
  assert.deepEqual(openness(model.list(state, view("folder"))), byFolder);
  assert.deepEqual(openness(model.list(state, view("project"))), byProject);
  assert.deepEqual(byFolder, [
    [PINNED, false],
    ["/other", false],
    ["/repo", true],
  ]);
  assert.deepEqual(byProject, [
    [PINNED, false],
    ["project:p1", true],
    ["project:", false],
  ]);
  // The same keys reach the next page load.
  assert.deepEqual(JSON.parse(items.get("piano.openProjects") ?? "[]").sort(), [
    "/repo",
    "project:p1",
  ]);
  const reloaded = sidebar(Object.fromEntries(items)).model;
  assert.deepEqual(openness(reloaded.list(state, view("project"))), byProject);
});

test("sidebar list: a project created after the registry loaded opens; existing ones keep their state", () => {
  const { model } = sidebar();
  const withProjects = (...ids: string[]): AppState => ({
    ...registry,
    projects: ids.map((id) => ({ id, name: id })),
  });
  model.sync(withProjects("p1"), view("project"));
  model.sync(withProjects("p1"), view("project"));
  assert.equal(isOpen(model.list(withProjects("p1"), view("project")), "project:p1"), false);
  model.sync(withProjects("p1", "p2"), view("project"));
  assert.equal(isOpen(model.list(withProjects("p1", "p2"), view("project")), "project:p2"), true);
  model.toggle("project:p2", false);
  model.sync(withProjects("p1", "p2"), view("project"));
  assert.equal(
    isOpen(model.list(withProjects("p1", "p2"), view("project")), "project:p2"),
    false,
    "a later refresh does not reopen it",
  );
});

test("sidebar list: date sections start open, remember a collapse per browser, and open for a selected session", () => {
  const { model, items, changes } = sidebar({}, new Date(2026, 9, 2, 12));
  const today = sessionReference("/repo", "today", {
    title: "Today",
    updatedAt: new Date(2026, 9, 2, 9).toISOString(),
  });
  const earlier = sessionReference("/repo", "earlier", {
    title: "Earlier",
    updatedAt: new Date(2026, 9, 1, 9).toISOString(),
  });
  const state: AppState = { ...registry, sessionReferences: [today, earlier] };
  const chosen = view("date");
  assert.deepEqual(openness(model.list(state, chosen)), [
    ["date:Today", true],
    ["date:Yesterday", true],
  ]);

  model.toggle("date:Yesterday", false);
  assert.deepEqual(openness(model.list(state, chosen)), [
    ["date:Today", true],
    ["date:Yesterday", false],
  ]);
  const reloaded = sidebar(Object.fromEntries(items), new Date(2026, 9, 2, 12)).model;
  assert.equal(isOpen(reloaded.list(state, chosen), "date:Yesterday"), false, "the next load");
  // Collapsing a date group leaves folders and projects as they were.
  assert.deepEqual(JSON.parse(items.get("piano.openProjects") ?? "[]"), []);

  // Selecting a session in a collapsed date group opens it; the same selection again does not.
  const selected = selecting(state, "/repo", "earlier");
  model.sync(selected, chosen);
  assert.equal(isOpen(model.list(selected, chosen), "date:Yesterday"), true);
  model.toggle("date:Yesterday", false);
  const seen = changes();
  model.sync({ ...selected, sessionReferences: [today, earlier] }, chosen);
  assert.equal(isOpen(model.list(selected, chosen), "date:Yesterday"), false, "a refresh");
  assert.equal(changes(), seen);

  // A session not yet in the registry (a new one) belongs to Today.
  model.toggle("date:Today", false);
  const fresh = selecting(state, "/repo", null);
  model.sync(fresh, chosen);
  assert.equal(isOpen(model.list(fresh, chosen), "date:Today"), true);
});

test("sidebar list: date sections roll over at local midnight and after the page wakes", () => {
  const { model, time, changes } = sidebar({}, new Date(2026, 9, 2, 23, 0));
  const state: AppState = {
    ...loaded,
    folders: [folder("/repo")],
    sessionReferences: [
      sessionReference("/repo", "s", {
        title: "Late",
        updatedAt: new Date(2026, 9, 2, 22, 30).toISOString(),
      }),
    ],
  };
  const chosen = view("date");
  const labels = () => {
    const list = model.list(state, chosen);
    return list.body?.kind === "sections" ? list.body.sections.map((s) => s.key) : [];
  };
  const stop = model.start();
  assert.deepEqual(labels(), ["date:Today"]);
  assert.equal(time.pendingAt(), new Date(2026, 9, 3).getTime(), "wakes at the next midnight");

  const seen = changes();
  time.advance(new Date(2026, 9, 3, 0, 0));
  assert.deepEqual(labels(), ["date:Yesterday"]);
  assert.equal(changes(), seen + 1, "the rollover re-renders once");
  assert.equal(time.pendingAt(), new Date(2026, 9, 4).getTime(), "and waits for the next one");

  // A sleeping laptop misses its timer; coming back catches up.
  time.jump(new Date(2026, 9, 6, 9));
  assert.deepEqual(labels(), ["date:Yesterday"]);
  time.resume();
  assert.deepEqual(labels(), ["date:Previous 7 days"]);
  const settled = changes();
  time.resume();
  assert.equal(changes(), settled, "a wake on the same day changes nothing");

  stop();
  assert.equal(time.pendingAt(), null, "stopping cancels the timer");
  time.jump(new Date(2026, 10, 30));
  time.resume();
  assert.deepEqual(labels(), ["date:Previous 7 days"], "and no longer follows the clock");
});
