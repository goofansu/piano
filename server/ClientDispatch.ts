/**
 * One browser client's requests and the server-wide updates it hears, without the socket.
 * Session requests go to the client's ClientSessions; the rest run their WorkspaceCommands,
 * Registry or DirectoryFacts step here and answer through the client's output. A request's
 * failure reaches that client as an `error` message; it never ends the connection.
 */
import { Cause, Effect, Stream } from "effect";
import type { ClientMessage } from "../shared/wire.ts";
import { type ClientOutput, makeClientSessions } from "./ClientSessions.ts";
import { DirectoryFacts } from "./DirectoryFacts.ts";
import { errorText } from "./ErrorText.ts";
import { inboundLimits, makeInboundCapacity } from "./InboundCapacity.ts";
import { Registry } from "./Registry.ts";
import { SessionHosts } from "./SessionHosts.ts";
import { SidebarView } from "./SidebarView.ts";
import { WorkspaceCommands } from "./WorkspaceCommands.ts";

/** Every client message except delivery acknowledgements, which belong to the transport. */
export type ClientRequest = Exclude<ClientMessage, { _tag: "ack" }>;

export interface ClientDispatch {
  /**
   * Claims a selection at once when the request makes one, so selections take effect in receive
   * order. The returned effect does the work and delivers its answers or its failure; it never
   * fails, and may wait on Pi (a prompt that opens a dialog), so run each in its own fiber.
   */
  readonly receive: (request: ClientRequest) => Effect.Effect<Effect.Effect<void>>;
  /** Tells the client about a failure that has no request to answer, such as an undecodable message. */
  readonly report: (error: unknown, selectionId?: string) => Effect.Effect<void>;
}

