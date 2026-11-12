/**
 * ADR 0004 declares the remote slice on both sides of the wire: the remote's `peerVerdict` admits
 * or refuses each request, and this browser's `machineOffers` hides what would send anything else.
 * This holds the two together: every message the browser builds for a remote machine, through the
 * real client and builders, is one the remote admits; what Local would add is one it refuses.
 * Otherwise a remote user meets "Not available from another machine" in the middle of their work.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Selection } from "../server/ClientSessions.ts";
import { peerVerdict } from "../server/PeerScope.ts";
import type { RegistryData } from "../server/Registry.ts";
import type { Machine } from "../shared/machine.ts";
import type {
  ClientCommand,
  ClientMessage,
  Dialog,
  ModelCatalog,
  StartOptions,
} from "../shared/wire.ts";
import { createClient } from "../web/src/lib/client.ts";
import { answerForm } from "../web/src/lib/commandForms.ts";
import {
  messageCommand,
  newSessionCommand,
  RESTORE_QUEUE,
  STOP,
} from "../web/src/lib/composerControl.ts";
import { trustCommand } from "../web/src/lib/globalCommands.ts";
import { createImageSender } from "../web/src/lib/imageSender.ts";
import { LOCAL } from "../web/src/lib/machine.ts";
import { machineOffers } from "../web/src/lib/machineOffers.ts";
import {
  createDrafts,
  type DraftMessage,
  NEW_SESSION_DRAFT,
  sessionDraftKey,
} from "../web/src/lib/messageDraft.ts";
import { emptyChoice, type ModelTarget, modelChoice } from "../web/src/lib/modelChoice.ts";
import { createDialogAnswer } from "../web/src/lib/piDialogs.ts";
import {
  assignProjectCommand,
  newProjectCommand,
  projectCommands,
} from "../web/src/lib/projectCommands.ts";
import { sessionCommands } from "../web/src/lib/sessionCommands.ts";
import type { ConnectionHandlers } from "../web/src/lib/ws.ts";
import { initialState } from "../web/src/store.ts";

const CWD = "/repo";
const SESSION = "s1";
const registry: RegistryData = {
  version: 2,
  projects: [],
  workspaces: [{ id: "ws1", folder: CWD, path: CWD }],
  folders: [CWD],
  worktrees: [],
  sessions: [
    {
      cwd: CWD,
      sessionId: SESSION,
      createdAt: "2026-10-01T00:00:00Z",
      updatedAt: "2026-10-01T00:00:00Z",
      archived: false,
    },
  ],
};
const catalog: ModelCatalog = {
  cwd: CWD,
  fetchedAt: "t1",
  defaultModel: "a/deep",
  defaultThinkingLevel: "high",
  models: [
    {
      ref: "a/deep",
      provider: "a",
      id: "deep",
      reasoning: true,
      contextWindow: 200000,
      thinkingLevels: ["off", "low", "high"],
    },
    {
      ref: "a/quick",
      provider: "a",
      id: "quick",
      reasoning: false,
      contextWindow: 200000,
      thinkingLevels: ["off"],
    },
  ],
};
const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);
const question: Dialog = {
  id: "q1",
  generation: "g1",
  method: "input",
  receivedAt: 0,
  deadlineAt: null,
  deadlineKind: "tool-end",
  toolCallId: "call-1",
};

/** Everything the browser sends while a person works on `machine`, as sent. */
async function browserSends(machine: Machine): Promise<ClientMessage[]> {
  const offers = machineOffers(machine);
  const sent: ClientMessage[] = [];
  let handlers: ConnectionHandlers | undefined;
  let ids = 0;
  const client = createClient({
    initial: initialState,
    connect: (h) => {
      handlers = h;
      return {
        send: (m) => {
          sent.push(m);
          return "sent";
        },
        close: () => {},
      };
    },
    notify: () => {},
    newSelectionId: () => `sel${++ids}`,
    lastDirectory: { read: () => CWD, write: () => {} },
  });
  client.start();
  handlers!.onStatus(true);
  const send = client.send;
  // The composers' send, through the real image sender: on a remote it prepares the images (HTTP
  // preparation has its own boundary tests, so this models its successful reference) and sends the
  // reference instead of the bytes.
  let preparations = 0;
  const sender = createImageSender({
    prepare: async () => ({ id: `prepared-${++preparations}` }),
    discard: () => {},
  });
  const drafts = createDrafts();
  const compose = async (
    target: { cwd: string; sessionId?: string },
    start: StartOptions,
    command: (message: DraftMessage, inputId: string, start: StartOptions) => ClientCommand,
  ) => {
    // A message as the composer drafts it, with an image: every machine offers the attach button.
    const key = target.sessionId
      ? sessionDraftKey({ cwd: target.cwd, sessionId: target.sessionId })
      : NEW_SESSION_DRAFT;
    drafts.setText(key, "Reply with exactly: X");
    await drafts.addImages(key, [new File([png], "a.png", { type: "image/png" })], async () =>
      Buffer.from(png).toString("base64"),
    );
    await sender.send(
      {
        machineId: machine.id,
        target,
        editor: {
          attachments: drafts.get(key).images,
          preparing: drafts.get(key).preparing,
          submit: (deliver) => drafts.submit(key, deliver),
          prepareSubmit: (deliver) => drafts.prepareSubmit(key, deliver),
        },
        captureSend: client.captureSend,
        choice: { start, consume: () => {} },
      },
      command,
    );
  };

  // Open a listed session; the remote answers, so actions have an attachment.
  client.select(CWD, SESSION);
  const selectionId = client.getState().selectionId!;
  handlers!.onMessage({
    _tag: "selected",
    cwd: CWD,
    sessionId: SESSION,
    selectionId,
    hosted: true,
    cursor: { cwd: CWD, sessionId: SESSION, generation: "g1", sequence: 1 },
    snapshot: { state: { sessionId: SESSION, isStreaming: true }, messages: [], dialogs: [] },
  });

  // The composer: send, steer or follow up with the picker's start options, Stop and Edit.
  const target: ModelTarget = {
    kind: "session",
    cwd: CWD,
    sessionId: SESSION,
    hosted: true,
    model: "a/deep",
  };
  const hosted = modelChoice(emptyChoice(target), catalog, target);
  const picked = modelChoice(
    { scope: emptyChoice(target).scope, pick: { model: "a/quick" } },
    catalog,
    target,
  );
  for (const start of [hosted.start, picked.start])
    for (const kind of ["steering", "follow-up"] as const)
      await compose({ cwd: CWD, sessionId: SESSION }, start, (message, inputId, start) =>
        messageCommand(kind, message, start, inputId),
      );
  send(STOP);
  send(RESTORE_QUEUE);
  // The model picker on a running session.
  for (const change of [
    hosted.chooseModel("a/quick"),
    hosted.chooseEffort("low"),
    ...hosted.chooseDefaults(),
  ])
    if (change.kind === "act") send({ _tag: "act", action: change.action });
  // A question's answer, cancel and abort.
  for (const reply of [
    (a: ReturnType<typeof createDialogAnswer>) => a.answer({ value: "yes" }, 0, selectionId),
    (a: ReturnType<typeof createDialogAnswer>) => a.cancel(0, selectionId),
    (a: ReturnType<typeof createDialogAnswer>) => a.abort(0, selectionId),
  ])
    reply(createDialogAnswer({ dialog: question, send }));

  // A trust decision for the registered directory.
  handlers!.onMessage({ _tag: "trust", cwd: CWD, trust: { required: true, trusted: false } });
  const trust = trustCommand(client.getState(), CWD);
  if (trust && offers.command(trust) && trust.intent.kind === "send") send(trust.intent.command);

  // A project's menu, the session's place in one, and the New project dialog filing the session
  // in the project it creates: each only where the command runs.
  const listed = { cwd: CWD, sessionId: SESSION };
  const project = { id: "p1", name: "Launch" };
  const state = client.getState();
  const creation = newProjectCommand(state, { assign: listed });
  for (const command of [
    ...projectCommands(state, project),
    assignProjectCommand(state, listed, project.id),
    assignProjectCommand(state, listed, null),
    creation,
  ]) {
    if (!offers.command(command)) continue;
    if (command.intent.kind === "send") send(command.intent.command);
    if (command.intent.kind === "project-dialog") {
      const answer = answerForm(
        state,
        { kind: "project", dialog: command.intent.dialog },
        { name: "Next", instructions: "" },
      );
      if (answer.allowed && answer.command) send(answer.command);
    }
  }

  // A session's menu: Pin sends itself; Rename and Delete leave through their dialogs' answers,
  // Archive directly when nothing is running. Each only where the command runs.
  for (const command of sessionCommands(state, { ...listed, title: "Session" })) {
    if (!offers.command(command)) continue;
    const { intent } = command;
    if (intent.kind === "send") send(intent.command);
    if (intent.kind === "archive" && intent.target)
      send({ _tag: "archive_session", cwd: intent.target.cwd, sessionId: intent.target.sessionId });
    if ((intent.kind === "rename" || intent.kind === "delete") && intent.target) {
      const answer = answerForm(
        state,
        { kind: `${intent.kind}-session`, target: intent.target },
        "Renamed",
      );
      if (answer.allowed && answer.command) send(answer.command);
    }
  }

  // The New page's first message, joining the page's project (NewSessionComposer), with the
  // picker's start options for the directory.
  const fresh: ModelTarget = { kind: "new", cwd: CWD };
  await compose(
    { cwd: CWD },
    modelChoice(emptyChoice(fresh), catalog, fresh).start,
    (m, attemptId, start) => ({
      ...newSessionCommand({ cwd: CWD, projectId: project.id }, m, start),
      attemptId,
    }),
  );
  return sent;
}

