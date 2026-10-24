import assert from "node:assert/strict";
import { test } from "node:test";
import type { SessionState, WorktreeView } from "../shared/wire.ts";
import {
  commandPalette,
  createPaletteCatalog,
  FILES_QUERY,
  LINKS_QUERY,
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
import { sessionFiles } from "../web/src/lib/sessionFiles.ts";
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
  view: { groupBy: "date", sortBy: "recent" },
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
      files: sessionFiles(state.session?.messages ?? []),
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
  assert.deepEqual(matches("skill"), []);
  assert.ok(!matches("settings").includes("trust"));
  assert.ok(!matches("session").includes("home"));
  assert.deepEqual(matches("messages"), ["messages-only"]);
  assert.deepEqual(matches("radius"), ["settings-radius"]);
  assert.deepEqual(matches("web search"), []);
  assert.deepEqual(matches("diff"), ["changes"]);
  assert.deepEqual(matches("theme"), ["appearance-light", "appearance-dark", "appearance-system"]);
  assert.ok(matches("pr").includes("pull-request"));
  assert.deepEqual(matches("path"), ["copy-working-directory"]);
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

test("Links lists the selected session's web links: the latest few at the root, every one in a search", () => {
  const message = (id: string, role: "user" | "assistant", text: string) => ({ id, role, text });
  const urls = Array.from({ length: 7 }, (_, i) => `https://example.com/page-${i}`);
  const linked: AppState = {
    ...inSession,
    session: {
      ...selected,
      messages: [
        message("u1", "user", `Compare ${urls.slice(0, 4).join(" ")}`),
        message(
          "a1",
          "assistant",
          `See [the PR](https://github.com/a/b/pull/9) and ${urls.slice(4).join(" ")}`,
        ),
      ],
    },
  };
  const links = (state: AppState, search = "") => {
    const group = palette(state, search).find((g) => g.id === "links");
    return group?.id === "links" ? group.rows.map((r) => r.link.url) : undefined;
  };
  assert.equal(links(inSession), undefined, "a session without links has no Links group");
  assert.deepEqual(headings(linked), [
    "Recent sessions",
    "Global commands",
    "Session commands",
    "Links",
  ]);
  assert.deepEqual(
    links(linked),
    [
      "https://example.com/page-6",
      "https://example.com/page-5",
      "https://example.com/page-4",
      "https://github.com/a/b/pull/9",
      "https://example.com/page-3",
    ],
    "newest first, at most the recent limit",
  );
  // Nonmatches never become cmdk components; all matching links remain reachable.
  assert.deepEqual(links(linked, "example"), [...urls].reverse());
  assert.equal(
    links(linked, "the pr")?.[0],
    "https://github.com/a/b/pull/9",
    "a link's label is searchable",
  );
  assert.equal(headings(linked, "page-2")[0], "Links", "a URL fragment ranks Links first");
  // The links query reaches every link and nothing else, where a plain word fuzzy-matches titles.
  const groups = palette(linked, LINKS_QUERY);
  for (const group of groups) {
    const matching = group.rows.filter(
      (r) => paletteFilter(r.value, LINKS_QUERY, r.keywords) > 0,
    ).length;
    assert.equal(matching, group.id === "links" ? group.rows.length : 0, group.id);
  }
  assert.equal(groups[0]?.id, "links");
  // After the links query, a word narrows the links by label, host or any part of the URL, which
  // cmdk's own filter cannot do since "!" is in no label.
  const matching = (search: string) =>
    palette(linked, search)
      .find((g) => g.id === "links")
      ?.rows.map((r) => r.link.url) ?? [];
  assert.deepEqual(matching(`${LINKS_QUERY} the pr`), ["https://github.com/a/b/pull/9"], "label");
  assert.deepEqual(matching(`${LINKS_QUERY} github`), ["https://github.com/a/b/pull/9"], "host");
  assert.deepEqual(matching(`${LINKS_QUERY} page-2`), ["https://example.com/page-2"], "path");
  assert.deepEqual(
    matching(`${LINKS_QUERY} pull 9`),
    ["https://github.com/a/b/pull/9"],
    "segments",
  );
  assert.equal(matching(`${LINKS_QUERY} example.com`).length, urls.length, "dotted host");
  assert.deepEqual(matching(`${LINKS_QUERY} nowhere`), [], "no match");
});

test("Files lists what the selected session wrote or edited: the latest few at the root, every one in a search", () => {
  const cwd = selected.cwd;
  const call = (id: string, path: string) => ({
    id,
    name: "write",
    args: JSON.stringify({ path, content: "" }),
    writtenPath: path,
  });
  const paths = Array.from({ length: 7 }, (_, i) => `src/part-${i}.ts`);
  const written: AppState = {
    ...inSession,
    session: {
      ...selected,
      messages: [
        {
          id: "a1",
          role: "assistant",
          text: "",
          toolCalls: paths.slice(0, 4).map((p) => call(p, p)),
        },
        ...paths
          .slice(0, 4)
          .map((p) => ({ id: `r-${p}`, role: "tool_result" as const, text: "", toolCallId: p })),
        {
          id: "a2",
          role: "assistant",
          text: "",
          toolCalls: [
            call("abs", `${cwd}/docs/guide.md`),
            ...paths.slice(4).map((p) => call(p, p)),
          ],
        },
        { id: "r-abs", role: "tool_result", text: "", toolCallId: "abs" },
        ...paths
          .slice(4)
          .map((p) => ({ id: `r-${p}`, role: "tool_result" as const, text: "", toolCallId: p })),
      ],
    },
  };
  const files = (state: AppState, search = "") => {
    const group = palette(state, search).find((g) => g.id === "files");
    return group?.id === "files" ? group.rows.map((r) => r.value) : undefined;
  };
  assert.equal(files(inSession), undefined, "a session that wrote nothing has no Files group");
  assert.deepEqual(headings(written), [
    "Recent sessions",
    "Global commands",
    "Session commands",
    "Files",
  ]);
  assert.deepEqual(
    files(written),
    ["src/part-6.ts", "src/part-5.ts", "src/part-4.ts", "docs/guide.md", "src/part-3.ts"],
    "newest first, at most the recent limit, an absolute path shown relative to the session",
  );
  assert.equal(
    files(written, "part")?.length,
    paths.length,
    "a search reaches every matching file",
  );
  assert.equal(headings(written, "guide")[0], "Files", "a file name ranks Files first");
  // The files query reaches every file and nothing else; its singular is a prefix, so it works too.
  for (const query of [FILES_QUERY, "!file"]) {
    const groups = palette(written, query);
    for (const group of groups) {
      const matching = group.rows.filter(
        (r) => paletteFilter(r.value, query, r.keywords) > 0,
      ).length;
      assert.equal(matching, group.id === "files" ? group.rows.length : 0, `${query} ${group.id}`);
    }
    assert.equal(groups[0]?.id, "files");
  }
  const matching = (search: string) =>
    palette(written, search)
      .find((g) => g.id === "files")
      ?.rows.map((r) => r.value) ?? [];
  assert.deepEqual(matching(`${FILES_QUERY} guide`), ["docs/guide.md"], "name");
  assert.deepEqual(matching(`${FILES_QUERY} docs`), ["docs/guide.md"], "directory");
  assert.deepEqual(matching(`${FILES_QUERY} part-2`), ["src/part-2.ts"], "path");
  assert.deepEqual(matching(`${FILES_QUERY} nowhere`), [], "no match");
});

test("the links query's singular still reaches every link", () => {
  const linked: AppState = {
    ...inSession,
    session: {
      ...selected,
      messages: [
        {
          id: "a1",
          role: "assistant",
          text: "See https://example.com/a and https://example.com/b",
        },
      ],
    },
  };
  const groups = palette(linked, "!link");
  assert.equal(groups[0]?.id, "links");
  const links = groups[0]!;
  assert.equal(
    links.rows.filter((r) => paletteFilter(r.value, "!link", r.keywords) > 0).length,
    links.rows.length,
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
  const groups = commandPalette(state, { globalCommands: [], sessionCommands: [], files: [] });
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
  const input = { globalCommands: globalCommands(home, ctx), sessionCommands: [], files: [] };
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
  const input = { globalCommands: [], sessionCommands: [], files: [] };
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
  const input = { globalCommands: [], sessionCommands: [], files: [] };
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
