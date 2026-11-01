import assert from "node:assert/strict";
import { test } from "node:test";
import type { SessionState } from "../shared/wire.ts";
import { type CommandEffects, runCommand } from "../web/src/lib/commands.ts";
import {
  type GlobalCommandContext,
  globalCommands,
  radioChoice,
  trustCommand,
} from "../web/src/lib/globalCommands.ts";
import { type AppState, initialState, type SessionView } from "../web/src/store.ts";

const session = (cwd: string, state: Partial<SessionState> = {}): SessionView => ({
  cwd,
  sessionId: "s1",
  hosted: true,
  cursor: null,
  state: { sessionId: "s1", ...state } as SessionState,
  messages: [],
  dialogs: [],
});
const protectedDir = { required: true, trusted: false };
const onNewPage: AppState = {
  ...initialState,
  connected: true,
  view: { kind: "new", cwd: "/repo" },
  trusts: { "/repo": protectedDir, "/plain": { required: false, trusted: false } },
};
const ctx: GlobalCommandContext = {
  settings: null,
  view: { groupBy: "date", sortBy: "recent", folderAndBranch: false },
};
const labels = (state: AppState, c = ctx) =>
  globalCommands(state, c).map((command) => command.label);

test("trust is offered only where Pi requires it, and waits for a connection", () => {
  assert.equal(
    trustCommand(onNewPage, "/plain"),
    undefined,
    "no protected resources, nothing to trust",
  );
  assert.equal(trustCommand(onNewPage, "/unknown"), undefined, "trust not yet known");
  assert.equal(trustCommand(onNewPage, ""), undefined, "no directory chosen");
  assert.equal(trustCommand(onNewPage, "/repo")?.enabled, true);
  assert.equal(
    trustCommand({ ...onNewPage, connected: false }, "/repo")?.enabled,
    false,
    "offline the change would be dropped",
  );
  assert.ok(
    labels(onNewPage).includes("Trust folder"),
    "the palette offers the New page's directory",
  );
  assert.ok(
    !labels({ ...onNewPage, view: { kind: "new", cwd: "/plain" } }).some((l) => /trust/i.test(l)),
  );
});

test("trust is never offered for a selected session's missing checkout", () => {
  const present: AppState = { ...onNewPage, view: { kind: "session" }, session: session("/repo") };
  assert.ok(labels(present).includes("Trust folder"), "the selected session's directory");
  const missing: AppState = { ...present, session: session("/repo", { checkoutMissing: true }) };
  assert.equal(trustCommand(missing, "/repo"), undefined);
  assert.ok(!labels(missing).some((l) => /trust/i.test(l)));
});

test("running trust flips the directory's trusted state", () => {
  assert.deepEqual(trustCommand(onNewPage, "/repo")?.intent, {
    kind: "send",
    command: { _tag: "set_trust", path: "/repo", trusted: true },
  });
  const trusted = { ...onNewPage, trusts: { "/repo": { required: true, trusted: true } } };
  const untrust = trustCommand(trusted, "/repo");
  assert.equal(untrust?.label, "Untrust folder");
  assert.equal(untrust?.pressed, true);
  assert.equal(untrust?.checked, undefined, "the palette marks no row as current");
  assert.deepEqual(untrust?.intent, {
    kind: "send",
    command: { _tag: "set_trust", path: "/repo", trusted: false },
  });
});

test("the palette offers Settings, or Home while Settings is open", () => {
  assert.equal(labels(onNewPage)[0], "Settings");
  assert.ok(!labels(onNewPage).includes("Home"));
  assert.equal(labels(onNewPage, { ...ctx, settings: "providers" })[0], "Home");
  assert.ok(!labels(onNewPage, { ...ctx, settings: "providers" }).includes("Settings"));
});

test("the palette offers Projects wherever the user is, named as the sidebar row is", () => {
  const projects = globalCommands(onNewPage, ctx).find((c) => c.id === "projects");
  assert.equal(projects?.label, "Projects");
  assert.equal(projects?.group, "navigate");
  assert.deepEqual(projects?.intent, { kind: "projects" });
  assert.ok(labels({ ...onNewPage, view: { kind: "session" } }).includes("Projects"));
  assert.ok(labels(onNewPage, { ...ctx, settings: "providers" }).includes("Projects"));
});

test("exactly the current grouping and sort are checked", () => {
  const checked = (group: string, c: GlobalCommandContext) =>
    globalCommands(onNewPage, c)
      .filter((command) => command.group === group && command.checked)
      .map((command) => command.label);
  assert.deepEqual(checked("group-by", ctx), ["Group by date"]);
  assert.deepEqual(checked("sort-by", ctx), ["Sort by activity"]);
  const other = {
    ...ctx,
    view: { groupBy: "none", sortBy: "name", folderAndBranch: false },
  } as const;
  assert.deepEqual(checked("group-by", other), ["No grouping"]);
  assert.deepEqual(checked("sort-by", other), ["Sort by name"]);
});

test("one list of appearances serves the palette and the View menu", () => {
  const appearances = globalCommands(onNewPage, { ...ctx, theme: "dark" }).filter(
    (c) => c.group === "appearance",
  );
  assert.deepEqual(
    appearances.map((c) => c.label),
    ["Light appearance", "Dark appearance", "System appearance"],
  );
  assert.deepEqual(
    appearances.map((c) => c.menuLabel),
    ["Light", "Dark", "System"],
  );
  assert.deepEqual(
    appearances.map((c) => c.checked),
    [false, true, false],
  );
  assert.deepEqual(
    appearances.map((c) => c.intent),
    ["light", "dark", "system"].map((appearance) => ({ kind: "appearance", appearance })),
  );
});

