import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import type { SessionState } from "../shared/wire.ts";
import { type CommandEffects, runCommand } from "../web/src/lib/commands.ts";
import {
  type GlobalCommandContext,
  globalCommands,
  pageCommands,
  radioChoice,
  trustCommand,
} from "../web/src/lib/globalCommands.ts";
import {
  type EditorPage,
  openPageEditor,
  PAGE_EDITORS,
  pageEditor,
} from "../web/src/lib/pageEditor.ts";
import { SETTINGS_SECTIONS, type SettingsSection } from "../web/src/lib/routes.ts";
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

test("Settings commands offer pages, not nested sections such as Radius", () => {
  for (const settings of [null, ...SETTINGS_SECTIONS.map((s) => s.id)]) {
    const commands = globalCommands(onNewPage, { ...ctx, settings }).filter((command) =>
      command.id.startsWith("settings-"),
    );
    assert.deepEqual(
      commands.map((command) => command.label),
      ["Providers", "MCP", "Skills", "Prompts", "Webhooks", "Preferences"],
    );
    assert.deepEqual(commands[0]?.intent, { kind: "settings", section: "providers" });
  }
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

test("every open of a page editor is its own, so the dialog keyed by it starts fresh", () => {
  // New webhook from the palette while editing one replaces that open without closing it first.
  const editor = pageEditor<{ name: string }>();
  const a = { name: "a" };
  const opens = [];
  for (const target of [a, "new", { name: "b" }, a, "new", "new"] as const) {
    editor.open(target);
    const open = editor.getState();
    assert.equal(open?.target, target);
    opens.push(open!.key);
  }
  assert.equal(new Set(opens).size, opens.length, "no two opens share a key");
  editor.close();
  assert.equal(editor.getState(), null);
});

test("each Settings page's header creation is a palette command that opens that page's editor", () => {
  // As each page's header button is named (docs/quiet-ui.md#button-names); every other page offers none.
  const creation: Partial<Record<SettingsSection, { label: string; page: EditorPage }>> = {
    webhooks: { label: "New webhook", page: "webhooks" },
    mcp: { label: "Add MCP server", page: "mcp" },
    skills: { label: "New skill", page: "skills" },
    prompts: { label: "New prompt", page: "prompts" },
  };
  const creations = new Set(Object.values(creation).map((c) => c.label));
  // The host's effect, and only it: running the command must reach the page's editor through it.
  const effects = new Proxy({ openPageEditor } as CommandEffects, {
    get: (target, name) => {
      if (name in target) return target[name as keyof CommandEffects];
      throw new Error(`unexpected effect ${String(name)}`);
    },
  });
  for (const { id: section } of SETTINGS_SECTIONS) {
    const offered = globalCommands(onNewPage, { ...ctx, settings: section }).filter((c) =>
      creations.has(c.label),
    );
    const expected = creation[section];
    if (!expected) {
      assert.deepEqual(offered, [], `${section} offers no creation`);
      continue;
    }
    assert.deepEqual(
      offered.map((c) => c.label),
      [expected.label],
      `${section} offers ${expected.label}`,
    );
    const [command] = offered;
    assert.deepEqual(
      command,
      pageCommands(onNewPage, section)[0],
      "the palette row is the header's",
    );
    const editor = PAGE_EDITORS[expected.page].editor;
    assert.equal(editor.getState(), null);
    assert.equal(runCommand(command!, effects), true);
    assert.equal(
      editor.getState()?.target,
      "new",
      `${expected.label} opens the ${section} editor on new`,
    );
    for (const other of Object.values(PAGE_EDITORS))
      if (other.editor !== editor) assert.equal(other.editor.getState(), null, "no other editor");
    editor.close();
  }
  assert.deepEqual(
    labels(onNewPage).filter((l) => creations.has(l)),
    [],
    "a page outside Settings offers none",
  );
  const onProjects: AppState = { ...initialState, connected: true, view: { kind: "projects" } };
  assert.equal(
    globalCommands(onProjects, { ...ctx, settings: "webhooks" }).some(
      (c) => c.label === "New project",
    ),
    false,
    "Settings covers the page beneath it, so its header actions are not offered",
  );
});

test("every page's creation entry shares one icon, and New session keeps its own", () => {
  const onProjects: AppState = { ...initialState, connected: true, view: { kind: "projects" } };
  const icon = (label: string, state: AppState, settings: GlobalCommandContext["settings"]) =>
    globalCommands(state, { ...ctx, settings }).find((c) => c.label === label)?.icon;
  const creation = [
    icon("New project", onProjects, null),
    icon("New webhook", onNewPage, "webhooks"),
    icon("Add MCP server", onNewPage, "mcp"),
    icon("New skill", onNewPage, "skills"),
    icon("New prompt", onNewPage, "prompts"),
  ];
  assert.ok(creation[0]);
  assert.deepEqual(new Set(creation), new Set([creation[0]]), "one icon for every creation entry");
  assert.notEqual(icon("New session", onProjects, null), creation[0], "New session keeps the pen");
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

test("the sidebar toggle is named as the button it stands for: Hide sidebar while shown, Show sidebar while hidden", () => {
  const toggle = (sidebarHidden: boolean) =>
    globalCommands(onNewPage, { ...ctx, sidebarHidden }).find((c) => c.id === "toggle-sidebar");
  assert.deepEqual([toggle(false)?.label, toggle(false)?.icon], ["Hide sidebar", "hide-sidebar"]);
  assert.deepEqual([toggle(true)?.label, toggle(true)?.icon], ["Show sidebar", "show-sidebar"]);
  assert.deepEqual(toggle(true)?.intent, { kind: "toggle-sidebar" });
});

test("a page reporting its creation unavailable disables its row until the page is left", async (t) => {
  const dom = new JSDOM("<div id='root'></div>");
  const globals = {
    window: dom.window,
    document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const originals = Object.fromEntries(
    Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  for (const [key, value] of Object.entries(globals))
    Object.defineProperty(globalThis, key, { configurable: true, value });
  t.after(() => {
    dom.window.close();
    for (const [key, descriptor] of Object.entries(originals)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
  // As MCP reports while Pi's config is unusable (`view.problem`).
  function McpPage({ available }: { available: boolean }) {
    PAGE_EDITORS.mcp.editor.useAvailable(available);
    return null;
  }
  const row = () => pageCommands(onNewPage, "mcp")[0]!;
  const root = createRoot(dom.window.document.getElementById("root")!);
  assert.equal(row().enabled, true);
  await act(() => root.render(createElement(McpPage, { available: false })));
  assert.equal(row().enabled, false, "the header's row, and so the palette's, is disabled");
  assert.equal(
    globalCommands(onNewPage, { ...ctx, settings: "mcp" }).find((c) => c.label === "Add MCP server")
      ?.enabled,
    false,
    "the palette lists the same disabled row",
  );
  assert.equal(pageCommands(onNewPage, "skills")[0]!.enabled, true, "other pages are unaffected");
  await act(() => root.render(createElement(McpPage, { available: true })));
  assert.equal(row().enabled, true, "a usable config enables it again");
  await act(() => root.render(createElement(McpPage, { available: false })));
  await act(() => root.unmount());
  assert.equal(row().enabled, true, "leaving the page clears its report");
});