/** Each message's verdict, tracking the selection as the peer connection does. */
function verdicts(sent: readonly ClientMessage[]) {
  let selection: Selection | null = null;
  return sent.flatMap((m) => {
    if (m._tag === "ack") return [];
    const verdict = peerVerdict(registry, m, selection);
    if (verdict === "admit" && (m._tag === "select" || m._tag === "create_session"))
      selection = {
        selectionId: m.selectionId,
        cwd: m.cwd,
        sessionId: m._tag === "select" ? m.sessionId : null,
      };
    return [{ message: m, verdict }];
  });
}

const kinds = (sent: readonly ClientMessage[]) =>
  sent.map((m) => (m._tag === "act" ? `act:${m.action._tag}` : m._tag));

test("every message the browser builds for a remote is one the remote admits", async () => {
  const sent = await browserSends({ id: "eng-1", name: "Eng" });
  const inputs = sent.filter(
    (m) =>
      m._tag === "create_session" ||
      (m._tag === "act" && (m.action._tag === "prompt" || m.action._tag === "steer")),
  );
  assert.equal(inputs.length, 5);
  for (const input of inputs) {
    assert.ok(
      "preparedImages" in input && input.preparedImages,
      "remote image input carries its preparation reference",
    );
    const message = input._tag === "act" ? input.action : input;
    assert.ok(
      !("attachments" in message) || message.attachments === undefined,
      "remote image input carries no inline bytes",
    );
  }
  // The journey reached every builder, so admitting all of it covers each one.
  for (const kind of [
    "select",
    "act:steer",
    "act:prompt",
    "act:stop",
    "act:restore_queue",
    "act:set_model",
    "act:set_thinking_level",
    "act:answer",
    "act:abort",
    "set_project_done",
    "assign_project",
    "save_project",
    "set_trust",
    "pin_session",
    "rename_session",
    "archive_session",
    "delete_session",
    "create_session",
  ])
    assert.ok(kinds(sent).includes(kind), `the journey sends ${kind}`);
  for (const { message, verdict } of verdicts(sent))
    assert.equal(verdict, "admit", JSON.stringify(message));
});