/** Sends the current hosts and sidebar, then forwards updates until the surrounding scope closes. */
export const makeClientDispatch = Effect.fn("ClientDispatch.make")(function* (
  output: ClientOutput,
) {
  const hosts = yield* SessionHosts;
  const facts = yield* DirectoryFacts;
  const sidebar = yield* SidebarView;
  const registry = yield* Registry;
  const commands = yield* WorkspaceCommands;
  const sessions = yield* makeClientSessions(output);
  const { send } = output;

  const report = (error: unknown, selectionId?: string) => {
    const message = errorText(error);
    return Effect.logWarning(`client error: ${message}`).pipe(
      Effect.andThen(send({ _tag: "error", message, selectionId })),
    );
  };

  const handle = (request: Exclude<ClientRequest, { _tag: "select" | "create_session" | "act" }>) =>
    Effect.gen(function* () {
      switch (request._tag) {
        case "registry":
          return yield* sidebar.refresh;
        case "worktrees":
          return yield* send({
            _tag: "worktrees",
            folder: request.folder,
            discovery: yield* commands.discoverWorktrees(request.folder),
          });
        case "models":
          return yield* send({
            _tag: "models",
            catalog: yield* facts.catalog(request.cwd, { refresh: request.refresh }),
          });
        // Registry writes reach every client's sidebar on their own.
        case "save_project":
          return yield* registry.saveProject(request.project, request.assign);
        case "archive_project":
          return yield* registry.archiveProject(request.id, request.archived);
        case "assign_project":
          return yield* registry.assignProject(request.cwd, request.sessionId, request.projectId);
        case "add_folder":
          return yield* registry.addFolder(request.path);
        case "remove_folder":
          return yield* registry.removeFolder(request.path);
        case "trust":
          return yield* send({ _tag: "trust", ...(yield* facts.trust(request.cwd)) });
        case "set_trust": {
          // Every client hears `catalogs_invalidated`; the requesting one also gets its answers at once.
          const { cwd, trust, catalog, notice } = yield* commands.setTrust(
            request.path,
            request.trusted,
          );
          yield* send({ _tag: "toast", level: "success", message: notice });
          yield* send({ _tag: "trust", cwd, trust });
          return yield* send({ _tag: "models", catalog });
        }
        case "create_worktree":
        case "add_worktree": {
          const result = yield* (
            request._tag === "create_worktree"
              ? commands.createWorktree(request.folder, request.branch, { hooks: request.hooks })
              : commands.addWorktree(request.folder, request.path)
          ).pipe(
            Effect.catchTag("WorktreeError", (e) =>
              Effect.succeed({ status: "error" as const, detail: e.detail }),
            ),
          );
          yield* send({ _tag: "worktree_result", requestId: request.requestId, result });
          // Failure may have left a checkout behind. Rediscover rather than retrying a mutation.
          return yield* sidebar.refresh;
        }
        case "ping":
          return yield* send({ _tag: "pong", nonce: request.nonce });
        case "rename_session":
          return yield* commands.renameSession(request.cwd, request.sessionId, request.title);
        case "pin_session":
          return yield* registry.pinSession(request.cwd, request.sessionId, request.pinned);
        case "archive_session":
          return yield* sessions.retire(request.cwd, request.sessionId, "archive");
        case "delete_session":
          return yield* sessions.retire(request.cwd, request.sessionId, "delete");
      }
    });

  const answered = <A, E>(work: Effect.Effect<A, E>, selectionId?: string): Effect.Effect<void> =>
    work.pipe(
      Effect.asVoid,
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause) ? Effect.void : report(Cause.squash(cause), selectionId),
      ),
    );

  const capacity = makeInboundCapacity(inboundLimits.client);
  const receive = Effect.fn("ClientDispatch.receive")(function* (request: ClientRequest) {
    // Heartbeats are immediate transport liveness, not Pi work. Rejecting one
    // during saturation makes a healthy browser reconnect and abandon controls.
    if (request._tag === "ping") {
      yield* answered(handle(request));
      return Effect.void;
    }
    const priority =
      request._tag === "act" &&
      ["answer", "abort", "stop", "restore_queue"].includes(request.action._tag);
    const release = capacity.acquire(Buffer.byteLength(JSON.stringify(request)), priority);
    if (!release) {
      // Reject before claiming a selection or mutating anything. The receive loop
      // remains available for acknowledgements, dialog answers and cancellation.
      const message =
        "Client input capacity is full. Request was not started; wait for pending work before trying again.";
      if (request._tag === "select" || request._tag === "create_session")
        yield* send({ _tag: "selection_rejected", selectionId: request.selectionId, message });
      else yield* report(message, "selectionId" in request ? request.selectionId : undefined);
      return Effect.void;
    }
    const work = yield* Effect.gen(function* () {
      switch (request._tag) {
        case "select":
          return answered(yield* sessions.select(request), request.selectionId);
        case "create_session":
          return answered(yield* sessions.create(request), request.selectionId);
        case "act":
          return answered(
            sessions.act(request.selectionId, request.action, request.start),
            request.selectionId,
          );
        default:
          return answered(handle(request));
      }
    });
    return work.pipe(Effect.ensuring(Effect.sync(release)));
  }, Effect.uninterruptible);

  // ── initial state and global updates ──
  // Worktree discovery can take seconds in a large repository. Show the last observation at
  // once and let a fresh one follow, so it never holds up the page or this client's requests.
  const updates = yield* sidebar.subscribe;
  yield* send({ _tag: "hosts", hosts: yield* hosts.list });
  yield* updates.pipe(Stream.runForEach(send), Effect.ignore, Effect.forkScoped);
  yield* facts.changes.pipe(
    Stream.runForEach(() => send({ _tag: "catalogs_invalidated" })),
    Effect.ignore,
    Effect.forkScoped,
  );
  yield* sidebar.refresh;
  yield* hosts.changes.pipe(
    Stream.runForEach((list) => send({ _tag: "hosts", hosts: list })),
    Effect.ignore,
    Effect.forkScoped,
  );

  return { receive, report } satisfies ClientDispatch as ClientDispatch;
});
