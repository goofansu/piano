/**
 * One browser client's requests and the server-wide updates it hears, without the socket.
 * Session requests go to the client's ClientSessions; the rest run their SessionHosts,
 * WorkspaceCommands, Registry or DirectoryFacts step here and answer through the client's
 * output. A request that capacity refuses or that fails gets the one reply its sender awaits
 * (`unansweredReply`); it never ends the connection.
 */
import { Cause, Effect, Stream } from "effect";
import type { ClientMessage, ServerMessage } from "../shared/wire.ts";
import { type ClientOutput, makeClientSessions } from "./ClientSessions.ts";
import { DirectoryFacts } from "./DirectoryFacts.ts";
import { errorText } from "./ErrorText.ts";
import { inboundLimits, makeInboundCapacity } from "./InboundCapacity.ts";
import { sessionActionPolicy } from "./PiSessions.ts";
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

/** Why a request ends without its ordinary answer: refused unstarted at admission, or failed. */
type Unanswered =
  | { readonly _tag: "refused" }
  | { readonly _tag: "failed"; readonly error: unknown };

const unansweredText = (reason: Unanswered) =>
  reason._tag === "refused"
    ? "Client input capacity is full. Request was not started; wait for pending work before trying again."
    : errorText(reason.error);

/**
 * The reply the sender of `request` awaits when it ends without its ordinary answer, correlated
 * the way the browser settles that request: by selection, worktree request ID or folder. Requests
 * nothing waits on get the ordinary error, with their selection when they have one.
 */
const unansweredReply = (request: ClientRequest, reason: Unanswered): ServerMessage => {
  const message = unansweredText(reason);
  switch (request._tag) {
    case "select":
      return reason._tag === "refused"
        ? { _tag: "selection_rejected", selectionId: request.selectionId, message }
        : { _tag: "selection_failed", selectionId: request.selectionId, message };
    case "create_session":
      // Creation may already have submitted its first message; a failure keeps that uncertain.
      return reason._tag === "refused"
        ? { _tag: "selection_rejected", selectionId: request.selectionId, message }
        : { _tag: "error", message, selectionId: request.selectionId };
    case "create_worktree":
    case "add_worktree":
      return {
        _tag: "worktree_result",
        requestId: request.requestId,
        result: {
          status: "error",
          detail: message,
          // A refused request never started. WorkspaceCommands answers the command's own
          // failures, so any other is unexpected and may have run Worktrunk.
          unconfirmed: reason._tag === "failed",
        },
      };
    case "worktrees":
      return {
        _tag: "worktrees",
        folder: request.folder,
        discovery: { status: "error", observedAt: new Date().toISOString(), detail: message },
      };
    default:
      return {
        _tag: "error",
        message,
        selectionId: "selectionId" in request ? request.selectionId : undefined,
      };
  }
};

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

  const settle = Effect.fn("ClientDispatch.settle")(function* (
    request: ClientRequest,
    reason: Unanswered,
  ) {
    yield* Effect.logWarning(`${request._tag} ${reason._tag}: ${unansweredText(reason)}`);
    yield* send(unansweredReply(request, reason));
  });

  /** Runs a request's work; any failure but interruption settles the request instead. */
  const answered =
    (request: ClientRequest) =>
    <A, E>(work: Effect.Effect<A, E>): Effect.Effect<void> =>
      work.pipe(
        Effect.asVoid,
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.void
            : settle(request, { _tag: "failed", error: Cause.squash(cause) }),
        ),
      );

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
        // The command answers every outcome, failures included, and has the sidebar rediscover.
        case "create_worktree":
          return yield* send({
            _tag: "worktree_result",
            requestId: request.requestId,
            result: yield* commands.createWorktree(request.folder, request.branch, {
              hooks: request.hooks,
            }),
          });
        case "add_worktree":
          return yield* send({
            _tag: "worktree_result",
            requestId: request.requestId,
            result: yield* commands.addWorktree(request.folder, request.path),
          });
        case "ping":
          return yield* send({ _tag: "pong", nonce: request.nonce });
        case "rename_session":
          return yield* hosts.rename(request.cwd, request.sessionId, request.title);
        case "pin_session":
          return yield* registry.pinSession(request.cwd, request.sessionId, request.pinned);
        case "archive_session":
          return yield* sessions.retire(request.cwd, request.sessionId, "archive");
        case "delete_session":
          return yield* sessions.retire(request.cwd, request.sessionId, "delete");
      }
    });

  const capacity = makeInboundCapacity(inboundLimits.client);
  const receive = Effect.fn("ClientDispatch.receive")(function* (request: ClientRequest) {
    // Heartbeats are immediate transport liveness, not Pi work. Rejecting one
    // during saturation makes a healthy browser reconnect and abandon controls.
    if (request._tag === "ping") {
      yield* answered(request)(handle(request));
      return Effect.void;
    }
    const priority = request._tag === "act" && sessionActionPolicy[request.action._tag].priority;
    const release = capacity.acquire(Buffer.byteLength(JSON.stringify(request)), priority);
    if (!release) {
      // Reject before claiming a selection or mutating anything. The receive loop
      // remains available for acknowledgements, dialog answers and cancellation.
      yield* settle(request, { _tag: "refused" });
      return Effect.void;
    }
    // Selection and creation claim their selection here, in receive order; the work runs later.
    const work: Effect.Effect<unknown, unknown> =
      request._tag === "select"
        ? yield* sessions.select(request)
        : request._tag === "create_session"
          ? yield* sessions.create(request)
          : request._tag === "act"
            ? sessions.act(request.selectionId, request.action, request.start)
            : handle(request);
    return work.pipe(answered(request), Effect.ensuring(Effect.sync(release)));
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