test("what Local adds to the same journey, the remote refuses", async () => {
  const refused = verdicts(await browserSends(LOCAL))
    .filter(({ verdict }) => verdict === "refuse")
    .map(({ message }) => message);
  const prompts = refused.filter(
    (m) => m._tag === "act" && (m.action._tag === "prompt" || m.action._tag === "steer"),
  );
  assert.equal(prompts.length, 4, "every message with an attached image");
  const create = refused.find((m) => m._tag === "create_session");
  assert.ok(create, "a first message with an attached image");
  for (const m of refused) assert.notEqual(m._tag, "select", "opening a session is the slice");
});

test("on a remote, every enabled New session here opens a New page where the remote starts it", () => {
  // A pinned session in a closed folder stays listed, though the remote starts nothing there.
  const CLOSED = "/closed";
  const withClosed: RegistryData = {
    ...registry,
    workspaces: [...registry.workspaces, { id: "ws2", folder: CLOSED, path: CLOSED }],
    sessions: [
      ...registry.sessions,
      { ...registry.sessions[0]!, cwd: CLOSED, sessionId: "s2", pinned: true },
    ],
  };
  const machine = { id: "eng-1", name: "Eng" };
  const offers = machineOffers(machine);
  let handlers: ConnectionHandlers | undefined;
  let ids = 0;
  const client = createClient({
    initial: initialState,
    connect: (h) => {
      handlers = h;
      return { send: () => "sent", close: () => {} };
    },
    notify: () => {},
    newSelectionId: () => `sel${++ids}`,
    startsSessionIn: offers.startsSessionIn,
  });
  client.start();
  handlers!.onStatus(true);
  const workspace = withClosed.workspaces[0]!;
  handlers!.onMessage({
    _tag: "registry",
    folders: [
      {
        path: CWD,
        name: "repo",
        worktrees: [
          {
            workspace,
            trust: { required: false, trusted: false },
            branch: "main",
            path: CWD,
            root: true,
            status: "current",
          },
        ],
        discovery: { status: "ready", observedAt: "", currentPath: CWD, worktrees: [] },
      },
    ],
    workspaces: withClosed.workspaces,
    sessionReferences: withClosed.sessions.map((s) => ({
      ...s,
      workspaceId: withClosed.workspaces.find((w) => w.path === s.cwd)!.id,
      branch: null,
    })),
  });

  const started: string[] = [];
  for (const { cwd, sessionId } of withClosed.sessions) {
    client.select(cwd, sessionId);
    handlers!.onMessage({
      _tag: "selected",
      cwd,
      sessionId,
      selectionId: client.getState().selectionId!,
      hosted: false,
      cursor: { cwd, sessionId, generation: "g1", sequence: 1 },
      snapshot: { state: { sessionId, isStreaming: false }, messages: [], dialogs: [] },
    });
    // As useSessionCommands lists them for this machine.
    const commands = sessionCommands(client.getState(), undefined, {
      startsSessionIn: offers.startsSessionIn,
    }).filter(offers.command);
    for (const command of commands) {
      if (command.intent.kind !== "new-session" || !command.enabled) continue;
      // What running it does (runCommand's openNew), then the remote's verdict on starting there.
      const target = command.intent.cwd;
      client.dispatch({ type: "open", page: { kind: "new", cwd: target } });
      const view = client.getState().view;
      assert.equal(view.kind === "new" && view.cwd, target, "no silent retarget");
      const create: ClientMessage = {
        _tag: "create_session",
        cwd: target,
        selectionId: "sel-new",
        options: {},
        text: "Reply with exactly: X",
      };
      assert.equal(peerVerdict(withClosed, create, null), "admit", target);
      started.push(target);
    }
  }
  assert.deepEqual(
    started,
    [CWD],
    "the open folder's session offers it; the closed one's does not",
  );
});
