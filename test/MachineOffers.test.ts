import assert from "node:assert/strict";
import { test } from "node:test";
import type { FolderView } from "../shared/wire.ts";
import { folderCommands } from "../web/src/lib/folderCommands.ts";
import { globalCommands, trustCommand } from "../web/src/lib/globalCommands.ts";
import { LOCAL } from "../web/src/lib/machine.ts";
import { type MachineOffers, machineOffers } from "../web/src/lib/machineOffers.ts";
import {
  assignProjectCommand,
  newProjectCommand,
  projectCommands,
} from "../web/src/lib/projectCommands.ts";
import { SETTINGS_SECTIONS } from "../web/src/lib/routes.ts";
import { sessionCommands } from "../web/src/lib/sessionCommands.ts";
import { type AppState, initialState } from "../web/src/store.ts";

const state: AppState = {
  ...initialState,
  connected: true,
  view: { kind: "new", cwd: "/repo" },
  trusts: { "/repo": { required: true, trusted: false } },
};
const folder = { path: "/repo", name: "repo" };
const openFolder: FolderView = {
  ...folder,
  worktrees: [
    {
      workspace: { id: "ws:/repo", folder: "/repo", path: "/repo" },
      trust: { required: true, trusted: false },
      branch: "main",
      path: "/repo",
      root: true,
      status: "current",
    },
  ],
  discovery: { status: "non-git", observedAt: "" },
};
const project = { id: "p1", name: "Launch" };
const session = { cwd: "/repo", sessionId: "s1" };
const surfaces = (offers: MachineOffers) =>
  Object.entries(offers)
    .filter(([, value]) => typeof value === "boolean")
    .map(([name, value]) => [name, value] as const);

test("Data controls is the seventh Settings destination, offered only on Local", () => {
  assert.equal(SETTINGS_SECTIONS.length, 7);
  assert.deepEqual(SETTINGS_SECTIONS.at(-1), {
    id: "data-controls",
    label: "Data controls",
    icon: "archive",
  });
  const commands = globalCommands(state, {
    settings: null,
    view: { groupBy: "date", sortBy: "recent", folderAndBranch: false },
    theme: "dark",
  });
  const command = commands.find((c) => c.id === "settings-data-controls");
  assert.ok(command);
  assert.equal(machineOffers(LOCAL).command(command), true);
  const remote = machineOffers({ id: "eng-1", name: "eng-1" });
  assert.equal(remote.settings, false);
  assert.equal(remote.command(command), false);
  for (const wire of [
    { _tag: "archive_sessions_count", requestId: "r1" },
    { _tag: "archive_all_sessions", requestId: "r2" },
    { _tag: "unarchive_session", cwd: "/repo", sessionId: "s1", requestId: "r3" },
  ] as const) {
    assert.equal(remote.command({ ...command, intent: { kind: "send", command: wire } }), false);
  }
});

test("Local offers every surface and command", () => {
  const offers = machineOffers(LOCAL);
  for (const [name, offered] of surfaces(offers)) assert.equal(offered, true, name);
  assert.ok(offers.command(trustCommand(state, "/repo")!));
  const { create, close } = folderCommands(state, folder, offers);
  assert.equal(create?.enabled, true, "New session here");
  assert.equal(close?.enabled, true, "Close folder");
});

test("a remote offers the conversation slice, its projects and its sessions' menus, nothing else that manages it", () => {
  const remote = { id: "eng-1", name: "eng-1" };
  const offers = machineOffers(remote);
  assert.deepEqual(
    surfaces(offers).filter(([, offered]) => offered),
    [],
    "accounts, worktrees, browse and settings stay on the remote",
  );
  const opened: AppState = { ...state, folders: [openFolder] };
  const row = folderCommands(opened, folder, offers);
  assert.equal(row.create?.enabled, true, "New session here on an open folder's row");
  assert.equal(row.close, undefined, "Close folder stays on the remote");
  for (const command of [
    ...projectCommands(state, project),
    newProjectCommand(state),
    assignProjectCommand(state, session, project.id),
    assignProjectCommand(state, session, null),
  ])
    assert.ok(offers.command(command), command.label);
  assert.ok(offers.command(trustCommand(state, "/repo")!), "folder trust");
  const commands = sessionCommands(state, { ...session, title: "Session" });
  for (const id of ["rename", "pin", "archive", "delete"]) {
    const command = commands.find((c) => c.id === id);
    assert.ok(command && offers.command(command), id);
  }
});
