import assert from "node:assert/strict";
import { test } from "node:test";
import type { Project } from "../shared/wire.ts";
import {
  openProjectCommand,
  projectCommands,
  projectDestinations,
  projectSettingsRows,
  sessionProjectMenu,
} from "../web/src/lib/projectCommands.ts";
import { type AppState, initialState } from "../web/src/store.ts";
import { sessionReference } from "./fixtures/sessionReference.ts";

const launch: Project = { id: "p1", name: "Launch" };
const billing: Project = { id: "p2", name: "Billing" };
const state: AppState = { ...initialState, connected: true, projects: [launch, billing] };

const names = (projects: readonly Project[]) => projects.map((p) => p.name);
const byId = (project: Project, s = state) =>
  Object.fromEntries(projectCommands(s, project).map((c) => [c.id, c]));

test("pickers offer projects by name, numbers by value, as the sidebar lists them", () => {
  const q10: Project = { id: "q10", name: "Q10 launch" };
  const q2: Project = { id: "q2", name: "q2 launch" };
  const s = { ...state, projects: [...state.projects, q10, q2] };
  assert.deepEqual(names(projectDestinations(s, undefined, { keepCurrent: true })), [
    "Billing",
    "Launch",
    "q2 launch",
    "Q10 launch",
  ]);
});

test("the sidebar's menu leaves out the current project; the New page keeps it", () => {
  const sidebar = (current?: Project) =>
    names(projectDestinations(state, current, { keepCurrent: false }));
  const newPage = (current?: Project) =>
    names(projectDestinations(state, current, { keepCurrent: true }));
  assert.deepEqual(sidebar(launch), ["Billing"]);
  assert.deepEqual(newPage(launch), ["Billing", "Launch"], "the current project is not repeated");
});

test("a project offers New session in it, Project settings and Delete, which asks before it sends", () => {
  assert.deepEqual(
    projectCommands(state, launch).map((c) => c.label),
    ["New session in project", "Project settings", "Delete project"],
  );
  assert.deepEqual(byId(launch)["new-session"]?.intent, { kind: "new-session", projectId: "p1" });
  assert.deepEqual(byId(launch).settings?.intent, { kind: "project-settings", projectId: "p1" });
  assert.deepEqual(byId(launch).delete?.intent, { kind: "delete-project", project: launch });
});

test("deleting waits for a connection; opening a page does not", () => {
  const offline = { ...state, connected: false };
  for (const project of [launch, billing]) {
    const commands = byId(project, offline);
    assert.equal(commands.delete?.enabled, false, project.name);
    assert.equal(commands["new-session"]?.enabled, true, project.name);
    assert.equal(commands.settings?.enabled, true, project.name);
  }
});

test("the settings page renames in the project dialog and edits instructions in theirs, once connected", () => {
  const { rename, instructions } = projectSettingsRows(state, launch);
  assert.deepEqual(
    [rename.label, rename.ariaLabel, instructions.label, instructions.ariaLabel],
    ["Rename", "Rename project", "Edit", "Edit instructions"],
  );
  assert.deepEqual(rename.intent, { kind: "project-dialog", dialog: { project: launch } });
  assert.deepEqual(instructions.intent, { kind: "project-instructions", project: launch });
  const offline = projectSettingsRows({ ...state, connected: false }, launch);
  assert.deepEqual([offline.rename.enabled, offline.instructions.enabled], [false, false]);
});

test("a session's project menu: Move for a member, Add otherwise, one connection rule for every row", () => {
  const member = { cwd: "/repo", sessionId: "s1" };
  const loose = { cwd: "/repo", sessionId: "s2" };
  const s: AppState = {
    ...state,
    sessionReferences: [
      sessionReference("/repo", "s1", { projectId: "p1" }),
      sessionReference("/repo", "s2"),
    ],
  };
  const moving = sessionProjectMenu(s, member);
  assert.equal(moving.current?.name, "Launch");
  assert.deepEqual(moving.entry, { label: "Move to project", enabled: true });
  assert.deepEqual(names(moving.destinations.map((d) => d.project)), ["Billing"]);
  assert.deepEqual(moving.destinations[0]?.command.intent, {
    kind: "send",
    command: { _tag: "assign_project", cwd: "/repo", sessionId: "s1", projectId: "p2" },
  });
  assert.equal(moving.remove?.label, "Remove from project");
  assert.deepEqual(moving.remove?.intent, {
    kind: "send",
    command: { _tag: "assign_project", cwd: "/repo", sessionId: "s1", projectId: null },
  });
  assert.deepEqual(moving.create.intent, {
    kind: "project-dialog",
    dialog: { assign: member },
  });

  const adding = sessionProjectMenu(s, loose);
  assert.equal(adding.current, undefined);
  assert.deepEqual(adding.entry, { label: "Add to project", enabled: true });
  assert.equal(adding.remove, undefined, "a session in no project has nothing to remove");
  assert.deepEqual(names(adding.destinations.map((d) => d.project)), ["Billing", "Launch"]);

  const offline = sessionProjectMenu({ ...s, connected: false }, member);
  assert.deepEqual(
    offline.entry,
    { label: "Move to project", enabled: false },
    "the entry is disabled, not a pane of disabled rows",
  );
  for (const c of [offline.create, offline.remove!, ...offline.destinations.map((d) => d.command)])
    assert.equal(c.enabled, false, c.label);
});

test("a member session opens its project's home", () => {
  const s: AppState = {
    ...state,
    connected: false,
    sessionReferences: [
      sessionReference("/repo", "s1", { projectId: "p2" }),
      sessionReference("/repo", "s2"),
    ],
  };
  const open = sessionProjectMenu(s, { cwd: "/repo", sessionId: "s1" }).open;
  assert.deepEqual(open, openProjectCommand(billing));
  assert.equal(open?.label, "Open project: Billing");
  assert.equal(open?.enabled, true, "navigation needs no connection");
  assert.deepEqual(open?.intent, { kind: "open-project", projectId: "p2" });
  assert.equal(sessionProjectMenu(s, { cwd: "/repo", sessionId: "s2" }).open, undefined);
});
