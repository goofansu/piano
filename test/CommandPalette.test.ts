import assert from "node:assert/strict";
import { test } from "node:test";
import type { SessionState, WorktreeView } from "../shared/wire.ts";
import {
  commandPalette,
  createPaletteCatalog,
  paletteFilter,
} from "../web/src/lib/commandPalette.ts";
import { type GlobalCommandContext, globalCommands } from "../web/src/lib/globalCommands.ts";
import {
  createPaletteSearch,
  pagePalette,
  paletteSelection,
  searchPalette,
} from "../web/src/lib/paletteSearch.ts";
import { sessionProjectMenu } from "../web/src/lib/projectCommands.ts";
import { sessionCommands } from "../web/src/lib/sessionCommands.ts";
import { type AppState, initialState, type SessionView, sessionKey } from "../web/src/store.ts";
import { sessionReference } from "./fixtures/sessionReference.ts";

const worktree = (path: string, branch: string, root: boolean): WorktreeView => ({
  workspace: { id: `ws:${path}`, folder: "/repo", path },
  trust: { required: false, trusted: false },
  branch,
  path,
  root,
  status: "current",
});
// Ten sessions, s0 the oldest; s9 runs in a worktree and belongs to a project.
const references = Array.from({ length: 10 }, (_, i) =>
  sessionReference(i === 9 ? "/work/repo.feature" : "/repo", `s${i}`, {
    title: i === 3 ? undefined : `Session ${i}`,
    branch: i === 9 ? "feature" : "main",
    ...(i === 9 ? { projectId: "launch" } : {}),
    createdAt: `2026-10-0${1 + Math.floor(i / 2)}T0${i % 2}:00:00Z`,
  }),
);
const home: AppState = {
  ...initialState,
  connected: true,
  folders: [
    {
      path: "/repo",
      name: "repo",
      worktrees: [
        worktree("/repo", "main", true),
        worktree("/work/repo.feature", "feature", false),
      ],
      discovery: { status: "ready", observedAt: "", currentPath: "/repo", worktrees: [] },
    },
  ],
  projects: [{ id: "launch", name: "Launch" }],
  sessionReferences: references,
};
const selected: SessionView = {
  cwd: "/repo",
  sessionId: "s1",
  hosted: true,
  cursor: null,
  state: { sessionId: "s1" } as SessionState,
  messages: [],
  dialogs: [],
};
const inSession: AppState = { ...home, view: { kind: "session" }, session: selected };
const ctx: GlobalCommandContext = {
  settings: null,
  view: { groupBy: "date", sortBy: "recent", folderAndBranch: false },
  theme: "dark",
};
/** The palette as the host feeds it: global commands from the shared context, the selected session's commands. */
const palette = (state: AppState, search = "", c = ctx) =>
  searchPalette(
    commandPalette(state, {
      globalCommands: globalCommands(state, c),
      sessionCommands: sessionCommands(state),
      sessionProject: state.session?.sessionId
        ? sessionProjectMenu(state, {
            cwd: state.session.cwd,
            sessionId: state.session.sessionId,
          })
        : undefined,
    }),
    search,
  );
const headings = (state: AppState, search = "") => palette(state, search).map((g) => g.heading);
const sessionIds = (state: AppState, search = "") => {
  const group = palette(state, search).find((g) => g.id === "sessions");
  return group?.id === "sessions" ? group.rows.map((r) => r.session.sessionId) : [];
};

test("before a search the palette offers the most recent sessions; a search reaches every one", () => {
  assert.deepEqual(
    sessionIds(home),
    ["s9", "s8", "s7", "s6", "s5", "s4", "s3", "s2"],
    "newest first, at most the recent limit",
  );
  assert.equal(
    sessionIds(home, "session").length,
    9,
    "searching reaches every matching session; Untitled does not match",
  );
  assert.equal(sessionIds(home, "   ").length, 8, "blank input is not a search");
  assert.deepEqual(headings(home).slice(0, 1), ["Recent sessions"]);
  assert.deepEqual(headings(home, "s").slice(0, 1), ["Sessions"]);
});

test("a session row is found by its title, folder, branch, project and ID, and names an untitled one", () => {
  const group = palette(home).find((g) => g.id === "sessions");
  assert.ok(group?.id === "sessions");
  const member = group.rows.find((r) => r.session.sessionId === "s9")!;
  assert.equal(member.value, "Session 9 repo feature Launch s9");
  assert.deepEqual(member.keywords, ["repo", "feature", "Launch"]);
  assert.equal(member.branch, "feature", "a worktree session shows its branch");
  const plain = group.rows.find((r) => r.session.sessionId === "s2")!;
  assert.equal(plain.branch, undefined, "the folder's own checkout shows no branch");
  const untitled = group.rows.find((r) => r.session.sessionId === "s3")!;
  assert.deepEqual([untitled.label, untitled.untitled], ["Untitled", true]);
  assert.match(untitled.value, /^Untitled repo main/);
});

