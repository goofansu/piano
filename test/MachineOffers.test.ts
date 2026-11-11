import assert from "node:assert/strict";
import { test } from "node:test";
import { folderCommands } from "../web/src/lib/folderCommands.ts";
import { trustCommand } from "../web/src/lib/globalCommands.ts";
import { LOCAL } from "../web/src/lib/machine.ts";
import { type MachineOffers, machineOffers } from "../web/src/lib/machineOffers.ts";
import {
  assignProjectCommand,
  newProjectCommand,
  projectCommands,
} from "../web/src/lib/projectCommands.ts";
import { sessionCommands } from "../web/src/lib/sessionCommands.ts";
import { type AppState, initialState } from "../web/src/store.ts";

const state: AppState = {
  ...initialState,
  connected: true,
  view: { kind: "new", cwd: "/repo" },
  trusts: { "/repo": { required: true, trusted: false } },
};
const folder = { path: "/repo", name: "repo" };
const project = { id: "p1", name: "Launch" };
const session = { cwd: "/repo", sessionId: "s1" };
const surfaces = (offers: MachineOffers) =>
  Object.entries(offers)
    .filter(([, value]) => typeof value === "boolean")
    .map(([name, value]) => [name, value] as const);

test("Local offers every surface and command", () => {
  const offers = machineOffers(LOCAL);
  for (const [name, offered] of surfaces(offers)) assert.equal(offered, true, name);
  assert.ok(offers.command(trustCommand(state, "/repo")!));
  assert.ok(offers.command(folderCommands(state, folder).close));
});

test("a remote offers the conversation slice, its projects and its sessions' menus, nothing else that manages it", () => {
  const remote = { id: "eng-1", name: "eng-1" };
  const offers = machineOffers(remote);
  assert.deepEqual(
    surfaces(offers).filter(([, offered]) => offered),
    [["attachments", true]],
    "previews, accounts, worktrees, browse, trust, folders, settings and last directory stay on the remote",
  );
  assert.ok(offers.command(folderCommands(state, folder).create), "New session here");
  for (const command of [
    ...projectCommands(state, project),
    newProjectCommand(state),
    assignProjectCommand(state, session, project.id),
    assignProjectCommand(state, session, null),
  ])
    assert.ok(offers.command(command), command.label);
  // Trusting a folder runs its project extensions on the remote.
  assert.ok(!offers.command(trustCommand(state, "/repo")!), "folder trust");
  assert.ok(!offers.command(folderCommands(state, folder).close), "Close folder");
  // A session's own life is managed from here too, except sharing, which publishes through the
  // remote's Radius sign-in.
  const commands = sessionCommands(
    state,
    { ...session, title: "Session" },
    { radiusSignedIn: true },
  );
  for (const id of ["rename", "pin", "archive", "delete"]) {
    const command = commands.find((c) => c.id === id);
    assert.ok(command && offers.command(command), id);
  }
  const share = commands.find((c) => c.id === "share");
  assert.ok(share && !offers.command(share), "share");
});
