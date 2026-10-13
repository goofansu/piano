import assert from "node:assert/strict";
import { test } from "node:test";
import type { FolderView, SessionState, WorktreeView } from "../shared/wire.ts";
import {
  pickCommands,
  SESSION_HEADER_COMMANDS,
  SESSION_ROW_COMMANDS,
  type SessionCommandId,
  sessionCommands,
} from "../web/src/lib/sessionCommands.ts";
import { type AppState, initialState, type SessionView } from "../web/src/store.ts";
import { sessionReference } from "./fixtures/sessionReference.ts";

const ws = (path: string) => ({ id: `ws:${path}`, folder: "/repo", path });
const worktree = (path: string, branch: string | null): WorktreeView => ({
  workspace: ws(path),
  trust: { required: true, trusted: false },
  branch,
  path,
  root: path === "/repo",
  status: "current",
});
const folder: FolderView = {
  path: "/repo",
  name: "repo",
  worktrees: [worktree("/repo", "main"), worktree("/work/repo.feature", "feature")],
  discovery: { status: "ready", observedAt: "", currentPath: "/repo", worktrees: [] },
};
const session = (cwd: string, state: Partial<SessionState> = {}): SessionView => ({
  cwd,
  sessionId: "s1",
  hosted: true,
  cursor: null,
  state: { sessionId: "s1", ...state } as SessionState,
  messages: [],
  dialogs: [],
});
const base: AppState = {
  ...initialState,
  connected: true,
  selectionId: "sel",
  view: { kind: "session" },
  folders: [folder],
  workspaces: [ws("/repo"), ws("/work/repo.feature")],
  sessionReferences: [
    sessionReference("/work/repo.feature", "s1"),
    sessionReference("/repo", "s2"),
  ],
  session: session("/work/repo.feature"),
};
const other = { cwd: "/repo", sessionId: "s2", title: "Other" };

const enabled = (state: AppState, target?: typeof other) =>
  Object.fromEntries(sessionCommands(state, target).map((c) => [c.id, c.enabled])) as Partial<
    Record<SessionCommandId, boolean>
  >;

test("session command availability: settled, disconnected, resyncing, missing checkout, no workspace", () => {
  const settled = enabled(base);
  assert.deepEqual(settled, {
    "copy-working-directory": true,
    "copy-branch": true,
    "copy-session-id": true,
    "copy-all": true,
    changes: true,
    "pull-request": true,
    "display-everything": true,
    "display-messages": true,
    rename: true,
    pin: true,
    archive: true,
    delete: true,
    "new-session-here": true,
  });

  const disconnected = enabled({ ...base, connected: false });
  for (const id of ["rename", "pin", "archive", "delete"] as const)
    assert.equal(disconnected[id], false, id);
  assert.equal(disconnected.changes, true, "Changes reads the registry workspace, not the socket");
  assert.equal(enabled({ ...base, connected: false }, other).archive, false);

  // A resync holds the selected session's registry changes but not another row's.
  const resync = { ...base, resync: true };
  for (const id of ["rename", "archive", "delete"] as const)
    assert.equal(enabled(resync)[id], false, id);
  assert.deepEqual(enabled(resync, other), {
    rename: true,
    pin: true,
    archive: true,
    delete: true,
  });
  assert.equal(enabled(resync).pin, true, "pinning only changes registry preferences");
  // The same holds while a selection is in flight.
  assert.equal(
    enabled({ ...base, selecting: { cwd: "/work/repo.feature", sessionId: "s1" } }).delete,
    false,
  );

  const missing = enabled({
    ...base,
    session: session("/work/repo.feature", { checkoutMissing: true }),
  });
  assert.deepEqual(
    [missing.rename, missing.changes, missing["new-session-here"], missing.archive, missing.delete],
    [false, false, false, true, true],
  );
  const missingRow = enabled(
    {
      ...base,
      sessionReferences: [
        sessionReference(other.cwd, other.sessionId, {
          title: other.title,
          unavailable: "checkout",
        }),
      ],
    },
    other,
  );
  assert.deepEqual(missingRow, { rename: false, pin: true, archive: true, delete: true });

  const noWorkspace = enabled({ ...base, workspaces: [] });
  assert.equal(noWorkspace.changes, false);
  assert.equal(noWorkspace["pull-request"], true);

  // Starting a session: no Pi session ID yet, so nothing names it.
  const unnamed = enabled({
    ...base,
    session: { ...session("/work/repo.feature"), sessionId: null },
  });
  assert.deepEqual(
    [
      unnamed["copy-session-id"],
      unnamed["pull-request"],
      unnamed.rename,
      unnamed.archive,
      unnamed.delete,
    ],
    [false, false, false, false, false],
  );

  // The New page: no selection, and sidebar rows stay actionable.
  assert.deepEqual(
    enabled({ ...base, session: null, selectionId: null, view: { kind: "new" } }, other),
    { rename: true, pin: true, archive: true, delete: true },
  );
  assert.deepEqual(
    enabled({ ...base, session: null, selectionId: null, view: { kind: "new" } }),
    {},
  );
});