test("a command only the other layout offers is left out, while an unavailable one is greyed", () => {
  const rows = (single: boolean) => {
    const groups = commandPalette(inSession, {
      globalCommands: [],
      sessionCommands: sessionCommands(inSession, undefined, {
        layout: { single, agent: true, surface: false, rail: false, agentTab: false },
      }),
    });
    const group = groups.find((g) => g.id === "session");
    return group?.id === "session"
      ? Object.fromEntries(group.rows.map((r) => [r.label, r.enabled]))
      : {};
  };
  const wide = rows(false);
  assert.equal(wide["Show session rail"], true);
  assert.equal("Agent" in wide, false, "Agent is a narrow layout's tab");
  const narrow = rows(true);
  assert.equal(narrow["Show session rail"], true, "the rail opens a narrow sheet");
  // Saved history has not named the session's file yet: a reason, so the row stays, greyed.
  assert.equal(narrow["Copy session path"], false);
});

test("groups come in order, with Session commands only while a session is selected", () => {
  assert.deepEqual(headings(home), ["Recent sessions", "Global commands"]);
  assert.deepEqual(headings(inSession), ["Recent sessions", "Global commands", "Session commands"]);
  assert.deepEqual(
    headings({ ...inSession, view: { kind: "new", cwd: "/repo" } }),
    ["Recent sessions", "Global commands"],
    "a session still loaded behind the New page offers no session commands",
  );
  assert.deepEqual(
    headings({ ...initialState, connected: true }),
    ["Global commands"],
    "no sessions, no sessions group",
  );
  const commands = palette(inSession).find((g) => g.id === "session");
  assert.ok(commands?.id === "session" && commands.rows.length > 0);
});

test("a search ranks groups by their best row; blank input keeps the declared order", () => {
  assert.deepEqual(
    headings(inSession, "diff"),
    ["Session commands"],
    "only Changes matches, so its group leads",
  );
  assert.equal(headings(inSession, "dark")[0], "Global commands");
  assert.deepEqual(headings(inSession, "   "), headings(inSession), "blank input is not a search");
});

test("Session commands offer the session's project membership, named as the menu's buttons", () => {
  const billing = { id: "billing", name: "Billing" };
  const loose: AppState = { ...inSession, projects: [...inSession.projects, billing] };
  const member: AppState = {
    ...loose,
    sessionReferences: references.map((r) =>
      r.sessionId === "s1" ? { ...r, projectId: "launch" } : r,
    ),
  };
  const labels = (state: AppState, search = "") => {
    const group = palette(state, search).find((g) => g.id === "session");
    return group?.id === "session" ? group.rows.map((r) => r.label) : [];
  };
  const membership = (state: AppState, search = "") =>
    labels(state, search).filter((l) => /project/.test(l));
  assert.deepEqual(
    membership(loose),
    ["Add to project: New project"],
    "before a search one row stands for the picker; destinations wait for a search",
  );
  assert.deepEqual(membership(loose, "add to"), [
    "Add to project: New project",
    "Add to project: Billing",
    "Add to project: Launch",
  ]);
  assert.deepEqual(membership(member), [
    "Open project: Launch",
    "Move to project: New project",
    "Remove from project",
  ]);
  assert.deepEqual(membership(member, "billing"), ["Move to project: Billing"]);
  const group = palette(member, "remove").find((g) => g.id === "session");
  assert.ok(group?.id === "session");
  const remove = group.rows.find((r) => r.label === "Remove from project")!;
  assert.equal(remove.enabled, true);
  assert.deepEqual(remove.command.intent, {
    kind: "send",
    command: { _tag: "assign_project", cwd: "/repo", sessionId: "s1", projectId: null },
  });
  const offline = palette({ ...member, connected: false }, "project").find(
    (g) => g.id === "session",
  );
  assert.ok(offline?.id === "session");
  for (const r of offline.rows.filter((r) => /project/.test(r.label)))
    assert.equal(r.enabled, r.key === "project:open", r.label);
});

test("Session commands reach the session's project home, as the header's project link does", () => {
  const member: AppState = {
    ...inSession,
    projects: [{ id: "launch", name: "Launch" }],
    sessionReferences: references.map((r) =>
      r.sessionId === "s1" ? { ...r, projectId: "launch" } : r,
    ),
  };
  const open = (state: AppState) => {
    const group = palette(state, "open project").find((g) => g.id === "session");
    return group?.id === "session" ? group.rows.find((r) => r.key === "project:open") : undefined;
  };
  assert.equal(open(inSession), undefined, "a session in no project has no project to open");
  const row = open(member);
  assert.equal(row?.label, "Open project: Launch");
  assert.equal(row?.enabled, true);
  assert.deepEqual(row?.command.intent, { kind: "open-project", projectId: "launch" });
  assert.ok(open({ ...member, connected: false })?.enabled, "it only navigates");
});

