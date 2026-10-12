import assert from "node:assert/strict";
import { test } from "node:test";
import type { SessionState } from "../shared/wire.ts";
import {
  type GlobalCommandContext,
  globalCommands,
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
  settingsOpen: false,
  view: { groupBy: "date", sortBy: "recent" },
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
  assert.equal(labels(onNewPage, { ...ctx, settingsOpen: true })[0], "Home");
  assert.ok(!labels(onNewPage, { ...ctx, settingsOpen: true }).includes("Settings"));
});

test("exactly the current grouping and sort are checked", () => {
  const checked = (group: string, c: GlobalCommandContext) =>
    globalCommands(onNewPage, c)
      .filter((command) => command.group === group && command.checked)
      .map((command) => command.label);
  assert.deepEqual(checked("group-by", ctx), ["Group by date"]);
  assert.deepEqual(checked("sort-by", ctx), ["Sort by activity"]);
  const other = { ...ctx, view: { groupBy: "none", sortBy: "name" } } as const;
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

test("the palette keeps a Radius row, which opens Providers", () => {
  const radius = globalCommands(onNewPage, ctx).find((command) => command.label === "Radius");
  assert.deepEqual(radius?.intent, { kind: "settings", section: "radius" });
  assert.equal(
    labels(onNewPage).filter((label) => label === "Radius").length,
    1,
    "Radius is offered once",
  );
});