test("pin commands reflect registry state and stay available independently of Pi activity", () => {
  const pin = sessionCommands(base, other).find((c) => c.id === "pin")!;
  assert.equal(pin.label, "Pin");
  assert.deepEqual(pin.intent, {
    kind: "send",
    command: { _tag: "pin_session", cwd: other.cwd, sessionId: other.sessionId, pinned: true },
  });
  const pinned = {
    ...base,
    sessionReferences: base.sessionReferences.map((s) => ({ ...s, pinned: true })),
  };
  const unpin = sessionCommands(pinned, other).find((c) => c.id === "pin")!;
  assert.equal(unpin.label, "Unpin");
  assert.deepEqual(unpin.intent, {
    kind: "send",
    command: { _tag: "pin_session", cwd: other.cwd, sessionId: other.sessionId, pinned: false },
  });
  assert.equal(enabled({ ...base, sessionReferences: [] }, other).pin, false);
  assert.equal(
    enabled(
      { ...base, sessionReferences: base.sessionReferences.map((s) => ({ ...s, archived: true })) },
      other,
    ).pin,
    false,
  );
  assert.equal(
    enabled({ ...base, session: session("/work/repo.feature", { isStreaming: true }) }).pin,
    true,
  );
});

test("display choices mark the current one", () => {
  const checked = sessionCommands(base, undefined, { display: "messages" })
    .filter((c) => c.checked)
    .map((c) => c.id);
  assert.deepEqual(checked, ["display-messages"]);
});

test("the palette offers every command the session header and the sidebar row menu offer", () => {
  const options = { radiusSignedIn: true };
  const palette = new Set(sessionCommands(base, undefined, options).map((c) => c.id));
  for (const id of SESSION_HEADER_COMMANDS) assert.ok(palette.has(id), `header ${id}`);
  for (const id of SESSION_ROW_COMMANDS) assert.ok(palette.has(id), `row ${id}`);
  // The selected session's own row menu resolves to the same commands, with the same enablement.
  const row = pickCommands(
    sessionCommands(base, { cwd: "/work/repo.feature", sessionId: "s1" }, options),
    SESSION_ROW_COMMANDS,
  );
  const fromPalette = pickCommands(sessionCommands(base, undefined, options), SESSION_ROW_COMMANDS);
  assert.deepEqual(
    row.map((c) => [c.id, c.label, c.enabled]),
    fromPalette.map((c) => [c.id, c.label, c.enabled]),
  );
  assert.deepEqual(
    row.map((c) => c.id),
    ["rename", "pin", "share", "archive", "delete"],
  );
});

test("Share is Radius-sign-in only and targets the row, independent of selected model or MCP", () => {
  assert.ok(!sessionCommands(base).some((command) => command.id === "share"));
  const share = (state: AppState, target = other) =>
    sessionCommands(state, target, { radiusSignedIn: true }).find(
      (command) => command.id === "share",
    )!;
  assert.equal(share(base).label, "Share");
  assert.equal(share(base).enabled, true);
  assert.deepEqual(share(base).intent, { kind: "share", target: other });
  assert.equal(share({ ...base, connected: false }).enabled, false);
  assert.equal(share({ ...base, workspaces: [] }).enabled, false);
  assert.equal(share({ ...base, sessionReferences: [] }).enabled, false);
  assert.equal(share({ ...base, hosts: [{ ...other, streaming: true }] }).enabled, false);
  // An unavailable checkout does not prevent sharing its saved history.
  const withAvailability = (unavailable: "history" | "checkout") => ({
    ...base,
    sessionReferences: [sessionReference(other.cwd, other.sessionId, { unavailable })],
  });
  assert.equal(share(withAvailability("history")).enabled, false);
  assert.equal(share(withAvailability("checkout")).enabled, true);
});