test("search uses direct command synonyms, not related topics or opposite display choices", () => {
  const state: AppState = {
    ...inSession,
    trusts: { "/repo": { required: true, trusted: true } },
  };
  const commands = [
    ...globalCommands(state, { ...ctx, settings: "providers" }),
    ...sessionCommands(state, undefined, { radiusSignedIn: true }),
  ];
  const matches = (query: string) =>
    commands
      .filter((c) => paletteFilter(c.label, query, c.keywords ? [...c.keywords] : undefined) > 0)
      .map((c) => c.id);
  assert.ok(commands.some((c) => c.label === "Untrust folder"));
  // Settings › Skills matches by its label; Trust folder, a related topic, does not.
  assert.deepEqual(matches("skill"), ["settings-skills"]);
  assert.ok(!matches("settings").includes("trust"));
  assert.ok(!matches("session").includes("home"));
  assert.deepEqual(matches("messages"), ["messages-only"]);
  assert.deepEqual(matches("radius"), ["settings-radius"]);
  assert.deepEqual(matches("web search"), []);
  assert.deepEqual(matches("diff"), ["changes"]);
  assert.deepEqual(matches("theme"), ["appearance-light", "appearance-dark", "appearance-system"]);
  assert.ok(matches("pr").includes("pull-request"));
  assert.deepEqual(matches("path"), ["copy-working-directory", "copy-session-path"]);
});

test("label matches rank ahead of aliases, without aliases changing a label match's score", () => {
  const label = paletteFilter("Discuss theme choices", "theme");
  const alias = paletteFilter("Dark appearance", "theme", ["theme"]);
  assert.ok(alias > 0, "direct synonyms remain searchable");
  assert.ok(label > alias, "an obvious title match beats a hidden keyword");
  assert.equal(
    paletteFilter("Dark appearance", "dark", ["theme"]),
    paletteFilter("Dark appearance", "dark"),
  );
  assert.equal(paletteFilter("Changes", "no such command", ["diff"]), 0);
  assert.ok(paletteFilter("Dark appearance", "dark theme", ["theme"]) > 0);
  assert.ok(paletteFilter("Dark appearance", "theme dark", ["theme"]) > 0);
  assert.equal(paletteFilter("Dark appearance", "path", ["theme"]), 0);
  assert.ok(paletteFilter("Dark appearance", "  DARK   THEME  ", ["theme"]) > 0);
  assert.ok(paletteFilter("Copy session details", "details copy") > alias);
  assert.ok(paletteFilter("Copy git branch", "branch copy") > alias);
});

test("newly matching rows arrive ranked, rather than relying on cmdk to sort absent DOM items", () => {
  const state: AppState = {
    ...home,
    sessionReferences: [
      sessionReference("/repo", "skill-session", { title: "Review skill definitions" }),
      sessionReference("/repo", "theme-session", { title: "Discuss theme choices" }),
    ],
  };
  const sessions = palette(state, "theme").find((g) => g.id === "sessions");
  assert.ok(sessions?.id === "sessions");
  assert.equal(sessions.rows[0]?.label, "Discuss theme choices");
});

test("the current appearance is checked, as in the View menu", () => {
  const global = palette(home).find((g) => g.id === "global");
  assert.ok(global?.id === "global");
  const appearances = global.rows.filter((r) => r.command.group === "appearance");
  assert.deepEqual(
    appearances.map((r) => [r.label, r.checked]),
    [
      ["Light appearance", false],
      ["Dark appearance", true],
      ["System appearance", false],
    ],
  );
  assert.deepEqual(
    global.rows.filter((r) => r.checked).map((r) => r.key),
    ["appearance-dark", "group-date", "sort-recent"],
    "one current choice per kind",
  );
});

