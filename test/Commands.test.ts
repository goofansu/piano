import assert from "node:assert/strict";
import { test } from "node:test";
import type { Project, SessionState } from "../shared/wire.ts";
import { type Command, type CommandEffects, runCommand } from "../web/src/lib/commands.ts";
import { folderCommands } from "../web/src/lib/folderCommands.ts";
import { globalCommands, trustCommand } from "../web/src/lib/globalCommands.ts";
import {
  assignProjectCommand,
  newProjectCommand,
  projectCommands,
} from "../web/src/lib/projectCommands.ts";
import { sessionCommands } from "../web/src/lib/sessionCommands.ts";
import { type AppState, initialState } from "../web/src/store.ts";

const launch: Project = { id: "p1", name: "Launch", archived: false };
const folder = { path: "/repo", name: "repo" };
const online: AppState = {
  ...initialState,
  connected: true,
  projects: [launch],
  view: { kind: "new", cwd: "/repo" },
  trusts: { "/repo": { required: true, trusted: false } },
};
const other = { cwd: "/repo", sessionId: "s2", title: "Other" };

/** Runs `command` against effects that record each call by name. */
function effectsOf(command: Command) {
  const calls: unknown[][] = [];
  const effects = new Proxy({} as CommandEffects, {
    get:
      (_, name) =>
      (...args: unknown[]) => {
        calls.push([name, ...args]);
      },
  });
  return { ran: runCommand(command, effects), calls };
}

test("a disabled command does nothing, whichever surface offers it", () => {
  const offline = { ...online, connected: false };
  const disabled: Command[] = [
    trustCommand(offline, "/repo")!,
    ...projectCommands(offline, launch).filter((c) => c.id !== "new-session"),
    projectCommands(
      { ...online, projects: [{ ...launch, archived: true }] },
      { ...launch, archived: true },
    )[0]!,
    newProjectCommand(offline),
    assignProjectCommand(offline, other, "p1"),
    folderCommands(offline, folder).close,
    ...sessionCommands(offline, other),
  ];
  for (const command of disabled) {
    assert.equal(command.enabled, false, command.label);
    assert.deepEqual(effectsOf(command), { ran: false, calls: [] }, command.label);
  }
});

test("enabled commands reach the effect their intent names", () => {
  const byId = <C extends Command>(list: C[], id: string) => list.find((c) => c.id === id)!;
  const cases: [Command, unknown[]][] = [
    [trustCommand(online, "/repo")!, ["send", { _tag: "set_trust", path: "/repo", trusted: true }]],
    [
      byId(
        globalCommands(online, {
          settingsOpen: false,
          view: { groupBy: "date", sortBy: "recent" },
        }),
        "new-session",
      ),
      ["openNew", undefined, undefined],
    ],
    [byId(projectCommands(online, launch), "new-session"), ["openNew", undefined, "p1"]],
    [
      byId(projectCommands(online, launch), "edit"),
      ["openForm", { kind: "project", dialog: { project: launch } }],
    ],
    [
      byId(projectCommands(online, launch), "archive"),
      ["send", { _tag: "archive_project", id: "p1", archived: true }],
    ],
    [
      newProjectCommand(online, other),
      ["openForm", { kind: "project", dialog: { assign: { cwd: "/repo", sessionId: "s2" } } }],
    ],
    [
      assignProjectCommand(online, other, null),
      ["send", { _tag: "assign_project", cwd: "/repo", sessionId: "s2", projectId: null }],
    ],
    [folderCommands(online, folder).create, ["openNew", "/repo", undefined]],
    [folderCommands(online, folder).close, ["openForm", { kind: "close-folder", folder }]],
    [
      byId(sessionCommands(online, other), "rename"),
      ["openForm", { kind: "rename-session", target: other }],
    ],
    [
      byId(sessionCommands(online, other), "archive"),
      ["send", { _tag: "archive_session", cwd: "/repo", sessionId: "s2" }],
    ],
  ];
  for (const [command, call] of cases)
    assert.deepEqual(effectsOf(command), { ran: true, calls: [call] }, command.label);
});

test("archiving a working background session asks before sending a destructive command", () => {
  const working: AppState = {
    ...online,
    hosts: [{ cwd: other.cwd, sessionId: other.sessionId, streaming: true }],
  };
  const archive = sessionCommands(working, other).find((c) => c.id === "archive")!;
  assert.equal(archive.enabled, true);
  assert.deepEqual(effectsOf(archive), {
    ran: true,
    calls: [["openForm", { kind: "archive-session", target: other }]],
  });
});

test("archiving selected streaming, compacting, retrying or submitting work asks first", () => {
  for (const activity of [
    { isStreaming: true },
    { isCompacting: true },
    { isRetrying: true },
    { submission: { id: 1, outcome: "submitting" } },
  ]) {
    const working: AppState = {
      ...online,
      selectionId: "sel",
      session: {
        ...other,
        hosted: true,
        cursor: null,
        state: { sessionId: other.sessionId, ...activity } as SessionState,
        messages: [],
        dialogs: [],
      },
    };
    const archive = sessionCommands(working, other).find((c) => c.id === "archive")!;
    assert.deepEqual(effectsOf(archive), {
      ran: true,
      calls: [["openForm", { kind: "archive-session", target: other }]],
    });
  }
});

test("the selected session's New session here opens its directory", () => {
  const session = {
    cwd: "/repo/wt",
    sessionId: "s1",
    hosted: true,
    cursor: null,
    state: { sessionId: "s1" } as SessionState,
    messages: [],
    dialogs: [],
  };
  const selected: AppState = { ...online, view: { kind: "session" }, session };
  const here = sessionCommands(selected).find((c) => c.id === "new-session-here")!;
  assert.deepEqual(effectsOf(here), { ran: true, calls: [["openNew", "/repo/wt", undefined]] });
});
