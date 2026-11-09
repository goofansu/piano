import assert from "node:assert/strict";
import { test } from "node:test";
import { folderCommands } from "../web/src/lib/folderCommands.ts";
import { trustCommand } from "../web/src/lib/globalCommands.ts";
import { LOCAL } from "../web/src/lib/machine.ts";
import { isLocal, type MachineOffers, machineOffers } from "../web/src/lib/machineOffers.ts";
import { type AppState, initialState } from "../web/src/store.ts";

const state: AppState = {
  ...initialState,
  connected: true,
  view: { kind: "new", cwd: "/repo" },
  trusts: { "/repo": { required: true, trusted: false } },
};
const folder = { path: "/repo", name: "repo" };
const views = ["session", "new", "projects", "project", "missing-session"] as const;
const surfaces = (offers: MachineOffers) =>
  Object.entries(offers)
    .filter(([, value]) => typeof value === "boolean")
    .map(([name, value]) => [name, value] as const);

test("Local offers every surface, page and command", () => {
  assert.ok(isLocal(LOCAL), "Local keeps this Piano's own socket");
  const offers = machineOffers(LOCAL);
  for (const [name, offered] of surfaces(offers)) assert.equal(offered, true, name);
  for (const kind of views) assert.ok(offers.view(kind), kind);
  assert.ok(offers.fullSidebar, "the sidebar leads to Projects and Settings");
  assert.ok(offers.command(trustCommand(state, "/repo")!));
  assert.ok(offers.command(folderCommands(state, folder).close));
});

test("a remote offers the conversation slice: sessions, the New page and New session, nothing that manages it", () => {
  const remote = { id: "eng-1", name: "eng-1" };
  assert.ok(!isLocal(remote), "a remote connects through the gateway");
  const offers = machineOffers(remote);
  assert.deepEqual(
    surfaces(offers).filter(([, offered]) => offered),
    [["attachments", true]],
    "files, rail, voice input, pull requests, previews, accounts, worktrees, browse, trust, folders, projects, session menus, settings, the full sidebar and last directory stay on the remote",
  );
  assert.ok(!offers.fullSidebar, "the sidebar lists sessions alone");
  assert.deepEqual(
    views.filter((kind) => offers.view(kind)),
    ["session", "new"],
  );
  assert.ok(offers.command(folderCommands(state, folder).create), "New session here");
  // Trusting a folder runs its project extensions on the remote.
  assert.ok(!offers.command(trustCommand(state, "/repo")!), "folder trust");
  assert.ok(!offers.command(folderCommands(state, folder).close), "Close folder");
});