test("search pages replace rows, preserve stable ties and reach the oldest match", () => {
  const state = {
    ...home,
    sessionReferences: Array.from({ length: 123 }, (_, i) =>
      sessionReference("/closed", `id-${i}`, {
        title: "Repeated title",
        createdAt: new Date(1700000000000 + i * 1000).toISOString(),
      }),
    ),
  };
  const groups = commandPalette(state, { globalCommands: [], sessionCommands: [] });
  const search = createPaletteSearch();
  const first = search({ id: 1, groups, query: "Repeated", pages: {} });
  assert.equal(first.pages[0].total, 123);
  assert.equal(first.pages[0].group.rows.length, 50);
  const ranked = searchPalette(groups, "Repeated");
  assert.equal(
    paletteSelection(pagePalette(ranked), "sessions:next", false),
    "sessions:next",
    "a background refresh must not replace the Next choice with a session",
  );
  assert.equal(
    paletteSelection(pagePalette(ranked), "sessions:next", true),
    `sessions:${sessionKey({ cwd: "/closed", sessionId: "id-122" })}`,
    "an edited query resets to its best match",
  );
  assert.equal(
    paletteSelection(
      pagePalette(ranked, { sessions: 1 }),
      `sessions:${sessionKey({ cwd: "/closed", sessionId: "id-122" })}`,
      false,
    ),
    `sessions:${sessionKey({ cwd: "/closed", sessionId: "id-72" })}`,
    "a choice no longer on the page is replaced",
  );
  assert.equal(paletteSelection([], "sessions:next", false), "");
  const second = search({ id: 2, query: "Repeated", pages: { sessions: 1 } });
  const last = search({ id: 3, query: "Repeated", pages: { sessions: 2 } });
  const keys = [first, second, last].flatMap((reply) =>
    reply.pages[0].group.rows.map((r) => r.key),
  );
  assert.deepEqual(
    keys,
    Array.from({ length: 123 }, (_, i) =>
      sessionKey({ cwd: "/closed", sessionId: `id-${122 - i}` }),
    ),
  );
  assert.equal(last.pages[0].group.rows.length, 23);
  assert.equal(search({ id: 4, query: "missing", pages: {} }).pages.length, 0);
  assert.equal(
    search({ id: 5, query: "id-0", pages: {} }).pages[0].group.rows[0].key,
    sessionKey({ cwd: "/closed", sessionId: "id-0" }),
  );
  assert.equal(pagePalette(searchPalette(groups, "Repeated"), { sessions: 999 })[0].page, 2);
});

test("a refreshed palette finds renamed sessions and excludes archived ones", () => {
  const catalog = createPaletteCatalog();
  const input = { globalCommands: globalCommands(home, ctx), sessionCommands: [] };
  catalog(home, input);
  const renamed = {
    ...home,
    sessionReferences: home.sessionReferences.map((r, i) =>
      i === 0 ? { ...r, title: "Unique renamed" } : r,
    ),
  };
  assert.deepEqual(
    searchPalette(catalog(renamed, input), "Unique renamed")[0]?.rows.map((r) => r.key),
    [sessionKey({ cwd: "/repo", sessionId: "s0" })],
  );
  const archived = {
    ...renamed,
    sessionReferences: renamed.sessionReferences.map((r, i) =>
      i === 0 ? { ...r, archived: true } : r,
    ),
  };
  assert.deepEqual(searchPalette(catalog(archived, input), "Unique renamed"), []);
});

test("session availability updates the palette and keyboard selection", () => {
  const catalog = createPaletteCatalog();
  const input = { globalCommands: [], sessionCommands: [] };
  catalog(home, input);
  const unavailable: AppState = {
    ...home,
    sessionReferences: home.sessionReferences.map((r) => ({
      ...r,
      unavailable: r.sessionId === "s9" ? "history" : r.sessionId === "s8" ? "checkout" : undefined,
    })),
  };
  const changed = catalog(unavailable, input);
  const sessions = changed.find((g) => g.id === "sessions");
  assert.ok(sessions?.id === "sessions");
  assert.equal(sessions.rows[0].enabled, false, "missing history cannot be opened");
  assert.equal(
    sessions.rows[0].hint,
    "History unavailable. Restore the Pi session file to open it.",
  );
  assert.equal(sessions.rows[1].enabled, true, "a missing checkout still permits reading history");
  assert.equal(
    sessions.rows[1].hint,
    "Folder missing. History can be read; restore the folder to continue.",
  );
  for (const query of ["", "Session"]) {
    assert.equal(
      paletteSelection(
        pagePalette(searchPalette(changed, query)),
        `sessions:${sessionKey({ cwd: "/work/repo.feature", sessionId: "s9" })}`,
        false,
      ),
      `sessions:${sessionKey({ cwd: "/repo", sessionId: "s8" })}`,
      "selection must leave an unavailable session, for recents and search results",
    );
  }
  const restored = catalog(home, input);
  assert.equal(
    paletteSelection(pagePalette(searchPalette(restored, "")), "", true),
    `sessions:${sessionKey({ cwd: "/work/repo.feature", sessionId: "s9" })}`,
  );
});

test("worker search replaces its catalog even when the query is unchanged", () => {
  const search = createPaletteSearch();
  const input = { globalCommands: [], sessionCommands: [] };
  const groups = commandPalette(home, input);
  assert.equal(search({ id: 1, query: "Session", pages: {}, groups }).pages[0].total, 9);
  const archived = commandPalette(
    { ...home, sessionReferences: home.sessionReferences.map((r) => ({ ...r, archived: true })) },
    input,
  );
  assert.deepEqual(search({ id: 2, query: "Session", pages: {}, groups: archived }), {
    id: 2,
    pages: [],
  });
});
