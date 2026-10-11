/**
 * One browser client. Decodes ClientMessages from the socket, dispatches them and
 * delivers ServerMessages. SessionViewer keeps the client's selection and attachment;
 * domain steps live in WorkspaceCommands.
 */
import { Cause, Effect, Stream } from "effect";
import { Socket } from "effect/socket";
import {
  type ClientMessage,
  decodeClientMessage,
  encodeServerMessage,
  type ServerMessage,
} from "../shared/wire.ts";
import { makeSocketDelivery } from "./BoundedDelivery.ts";
import { DirectoryFacts } from "./DirectoryFacts.ts";
import { projectDisplay } from "./DisplayProjection.ts";
import { Registry } from "./Registry.ts";
import { SessionHosts } from "./SessionHosts.ts";
import { makeSessionViewer } from "./SessionViewer.ts";
import { SidebarView } from "./SidebarView.ts";
import { WorkspaceCommands } from "./WorkspaceCommands.ts";

const describe = (e: unknown): string => {
  if (e && typeof e === "object") {
    const o = e as { detail?: string; message?: string; _tag?: string };
    return o.detail ?? o.message ?? o._tag ?? String(e);
  }
  return String(e);
};

export const handleSocket = (socket: Socket.Socket) =>
  Effect.gen(function* () {
    const hosts = yield* SessionHosts;
    const facts = yield* DirectoryFacts;
    const sidebar = yield* SidebarView;
    const registry = yield* Registry;
    const commands = yield* WorkspaceCommands;
    const reader = yield* socket.reader;
    const writer = yield* socket.writer;

    // Bound both host queues and the transport; the window and close codes live in BoundedDelivery.
    const delivery = yield* makeSocketDelivery((text: string) => writer.write(text), (m: ServerMessage, id) => encodeServerMessage(projectDisplay(m), id));
    const disconnect = (reason: string, code = 1013) => delivery.close(reason, code);
    const send = delivery.offer;
    const sendError = (e: unknown, selectionId?: string) =>
      Effect.logWarning(`client error: ${describe(e)}`).pipe(Effect.andThen(send({ _tag: "error", message: describe(e), selectionId })));

    const viewer = yield* makeSessionViewer({ deliver: send, overflow: error => disconnect(error.detail, error.oversized ? 1009 : 1013) });

    const handle = (msg: ClientMessage) =>
      Effect.gen(function* () {
        switch (msg._tag) {
          case "registry":
            return yield* sidebar.refresh;
          case "worktrees":
            return yield* send({ _tag: "worktrees", folder: msg.folder, discovery: yield* commands.discoverWorktrees(msg.folder) });
          case "models":
            return yield* send({ _tag: "models", catalog: yield* facts.catalog(msg.cwd, { refresh: msg.refresh }) });
          // Registry writes reach every client's sidebar on their own.
          case "save_project":
            return yield* registry.saveProject(msg.project);
          case "archive_project":
            return yield* registry.archiveProject(msg.id, msg.archived);
          case "assign_project":
            return yield* registry.assignProject(msg.cwd, msg.sessionId, msg.projectId);
          case "add_folder":
            return yield* registry.addFolder(msg.path);
          case "remove_folder":
            return yield* registry.removeFolder(msg.path);
          case "trust":
            return yield* send({ _tag: "trust", ...yield* facts.trust(msg.cwd) });
          case "set_trust":
            // Every client hears `catalogs_invalidated`; the requesting one also gets its answers at once.
            return yield* commands.setTrust(msg.path, msg.trusted).pipe(
              Effect.flatMap(({ cwd, trust, catalog, notice }) => Effect.gen(function* () {
                yield* send({ _tag: "toast", level: "success", message: notice });
                yield* send({ _tag: "trust", cwd, trust });
                yield* send({ _tag: "models", catalog });
              })),
              Effect.catchTag("ProjectTrustError", e => sendError(e.detail)));
          case "create_worktree":
          case "add_worktree": {
            yield* (msg._tag === "create_worktree"
              ? commands.createWorktree(msg.folder, msg.branch, { hooks: msg.hooks })
              : commands.addWorktree(msg.folder, msg.path)
            ).pipe(
              Effect.flatMap(result => send({ _tag: "worktree_result", requestId: msg.requestId, result })),
              Effect.catchTag("WorktreeError", e => send({ _tag: "worktree_result", requestId: msg.requestId, result: { status: "error", detail: e.detail } })));
            // Failure may have left a checkout behind. Rediscover rather than retrying a mutation.
            return yield* sidebar.refresh;
          }
          case "ping":
            return yield* send({ _tag: "pong", nonce: msg.nonce });
          case "ack":
            return yield* delivery.ack(msg.deliveryId);
          case "select":
          case "create_session":
            return; // Claimed and started in receive order by the read loop.
          case "act": {
            // A start reaches browsers as a `hosts` update.
            const { session } = yield* viewer.act(msg.selectionId, msg.start);
            const result = yield* commands.act(session, msg.action);
            if (result) yield* send({ _tag: "action_result", cwd: session.spec.cwd, sessionId: session.spec.sessionId, result });
            return;
          }
          case "rename_session":
            return yield* commands.renameSession(msg.cwd, msg.sessionId, msg.title);
          case "archive_session":
          case "delete_session": {
            const mode = msg._tag === "delete_session" ? "delete" : "archive";
            yield* viewer.forget(msg.cwd, msg.sessionId, commands.retireSession(msg.cwd, msg.sessionId, mode));
            if (mode === "delete") yield* send({ _tag: "toast", message: "Session deleted", level: "success" });
            return;
          }
        }
      });

    // ── initial state and global updates ──
    // Worktree discovery can take seconds in a large repository. Show the last observation at
    // once and let a fresh one follow, so it never holds up the page or this socket's requests.
    const updates = yield* sidebar.subscribe;
    yield* send({ _tag: "hosts", hosts: yield* hosts.list });
    yield* updates.pipe(Stream.runForEach(send), Effect.ignore, Effect.forkScoped);
    yield* facts.changes.pipe(Stream.runForEach(() => send({ _tag: "catalogs_invalidated" })), Effect.ignore, Effect.forkScoped);
    yield* sidebar.refresh;
    yield* hosts.changes.pipe(
      Stream.runForEach((list) => send({ _tag: "hosts", hosts: list })),
      Effect.ignore,
      Effect.forkScoped,
    );

    // ── read loop ──
    const decoder = new TextDecoder();
    yield* Effect.gen(function* () {
      const chunks = yield* reader.pull;
      for (const chunk of chunks) {
        const text = typeof chunk === "string" ? chunk : decoder.decode(chunk);
        let msg: ClientMessage;
        try {
          msg = decodeClientMessage(text);
        } catch (e) {
          yield* sendError(e);
          continue;
        }
        // Each message runs in its own fiber: a prompt that opens an extension dialog only
        // gets its response after the dialog is answered, so handling must not serialize.
        const selectionId = "selectionId" in msg ? msg.selectionId : undefined;
        const fork = <A, E, R>(work: Effect.Effect<A, E, R>) => work.pipe(
          Effect.catchCause((cause) => (Cause.hasInterruptsOnly(cause) ? Effect.void : sendError(Cause.squash(cause), selectionId))),
          Effect.forkScoped,
        );
        // Claim selection in receive order, before any asynchronous lookup can finish.
        if (msg._tag === "select") yield* fork(yield* viewer.select(msg));
        else if (msg._tag === "create_session") yield* fork(commands.createSession(
          { cwd: msg.cwd, projectId: msg.projectId, options: msg.options, text: msg.text, attachments: msg.attachments },
          { attach: yield* viewer.create(msg) },
        ));
        else yield* fork(handle(msg));
      }
    }).pipe(Effect.forever, Effect.catchCause(() => Effect.void), Effect.raceFirst(
      delivery.closed.pipe(Effect.flatMap(({ reason, code }) => writer.write(new Socket.CloseEvent(code, reason)).pipe(Effect.ignore))),
    ));
  }).pipe(Effect.scoped);
