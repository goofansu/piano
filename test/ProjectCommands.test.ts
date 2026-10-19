import assert from "node:assert/strict";
import { test } from "node:test";
import type { Project } from "../shared/wire.ts";
import {
  canStartSessionIn,
  projectCommands,
  projectDestinations,
  sessionProjectMenu,
} from "../web/src/lib/projectCommands.ts";
import { type AppState, initialState } from "../web/src/store.ts";
import { sessionReference } from "./fixtures/sessionReference.ts";

const launch: Project = { id: "p1", name: "Launch", archived: false };
const billing: Project = { id: "p2", name: "Billing", archived: false };
const legacy: Project = { id: "p3", name: "Legacy", archived: true };
const state: AppState = { ...initialState, connected: true, projects: [launch, legacy, billing] };

const names = (projects: readonly Project[]) => projects.map((p) => p.name);
const byId = (project: Project, s = state) =>
  Object.fromEntries(projectCommands(s, project).map((c) => [c.id, c]));

test("pickers offer active projects by name, numbers by value, as the sidebar lists them", () => {
  const q10: Project = { id: "q10", name: "Q10 launch", archived: false };
  const q2: Project = { id: "q2", name: "q2 launch", archived: false };
  const s = { ...state, projects: [...state.projects, q10, q2] };
  assert.deepEqual(names(projectDestinations(s, undefined, { keepCurrent: true })), [
    "Billing",
    "Launch",
    "q2 launch",
    "Q10 launch",
  ]);
});

test("the sidebar's menu leaves out the current project; the New page keeps it, even archived", () => {
  const sidebar = (current?: Project) =>
    names(projectDestinations(state, current, { keepCurrent: false }));
  const newPage = (current?: Project) =>
    names(projectDestinations(state, current, { keepCurrent: true }));
  assert.deepEqual(sidebar(launch), ["Billing"]);
  assert.deepEqual(sidebar(legacy), ["Billing", "Launch"]);
  assert.deepEqual(
    newPage(launch),
    ["Billing", "Launch"],
    "an active current project is not repeated",
  );
  assert.deepEqual(newPage(legacy), ["Billing", "Launch", "Legacy"]);
});

test("a session can start in no project or an active one, not in an archived one", () => {
  assert.equal(canStartSessionIn(state, undefined), true);
  assert.equal(canStartSessionIn(state, launch.id), true);
  assert.equal(canStartSessionIn(state, legacy.id), false);
  assert.equal(byId(launch)["new-session"]?.enabled, true);
  assert.deepEqual(byId(launch)["new-session"]?.intent, { kind: "new-session", projectId: "p1" });
  assert.equal(byId(legacy)["new-session"]?.enabled, false);
});

test("an active project offers Archive; an archived one offers Unarchive, which sends archived: false", () => {
  assert.deepEqual(
    projectCommands(state, launch).map((c) => c.label),
    ["New session in project", "Edit project", "Archive project"],
  );
  assert.deepEqual(byId(launch).archive?.intent, {
    kind: "send",
    command: { _tag: "archive_project", id: "p1", archived: true },
  });

  assert.deepEqual(
    projectCommands(state, legacy).map((c) => c.label),
    ["New session in project", "Edit project", "Unarchive project"],
  );
  assert.equal(byId(legacy).unarchive?.enabled, true);
  assert.deepEqual(byId(legacy).unarchive?.intent, {
    kind: "send",
    command: { _tag: "archive_project", id: "p3", archived: false },
  });
});

test("registry changes wait for a connection", () => {
  const offline = { ...state, connected: false };
  for (const project of [launch, legacy]) {
    for (const c of projectCommands(offline, project)) {
      if (c.intent.kind !== "new-session")
        assert.equal(c.enabled, false, `${project.name}: ${c.label}`);
    }
  }
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