test("each View-menu radio reports exactly one current choice, by its short label", () => {
  const view = {
    ...ctx,
    view: { groupBy: "folder", sortBy: "name", folderAndBranch: false },
    theme: "light",
  } as const;
  const commands = globalCommands(onNewPage, view);
  const report = (group: "group-by" | "sort-by" | "appearance") => {
    const { value, currentLabel, items } = radioChoice(commands, group);
    assert.equal(items.filter((c) => c.checked).length, 1, group);
    return [value, currentLabel, items.map((c) => c.menuLabel)];
  };
  assert.deepEqual(report("group-by"), [
    "group-folder",
    "Folder",
    ["Date", "Folder", "Project", "None"],
  ]);
  assert.deepEqual(report("sort-by"), ["sort-name", "Name", ["Activity", "Name"]]);
  assert.deepEqual(report("appearance"), [
    "appearance-light",
    "Light",
    ["Light", "Dark", "System"],
  ]);
});

test("the palette keeps a Radius row, which opens Providers", () => {
  const radius = globalCommands(onNewPage, ctx).find((command) => command.label === "Radius");
  assert.deepEqual(radius?.intent, { kind: "settings", section: "radius" });
  assert.equal(
    labels(onNewPage).filter((label) => label === "Radius").length,
    1,
    "Radius is offered once",
  );
});

test("on the Projects index the palette offers New project, which opens the New project dialog", () => {
  const onProjects: AppState = { ...initialState, connected: true, view: { kind: "projects" } };
  const newProject = (state: AppState) =>
    globalCommands(state, ctx).find((c) => c.label === "New project");
  const create = newProject(onProjects);
  assert.ok(create);
  const calls: unknown[][] = [];
  const effects = new Proxy({} as CommandEffects, {
    get:
      (_, name) =>
      (...args: unknown[]) => {
        calls.push([name, ...args]);
      },
  });
  assert.equal(runCommand(create, effects), true);
  assert.deepEqual(calls, [["openForm", { kind: "project", dialog: {} }]]);
  assert.equal(
    newProject({ ...onProjects, connected: false })?.enabled,
    false,
    "creating a project changes the registry",
  );
  assert.equal(newProject(onNewPage), undefined, "the New session page offers none");
  assert.equal(
    newProject({ ...onNewPage, view: { kind: "session" } }),
    undefined,
    "a session offers its own Add to project: New project",
  );
});

test("on Settings › Skills the palette offers New skill, which opens the skill editor", () => {
  const newSkill = (settings: GlobalCommandContext["settings"]) =>
    globalCommands(onNewPage, { ...ctx, settings }).find((c) => c.label === "New skill");
  const create = newSkill("skills");
  assert.ok(create);
  const calls: unknown[][] = [];
  const effects = new Proxy({} as CommandEffects, {
    get:
      (_, name) =>
      (...args: unknown[]) => {
        calls.push([name, ...args]);
      },
  });
  assert.equal(runCommand(create, effects), true);
  assert.deepEqual(calls, [["newSkill"]]);
  assert.equal(newSkill("webhooks"), undefined, "another Settings page offers none");
});

test("on Settings › Prompts the palette offers New prompt, which opens the prompt editor", () => {
  const newPrompt = (settings: GlobalCommandContext["settings"]) =>
    globalCommands(onNewPage, { ...ctx, settings }).find((c) => c.label === "New prompt");
  const create = newPrompt("prompts");
  assert.ok(create);
  const calls: unknown[][] = [];
  const effects = new Proxy({} as CommandEffects, {
    get:
      (_, name) =>
      (...args: unknown[]) => {
        calls.push([name, ...args]);
      },
  });
  assert.equal(runCommand(create, effects), true);
  assert.deepEqual(calls, [["newPrompt"]]);
  assert.equal(newPrompt("webhooks"), undefined, "another Settings page offers none");
});

test("on Settings › Webhooks the palette offers Add webhook, which opens the webhook editor", () => {
  const addWebhook = (settings: GlobalCommandContext["settings"], state = onNewPage) =>
    globalCommands(state, { ...ctx, settings }).find((c) => c.label === "Add webhook");
  const add = addWebhook("webhooks");
  assert.ok(add);
  const calls: unknown[][] = [];
  const effects = new Proxy({} as CommandEffects, {
    get:
      (_, name) =>
      (...args: unknown[]) => {
        calls.push([name, ...args]);
      },
  });
  assert.equal(runCommand(add, effects), true);
  assert.deepEqual(calls, [["addWebhook"]]);
  assert.equal(addWebhook(null), undefined, "a page outside Settings offers none");
  assert.equal(addWebhook("mcp"), undefined, "another Settings page offers none");
  const onProjects: AppState = { ...initialState, connected: true, view: { kind: "projects" } };
  assert.equal(
    globalCommands(onProjects, { ...ctx, settings: "webhooks" }).some(
      (c) => c.label === "New project",
    ),
    false,
    "Settings covers the page beneath it, so its header actions are not offered",
  );
});

test("Show folder and branch is one command for the palette and the View menu, naming what it does", () => {
  const command = (folderAndBranch: boolean) =>
    globalCommands(onNewPage, { ...ctx, view: { ...ctx.view, folderAndBranch } }).find(
      (c) => c.menuLabel === "Folder and branch",
    );
  const off = command(false);
  assert.equal(off?.label, "Show folder and branch");
  assert.equal(off?.pressed, false);
  assert.deepEqual(off?.intent, { kind: "view", change: { folderAndBranch: true } });
  const on = command(true);
  assert.equal(on?.label, "Hide folder and branch");
  assert.equal(on?.pressed, true);
  assert.deepEqual(on?.intent, { kind: "view", change: { folderAndBranch: false } });
});
