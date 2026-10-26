import assert from "node:assert/strict";
import { test } from "node:test";
import type { FolderView, SessionPreview, SessionState, WorktreeView } from "../shared/wire.ts";
import {
  type SessionCommandId,
  type SessionHeaderMenu,
  type SessionRowMenu,
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
    sessionReference("/work/repo.feature", "s1", { branch: "feature" }),
    sessionReference("/repo", "s2", { branch: "main" }),
  ],
  session: session("/work/repo.feature"),
};
const other = { cwd: "/repo", sessionId: "s2", title: "Other" };

const enabled = (state: AppState, target?: typeof other) =>
  Object.fromEntries(sessionCommands(state, target).map((c) => [c.id, c.enabled])) as Partial<
    Record<SessionCommandId, boolean>
  >;

test("saved session path copies without a running Pi, and is unavailable without a file", () => {
  const path = "/home/test/.pi/agent/sessions/--repo--/2026-01-01_s1.jsonl";
  const saved = { ...session("/repo", { sessionFile: path }), hosted: false };
  const command = sessionCommands({ ...base, session: saved }).find(
    (c) => c.id === "copy-session-path",
  );
  assert.equal(command?.enabled, true);
  assert.deepEqual(command?.intent, { kind: "copy", value: path, label: "Session path" });
  assert.equal(enabled(base)["copy-session-path"], false);
});

