import assert from "node:assert/strict";
import { test } from "node:test";
import type { SessionState, WorktreeView } from "../shared/wire.ts";
import {
  commandPalette,
  paletteFilter,
  RECENT_SESSION_LIMIT,
} from "../web/src/lib/commandPalette.ts";
import { type GlobalCommandContext, globalCommands } from "../web/src/lib/globalCommands.ts";
import { sessionCommands } from "../web/src/lib/sessionCommands.ts";
import { type AppState, initialState, type SessionView } from "../web/src/store.ts";
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
  projects: [{ id: "launch", name: "Launch", archived: false }],
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
  settingsOpen: false,
  view: { groupBy: "date", sortBy: "recent" },
  theme: "dark",
};
/** The palette as the host feeds it: global commands from the shared context, the selected session's commands. */
const palette = (state: AppState, search = "", c = ctx) =>
  commandPalette(state, {
    search,
    globalCommands: globalCommands(state, c),
    sessionCommands: sessionCommands(state),
  });
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
  assert.equal(RECENT_SESSION_LIMIT, 8);
  assert.equal(
    sessionIds(home, "session").length,
    10,
    "searching lists them all for cmdk to filter",
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
    ["Session commands", "Sessions", "Global commands"],
    "only Changes matches, so its group leads",
  );
  assert.equal(headings(inSession, "dark")[0], "Global commands");
  assert.deepEqual(headings(inSession, "   "), headings(inSession), "blank input is not a search");
});

test("search uses direct command synonyms, not related topics or opposite display choices", () => {
  const state: AppState = {
    ...inSession,
    trusts: { "/repo": { required: true, trusted: true } },
  };
  const commands = [
    ...globalCommands(state, { ...ctx, settingsOpen: true }),
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
  assert.deepEqual(matches("messages"), ["display-messages"]);
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
  assert.deepEqual(links(linked), [
    "https://github.com/a/b/pull/9",
    "https://example.com/page-4",
    "https://example.com/page-5",
    "https://example.com/page-6",
    "https://example.com/page-0",
  ]);
  // A search ranks rows (cmdk hides the ones that do not match), so every link is present.
  assert.deepEqual(
    links(linked, "example"),
    urls.slice(4).concat(urls.slice(0, 4), "https://github.com/a/b/pull/9"),
  );
  assert.equal(
    links(linked, "the pr")?.[0],
    "https://github.com/a/b/pull/9",
    "a link's label is searchable",
  );
  assert.equal(headings(linked, "page-2")[0], "Links", "a URL fragment ranks Links first");
  const linkGroup = palette(linked, "link").find((g) => g.id === "links");
  assert.ok(
    linkGroup?.id === "links" &&
      linkGroup.rows.every((r) => paletteFilter(r.value, "link", r.keywords) > 0),
    '"link" matches every link row',
  );
  const sessionGroup = palette(linked).find((g) => g.id === "session");
  assert.ok(
    sessionGroup?.id === "session" &&
      sessionGroup.rows.some((r) => r.command.id === "links" && r.enabled),
    "the Links command is enabled while the session has links",
  );
});
