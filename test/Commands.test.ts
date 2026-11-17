import assert from "node:assert/strict";
import { test } from "node:test";
import type { Project, SessionState } from "../shared/wire.ts";
import { type Command, type CommandEffects, runCommand } from "../web/src/lib/commands.ts";
import { folderCommands } from "../web/src/lib/folderCommands.ts";
import { globalCommands, trustCommand } from "../web/src/lib/globalCommands.ts";
import { LOCAL } from "../web/src/lib/machine.ts";
import { machineOffers } from "../web/src/lib/machineOffers.ts";
import {
  assignProjectCommand,
  newProjectCommand,
  openProjectCommand,
  projectCommands,
} from "../web/src/lib/projectCommands.ts";
import { sessionCommands } from "../web/src/lib/sessionCommands.ts";
import { type AppState, initialState } from "../web/src/store.ts";
import { sessionReference } from "./fixtures/sessionReference.ts";

const launch: Project = { id: "p1", name: "Launch" };
const folder = { path: "/repo", name: "repo" };
const online: AppState = {
  ...initialState,
  connected: true,
  projects: [launch],
  view: { kind: "new", cwd: "/repo" },
  trusts: { "/repo": { required: true, trusted: false } },
  sessionReferences: [sessionReference("/repo", "s1"), sessionReference("/repo", "s2")],
};
const other = { cwd: "/repo", sessionId: "s2", title: "Other" };
const selected: AppState = {
  ...online,
  view: { kind: "session" },
  folders: [
    {
      path: "/repo",
      name: "repo",
      worktrees: [
        {
          workspace: { id: "ws:/repo", folder: "/repo", path: "/repo" },
          trust: { required: false, trusted: true },
          branch: "main",
          path: "/repo",
          root: true,
          status: "current",
        },
      ],
      discovery: { status: "non-git", observedAt: "2026-01-01T00:00:00.000Z" },
    },
  ],
  workspaces: [{ id: "ws:/repo", folder: "/repo", path: "/repo" }],
  session: {
    cwd: "/repo",
    sessionId: "s1",
    hosted: true,
    cursor: null,
    state: { sessionId: "s1", isStreaming: false } as SessionState,
    messages: [],
    dialogs: [],
  },
};

const linked: AppState = {
  ...selected,
  sessionReferences: [
    {
      cwd: "/repo",
      sessionId: "s1",
      workspaceId: "ws:/repo",
      branch: "main",
      archived: false,
      createdAt: "2026-10-01T00:00:00Z",
      updatedAt: "2026-10-01T00:00:00Z",
      pullRequest: { url: "https://github.com/acme/repo/pull/1", source: "manual" },
    },
  ],
};

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

const local = machineOffers(LOCAL);

test("a disabled command does nothing, whichever surface offers it", () => {
  const offline = { ...online, connected: false };
  const disabled: Command[] = [
    trustCommand(offline, "/repo", local)!,
    ...projectCommands(offline, launch, local).filter((c) => c.id === "delete"),
    newProjectCommand(offline, {}, local)!,
    assignProjectCommand(offline, other, "p1"),
    folderCommands(offline, folder, local).close!,
    ...sessionCommands(offline, other, { offers: local }),
  ];
  for (const command of disabled) {
    assert.equal(command.enabled, false, command.label);
    assert.deepEqual(effectsOf(command), { ran: false, calls: [] }, command.label);
  }
});