test("session command availability: settled, disconnected, resyncing, missing checkout, no workspace", () => {
  const settled = enabled(base);
  assert.deepEqual(settled, {
    "copy-working-directory": true,
    "copy-branch": true,
    "copy-session-id": true,
    "copy-session-path": false,
    views: true,
    changes: true,
    details: true,
    "hide-changes": false,
    agent: false,
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
  const changesOf = (state: AppState) =>
    sessionCommands(state).find((c) => c.id === "changes")?.detail;
  assert.equal(
    changesOf({ ...base, session: session("/work/repo.feature", { checkoutMissing: true }) }),
    "Checkout removed",
    "unavailable Changes says why, never No changes",
  );
  assert.equal(changesOf(base), undefined);
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

const rowCommands = ({ sections, destructive }: SessionRowMenu) => [
  ...sections.flat(),
  ...destructive,
];

test("the palette offers every command the session header and the sidebar row menu offer", () => {
  const options = { radiusSignedIn: true };
  const commands = sessionCommands(base, undefined, options);
  const palette = new Set(commands.map((c) => c.id));
  for (const id of headerIds(sessionHeaderMenu(commands)))
    assert.ok(palette.has(id), `header ${id}`);
  for (const id of rowCommands(sessionRowMenu(commands)).map((c) => c.id))
    assert.ok(palette.has(id), `row ${id}`);
  // The selected session's own row menu resolves to the same commands, with the same enablement.
  const row = rowCommands(
    sessionRowMenu(sessionCommands(base, { cwd: "/work/repo.feature", sessionId: "s1" }, options)),
  );
  const fromPalette = rowCommands(sessionRowMenu(commands));
  assert.deepEqual(
    row.map((c) => [c.id, c.label, c.enabled]),
    fromPalette.map((c) => [c.id, c.label, c.enabled]),
  );
});

test("the row menu: rename and pin, share only when signed in to Radius, then archive with delete last", () => {
  const menu = (radiusSignedIn: boolean) => {
    const { sections, destructive } = sessionRowMenu(
      sessionCommands(base, other, { radiusSignedIn }),
    );
    return {
      sections: sections.map((s) => s.map((c) => c.id)),
      destructive: destructive.map((c) => c.id),
    };
  };
  assert.deepEqual(menu(true), {
    sections: [["rename", "pin"], ["share"]],
    destructive: ["archive", "delete"],
  });
  assert.deepEqual(menu(false), {
    sections: [["rename", "pin"]],
    destructive: ["archive", "delete"],
  });
});

test("the header menu: copy beside the details, open, manage with share only when signed in, a Messages only switch, then archive with delete", () => {
  for (const messagesOnly of [false, true]) {
    const menu = sessionHeaderMenu(
      sessionCommands(base, undefined, { messagesOnly, radiusSignedIn: true }),
    );
    assert.deepEqual(
      menu.details.map((c) => c.id),
      ["copy-session-path"],
    );
    assert.deepEqual(
      menu.open.map((c) => c.id),
      ["pull-request"],
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

const app = (preview: Partial<SessionPreview> = {}): SessionPreview => ({
  instanceId: "i1",
  state: "running",
  ready: true,
  url: "http://localhost:5173/",
  port: 5173,
  command: ["npm", "run", "dev"],
  detail: "",
  externalAccess: "same-host",
  observedAt: 0,
  ...preview,
});
const previewIds = (state: AppState) =>
  sessionCommands(state)
    .filter((c) => c.id.includes("preview"))
    .map((c) => [c.id, c.enabled]);

test("preview commands exist only while the selected session's live Pi owns an app", () => {
  assert.deepEqual(previewIds(base), []);
  const running = { ...base, session: session("/work/repo.feature", { preview: app() }) };
  assert.deepEqual(previewIds(running), [
    ["open-preview", true],
    ["preview-details", true],
    ["stop-preview", true],
  ]);
  const open = sessionCommands(running).find((c) => c.id === "open-preview");
  assert.deepEqual(open?.intent, { kind: "open-url", url: "http://localhost:5173/" });
  assert.equal(open?.detail, "localhost:5173");
  assert.deepEqual(sessionCommands(running).find((c) => c.id === "stop-preview")?.intent, {
    kind: "send",
    command: { _tag: "act", action: { _tag: "preview_stop", instanceId: "i1" } },
  });
  // The header's preview control offers open and stop itself; the menu does not repeat them.
  assert.deepEqual(
    sessionHeaderMenu(sessionCommands(running)).open.map((c) => c.id),
    ["pull-request"],
  );

  // An app that is not answering has nothing to open, but can still be inspected and stopped.
  const failed = {
    ...base,
    session: session("/work/repo.feature", {
      preview: app({ state: "failed", ready: false, url: null }),
    }),
  };
  assert.deepEqual(previewIds(failed), [
    ["open-preview", false],
    ["preview-details", true],
    ["stop-preview", true],
  ]);
  assert.equal(
    previewIds({ ...running, resync: true }).at(-1)?.[1],
    false,
    "stop waits for resync",
  );

  // A closed or peeked session's last state is not a running app.
  const closed = session("/work/repo.feature", {
    preview: app(),
    closure: { _tag: "released", detail: "" },
  });
  assert.deepEqual(previewIds({ ...base, session: closed }), []);
  const peek = { ...session("/work/repo.feature", { preview: app() }), hosted: false };
  assert.deepEqual(previewIds({ ...base, session: peek }), []);
  // Another session's commands never offer this session's app.
  assert.deepEqual(
    sessionCommands(running, other).filter((c) => c.id.includes("preview")),
    [],
  );
});

test("archiving a session that owns an app asks first, from the header or its sidebar row", () => {
  const archive = (state: AppState, target?: typeof other) =>
    sessionCommands(state, target).find((c) => c.id === "archive")?.intent;
  assert.equal((archive(base) as { confirm: boolean }).confirm, false);
  const running = { ...base, session: session("/work/repo.feature", { preview: app() }) };
  assert.equal((archive(running) as { confirm: boolean }).confirm, true);
  const background = { ...base, hosts: [{ ...other, streaming: false, preview: true }] };
  assert.equal((archive(background, other) as { confirm: boolean }).confirm, true);
});

test("view commands follow the session's areas: Views and Hide changes side by side, Agent one at a time", () => {
  const ofAreas = (
    { surface, single }: { surface: "changes" | null; single: boolean },
    state = base,
  ) =>
    Object.fromEntries(
      sessionCommands(state, undefined, {
        areas: { single, surface: surface && { tabs: [surface], active: surface } },
      })
        .filter((c) => ["views", "changes", "details", "hide-changes", "agent"].includes(c.id))
        .map((c) => [c.id, c.enabled]),
    );
  assert.deepEqual(ofAreas({ surface: null, single: false }), {
    views: true,
    changes: true,
    details: true,
    "hide-changes": false,
    agent: false,
  });
  assert.deepEqual(ofAreas({ surface: "changes", single: false }), {
    views: true,
    changes: true,
    details: true,
    "hide-changes": true,
    agent: false,
  });
  assert.deepEqual(ofAreas({ surface: "changes", single: true }), {
    views: false,
    changes: true,
    details: true,
    "hide-changes": false,
    agent: true,
  });
  // A removed checkout closes Changes, but Details still describes the session, so one area at
  // a time Agent always has a tab beside it.
  const removed = { ...base, session: session("/work/repo.feature", { checkoutMissing: true }) };
  assert.deepEqual(ofAreas({ surface: null, single: true }, removed), {
    views: false,
    changes: false,
    details: true,
    "hide-changes": false,
    agent: true,
  });
  assert.equal(ofAreas({ surface: null, single: false }, removed).agent, false, "side by side");
});
