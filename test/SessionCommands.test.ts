import assert from "node:assert/strict";
import { test } from "node:test";
import type { FolderView, SessionState, WorktreeView } from "../shared/wire.ts";
import {
  type SessionCommandId,
  type SessionHeaderMenu,
  sessionCommands,
  sessionHeaderMenu,
  sessionRowMenu,
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
    "wrap-changes": true,
    "pull-request": true,
    "messages-only": true,
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

test("Messages only is off by default; running it toggles, and it is checked while on", () => {
  const command = (messagesOnly?: boolean) =>
    sessionCommands(base, undefined, { messagesOnly }).find((c) => c.id === "messages-only");
  assert.deepEqual(command()?.checked, false);
  assert.deepEqual(command()?.intent, { kind: "messages-only", on: true });
  assert.deepEqual(command(true)?.checked, true);
  assert.deepEqual(command(true)?.intent, { kind: "messages-only", on: false });
  assert.deepEqual(
    sessionCommands(base, undefined, { messagesOnly: true })
      .filter((c) => c.checked)
      .map((c) => c.id),
    ["messages-only"],
  );
});

test("Wrap reflects the diff preference and is only available for an inspectable selected workspace", () => {
  const command = (state: AppState, changesWrap?: boolean) =>
    sessionCommands(state, undefined, { changesWrap }).find((c) => c.id === "wrap-changes")!;
  assert.equal(command(base).checked, false);
  assert.deepEqual(command(base).intent, { kind: "wrap-changes", on: true });
  assert.equal(command(base, true).checked, true);
  assert.deepEqual(command(base, true).intent, { kind: "wrap-changes", on: false });
  assert.equal(command({ ...base, workspaces: [] }).enabled, false);
  assert.equal(
    command({ ...base, session: session("/work/repo.feature", { checkoutMissing: true }) }).enabled,
    false,
  );
  assert.ok(!sessionCommands(base, other).some((c) => c.id === "wrap-changes"));
});

const headerIds = ({ details, open, manage, display, destructive }: SessionHeaderMenu) => [
  ...[...details, ...open, ...manage, ...destructive].map((c) => c.id),
  ...(display ? [display.id] : []),
];

test("the palette offers every command the session header and the sidebar row menu offer", () => {
  const options = { radiusSignedIn: true };
  const commands = sessionCommands(base, undefined, options);
  const palette = new Set(commands.map((c) => c.id));
  for (const id of headerIds(sessionHeaderMenu(commands)))
    assert.ok(palette.has(id), `header ${id}`);
  for (const id of sessionRowMenu(commands)
    .sections.flat()
    .map((c) => c.id))
    assert.ok(palette.has(id), `row ${id}`);
  // The selected session's own row menu resolves to the same commands, with the same enablement.
  const row = sessionRowMenu(
    sessionCommands(base, { cwd: "/work/repo.feature", sessionId: "s1" }, options),
  ).sections.flat();
  const fromPalette = sessionRowMenu(commands).sections.flat();
  assert.deepEqual(
    row.map((c) => [c.id, c.label, c.enabled]),
    fromPalette.map((c) => [c.id, c.label, c.enabled]),
  );
});

test("the row menu: rename and pin, share only when signed in to Radius, then archive with delete", () => {
  const sections = (radiusSignedIn: boolean) =>
    sessionRowMenu(sessionCommands(base, other, { radiusSignedIn })).sections.map((s) =>
      s.map((c) => c.id),
    );
  assert.deepEqual(sections(true), [["rename", "pin"], ["share"], ["archive", "delete"]]);
  assert.deepEqual(sections(false), [
    ["rename", "pin"],
    ["archive", "delete"],
  ]);
});

test("the header menu: copy beside the details, open, manage with share only when signed in, a Messages only switch, then archive with delete", () => {
  for (const messagesOnly of [false, true]) {
    const menu = sessionHeaderMenu(
      sessionCommands(base, undefined, { messagesOnly, radiusSignedIn: true }),
    );
    assert.deepEqual(
      menu.details.map((c) => c.id),
      ["copy-all"],
    );
    assert.deepEqual(
      menu.open.map((c) => c.id),
      ["changes", "pull-request"],
    );
    assert.deepEqual(
      menu.manage.map((c) => c.id),
      ["rename", "pin", "share"],
    );
    assert.deepEqual(
      menu.destructive.map((c) => c.id),
      ["archive", "delete"],
    );
    assert.equal(menu.display?.label, "Messages only");
    assert.equal(menu.display?.checked, messagesOnly);
  }
  assert.deepEqual(
    sessionHeaderMenu(sessionCommands(base)).manage.map((c) => c.id),
    ["rename", "pin"],
  );
  // Another session's commands carry no header: nothing to open or switch, only management.
  const other = sessionHeaderMenu(sessionCommands(base, { cwd: "/work/other", sessionId: "s9" }));
  assert.deepEqual(other.details, []);
  assert.deepEqual(other.open, []);
  assert.equal(other.display, undefined);
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
  // The selected session is busy while its prompt is submitting, before its host streams.
  const selected = { cwd: "/work/repo.feature", sessionId: "s1", title: "Selected" };
  const selectedHost = [{ ...selected, streaming: false }];
  assert.equal(share({ ...base, hosts: selectedHost }, selected).enabled, true);
  const submitting = {
    ...base,
    hosts: selectedHost,
    session: session(selected.cwd, { submission: { id: 1, outcome: "submitting" } }),
  };
  assert.equal(share(submitting, selected).enabled, false);
  // An unavailable checkout does not prevent sharing its saved history.
  const withAvailability = (unavailable: "history" | "checkout") => ({
    ...base,
    sessionReferences: [sessionReference(other.cwd, other.sessionId, { unavailable })],
  });
  assert.equal(share(withAvailability("history")).enabled, false);
  assert.equal(share(withAvailability("checkout")).enabled, true);
});
