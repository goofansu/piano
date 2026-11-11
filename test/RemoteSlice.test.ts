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
import { isLocalId, type Machine } from "../shared/machine.ts";
import type { Attachment, ClientMessage, Dialog, ModelCatalog } from "../shared/wire.ts";
import { createClient } from "../web/src/lib/client.ts";
import { answerForm } from "../web/src/lib/commandForms.ts";
import {
  messageCommand,
  newSessionCommand,
  RESTORE_QUEUE,
  STOP,
} from "../web/src/lib/composerControl.ts";
import { trustCommand } from "../web/src/lib/globalCommands.ts";
import { LOCAL } from "../web/src/lib/machine.ts";
import { machineOffers } from "../web/src/lib/machineOffers.ts";
import { draftMessage, EMPTY_DRAFT } from "../web/src/lib/messageDraft.ts";
import { emptyChoice, type ModelTarget, modelChoice } from "../web/src/lib/modelChoice.ts";
import { createDialogAnswer } from "../web/src/lib/piDialogs.ts";
import {
  assignProjectCommand,
  newProjectCommand,
  projectCommands,
} from "../web/src/lib/projectCommands.ts";
import { preparedImageCommand } from "../web/src/lib/remoteImages.ts";
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
const image: Attachment = {
  kind: "image",
  name: "a.png",
  mimeType: "image/png",
  data: "iVBORw0KGgo=",
};
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
function browserSends(machine: Machine): ClientMessage[] {
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
  let preparations = 0;
  const send: typeof client.send = (command) => {
    const input =
      command._tag === "act"
        ? command.action
        : command._tag === "create_session"
          ? command
          : undefined;
    // HTTP preparation has its own boundary tests. Model its successful reference here, then
    // use the same post-preparation builder as useImageSend, not an inline remote upload.
    if (!isLocalId(machine.id) && input && "attachments" in input && input.attachments?.length)
      return client.send(preparedImageCommand(command, { id: `prepared-${++preparations}` }));
    return client.send(command);
  };
  // A message as the composer drafts it, with an image: every machine offers the attach button.
  const message = draftMessage({
    ...EMPTY_DRAFT,
    text: "Reply with exactly: X",
    images: { ...EMPTY_DRAFT.images, items: [image] },
  });

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
  for (const start of [hosted.start, picked.start]) {
    send(messageCommand("steering", message, start, "input-1"));
    send(messageCommand("follow-up", message, start, "input-2"));
  }
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
  send(
    newSessionCommand(
      { cwd: CWD, projectId: project.id },
      message,
      modelChoice(emptyChoice(fresh), catalog, fresh).start,
    ),
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

test("every message the browser builds for a remote is one the remote admits", () => {
  const sent = browserSends({ id: "eng-1", name: "Eng" });
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

test("what Local adds to the same journey, the remote refuses", () => {
  const refused = verdicts(browserSends(LOCAL))
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