test("enabled commands reach the effect their intent names", () => {
  const byId = <C extends Command>(list: C[], id: string) => list.find((c) => c.id === id)!;
  const cases: [Command, unknown[]][] = [
    [trustCommand(online, "/repo", local)!, ["decideTrust", "/repo", true]],
    [
      byId(
        globalCommands(
          online,
          {
            machine: LOCAL,
            machines: [LOCAL],
            settings: null,
            view: { groupBy: "date", sortBy: "recent", folderAndBranch: false },
          },
          local,
        ),
        "new-session",
      ),
      ["openNew", undefined],
    ],
    [byId(projectCommands(online, launch, local), "new-session"), ["openProject", "p1"]],
    [openProjectCommand(launch), ["openProject", "p1"]],
    [
      byId(projectCommands(online, launch, local), "settings"),
      ["openForm", { kind: "project-settings", projectId: "p1" }],
    ],
    [
      byId(
        globalCommands(
          { ...online, view: { kind: "project", projectId: "p1" } },
          {
            machine: LOCAL,
            machines: [LOCAL],
            settings: null,
            view: { groupBy: "date", sortBy: "recent", folderAndBranch: false },
          },
          local,
        ),
        "project-settings",
      ),
      ["openForm", { kind: "project-settings", projectId: "p1" }],
    ],
    [
      byId(projectCommands(online, launch, local), "delete"),
      ["openForm", { kind: "delete-project", project: launch }],
    ],
    [
      newProjectCommand(online, { assign: other }, local)!,
      ["openForm", { kind: "project", dialog: { assign: { cwd: "/repo", sessionId: "s2" } } }],
    ],
    [
      assignProjectCommand(online, other, null),
      ["send", { _tag: "assign_project", cwd: "/repo", sessionId: "s2", projectId: null }],
    ],
    [folderCommands(online, folder, local).create!, ["openNew", "/repo"]],
    [folderCommands(online, folder, local).close!, ["openForm", { kind: "close-folder", folder }]],
    [
      byId(sessionCommands(online, other, { offers: local }), "rename"),
      ["openForm", { kind: "rename-session", target: other }],
    ],
    [
      byId(sessionCommands(online, other, { offers: local }), "archive"),
      ["send", { _tag: "archive_session", cwd: "/repo", sessionId: "s2" }],
    ],
    [byId(sessionCommands(selected, undefined, { offers: local }), "changes"), ["openChanges"]],
    [byId(sessionCommands(selected, undefined, { offers: local }), "session-rail"), ["toggleRail"]],
    [
      byId(sessionCommands(selected, undefined, { offers: local }), "pull-request"),
      ["openPullRequest"],
    ],
    [byId(sessionCommands(linked, undefined, { offers: local }), "pull-request"), ["openChanges"]],
  ];
  for (const [command, call] of cases)
    assert.deepEqual(effectsOf(command), { ran: true, calls: [call] }, command.label);
});

test("Artifacts is offered once the session published one, and opens the header's menu", () => {
  const artifacts = (state: AppState) =>
    sessionCommands(state, undefined, { offers: local }).find((c) => c.id === "artifacts")!;
  assert.equal(artifacts(selected).hidden, true, "nothing to list before the first artifact");
  const published: AppState = {
    ...selected,
    session: {
      ...selected.session!,
      messages: [
        {
          id: "m0",
          role: "assistant",
          text: "",
          toolCalls: [{ id: "c1", name: "radius_artifact_create", args: '{"title":"Report"}' }],
        },
        {
          id: "m1",
          role: "tool_result",
          text: '{"status":"confirmed","artifactId":"r1","url":"https://r.test/r1"}',
          toolName: "radius_artifact_create",
          toolCallId: "c1",
          isError: false,
        },
      ],
    },
  };
  const command = artifacts(published);
  assert.equal(command.label, "Artifacts");
  assert.ok(command.enabled && !command.hidden);
  assert.deepEqual(effectsOf(command), { ran: true, calls: [["openArtifacts"]] });
});

test("archiving a working background session asks before sending a destructive command", () => {
  const working: AppState = {
    ...online,
    hosts: [{ cwd: other.cwd, sessionId: other.sessionId, working: true }],
  };
  const archive = sessionCommands(working, other, { offers: local }).find(
    (c) => c.id === "archive",
  )!;
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
    const archive = sessionCommands(working, other, { offers: local }).find(
      (c) => c.id === "archive",
    )!;
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
  const here = sessionCommands(selected, undefined, { offers: local }).find(
    (c) => c.id === "new-session-here",
  )!;
  assert.deepEqual(effectsOf(here), { ran: true, calls: [["openNew", "/repo/wt"]] });
});
