/**
 * One browser client's requests and the server-wide updates it hears, without the socket.
 * Session requests go to the client's ClientSessions; the rest run their SessionHosts,
 * WorkspaceCommands, Registry or DirectoryFacts step here and answer through the client's
 * output. Each request kind is described once, in `requests`: how it is admitted, its work, and
 * the one reply its sender awaits when capacity refuses it or it fails. A refused or failed
 * request never ends the connection.
 */
import { Cause, Effect, Stream } from "effect";
import type { ClientMessage, ServerMessage } from "../shared/wire.ts";
import { type ClientOutput, makeClientSessions } from "./ClientSessions.ts";
import { DirectoryFacts } from "./DirectoryFacts.ts";
import { errorText } from "./ErrorText.ts";
import { inboundLimits, makeInboundCapacity } from "./InboundCapacity.ts";
import { sessionActionPolicy } from "./PiSessions.ts";
import { Registry } from "./Registry.ts";
import { SessionHosts, SessionNotCreated } from "./SessionHosts.ts";
import { SessionStatus } from "./SessionStatus.ts";
import { SidebarView } from "./SidebarView.ts";
import { WorkspaceCommands, worktreeFailure } from "./WorkspaceCommands.ts";

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
 * How `receive` admits a request, in arrival order:
 * - `immediate` runs at once without taking capacity;
 * - `ordinary` and `control` take that lane of inbound capacity, or are refused, and run later;
 * - `claim` takes ordinary capacity and claims its selection at once, so selections take effect
 *   in receive order; the work it returns runs later.
 */
type Admission = "immediate" | "ordinary" | "control" | "claim";

type RequestPolicy<R extends ClientRequest> = {
  /**
   * The reply the sender awaits when the request ends without its ordinary answer, correlated
   * the way the browser settles that request: by selection, worktree request ID or folder.
   */
  readonly unanswered: (request: R, reason: Unanswered) => ServerMessage;
} & (
  | {
      readonly admission: Exclude<Admission, "claim"> | ((request: R) => "ordinary" | "control");
      readonly run: (request: R) => Effect.Effect<unknown, unknown>;
    }
  | {
      readonly admission: "claim";
      readonly claim: (request: R) => Effect.Effect<Effect.Effect<unknown, unknown>>;
    }
);

/**
 * Every request kind's admission, work and unanswered reply. Exhaustive by type, so a new
 * ClientMessage variant cannot be received until it is described here.
 */
type RequestPolicies = {
  readonly [K in ClientRequest["_tag"]]: RequestPolicy<Extract<ClientRequest, { _tag: K }>>;
};

/** The unanswered reply of a request nothing waits on: the ordinary error, without a selection. */
const plainError = (_request: unknown, reason: Unanswered): ServerMessage => ({
  _tag: "error",
  message: unansweredText(reason),
  selectionId: undefined,
});

/** A worktree mutation's unanswered result. A refused request never started. */
const worktreeUnanswered = (
  request: { readonly requestId: string },
  reason: Unanswered,
): ServerMessage => ({
  _tag: "worktree_result",
  requestId: request.requestId,
  result:
    reason._tag === "refused"
      ? { status: "error", detail: unansweredText(reason), unconfirmed: false }
      : worktreeFailure(reason.error),
});

/** Sends the current hosts and sidebar, then forwards updates until the surrounding scope closes. */
export const makeClientDispatch = Effect.fn("ClientDispatch.make")(function* (
  output: ClientOutput,
) {
  const hosts = yield* SessionHosts;
  const facts = yield* DirectoryFacts;
  const sidebar = yield* SidebarView;
  const registry = yield* Registry;
  const commands = yield* WorkspaceCommands;
  const status = yield* SessionStatus;
  const sessions = yield* makeClientSessions(output);
  const { send } = output;

  const requests: RequestPolicies = {
    // Heartbeats are immediate transport liveness, not Pi work. Rejecting one
    // during saturation makes a healthy browser reconnect and abandon controls.
    ping: {
      admission: "immediate",
      run: ({ nonce }) => send({ _tag: "pong", nonce }),
      unanswered: plainError,
    },
    select: {
      admission: "claim",
      claim: sessions.select,
      unanswered: ({ selectionId }, reason) =>
        reason._tag === "refused"
          ? { _tag: "selection_rejected", selectionId, message: unansweredText(reason) }
          : { _tag: "selection_failed", selectionId, message: unansweredText(reason) },
    },
    create_session: {
      admission: "claim",
      // A failed worktree creation may still have left a checkout: the sidebar rediscovers.
      claim: (request) =>
        sessions
          .create(request)
          .pipe(
            Effect.map((work) =>
              work.pipe(
                Effect.tapError((e) =>
                  e instanceof SessionNotCreated && e.checkoutUnconfirmed
                    ? sidebar.refresh
                    : Effect.void,
                ),
              ),
            ),
          ),
      // Creation may already have submitted its first message; a failure keeps that uncertain,
      // unless SessionHosts says it failed before any session existed, so nothing was started.
      unanswered: ({ selectionId }, reason) =>
        reason._tag === "refused" ||
        (reason._tag === "failed" && reason.error instanceof SessionNotCreated)
          ? { _tag: "selection_rejected", selectionId, message: unansweredText(reason) }
          : { _tag: "error", message: unansweredText(reason), selectionId },
    },
    // A read: it answers every outcome, an unknown session or project included.
    session_status: {
      admission: "ordinary",
      run: ({ requestId, target }) =>
        status.read(target).pipe(
          Effect.match({
            onSuccess: (sessions) => ({ status: "ready" as const, sessions }),
            onFailure: (e) => ({ status: "error" as const, detail: e.detail }),
          }),
          Effect.flatMap((result) => send({ _tag: "session_status", requestId, result })),
        ),
      unanswered: ({ requestId }, reason) => ({
        _tag: "session_status",
        requestId,
        result: { status: "error", detail: unansweredText(reason) },
      }),
    },
    act: {
      admission: ({ action }) =>
        sessionActionPolicy[action._tag].priority ? "control" : "ordinary",
      run: ({ selectionId, action, start }) => sessions.act(selectionId, action, start),
      unanswered: ({ selectionId }, reason) => ({
        _tag: "error",
        message: unansweredText(reason),
        selectionId,
      }),
    },
    registry: { admission: "ordinary", run: () => sidebar.refresh, unanswered: plainError },
    worktrees: {
      admission: "ordinary",
      run: ({ folder, requestId }) =>
        commands
          .discoverWorktrees(folder)
          .pipe(
            Effect.flatMap((discovery) =>
              send({ _tag: "worktrees", folder, requestId, discovery }),
            ),
          ),
      unanswered: ({ folder, requestId }, reason) => ({
        _tag: "worktrees",
        folder,
        requestId,
        discovery: {
          status: "error",
          observedAt: new Date().toISOString(),
          detail: unansweredText(reason),
        },
      }),
    },
    models: {
      admission: "ordinary",
      run: ({ cwd, refresh, requestId }) =>
        facts.catalog(cwd, { refresh }).pipe(
          Effect.flatMap((catalog) =>
            send(
              requestId !== undefined && catalog.error
                ? { _tag: "models_failed", cwd, requestId, message: catalog.error }
                : {
                    _tag: "models",
                    catalog: requestId === undefined ? catalog : { ...catalog, cwd },
                    requestId,
                  },
            ),
          ),
        ),
      unanswered: ({ cwd, requestId }, reason) => ({
        _tag: "models_failed",
        cwd,
        requestId,
        message: unansweredText(reason),
      }),
    },
    // Registry writes reach every client's sidebar on their own.
    save_project: {
      admission: "ordinary",
      run: ({ project, assign }) => registry.saveProject(project, assign),
      unanswered: plainError,
    },
    delete_project: {
      admission: "ordinary",
      run: ({ id }) => registry.deleteProject(id),
      unanswered: plainError,
    },
    set_project_instructions: {
      admission: "ordinary",
      run: ({ id, instructions }) => registry.setProjectInstructions(id, instructions),
      unanswered: plainError,
    },
    assign_project: {
      admission: "ordinary",
      run: ({ cwd, sessionId, projectId }) => registry.assignProject(cwd, sessionId, projectId),
      unanswered: plainError,
    },
    remove_folder: {
      admission: "ordinary",
      run: ({ path }) => registry.removeFolder(path),
      unanswered: plainError,
    },
    trust: {
      admission: "ordinary",
      run: Effect.fn("ClientDispatch.trust")(function* ({ cwd }) {
        // Directory selection asks for models and trust concurrently. Personal extensions can
        // remember a trust decision while that probe starts, so read Pi's store only afterwards.
        yield* facts.catalog(cwd);
        yield* send({ _tag: "trust", ...(yield* facts.trust(cwd)) });
      }),
      unanswered: plainError,
    },
    set_trust: {
      admission: "ordinary",
      // Every client hears `catalogs_invalidated`; the requesting one also gets its answers at once.
      run: (request) =>
        Effect.gen(function* () {
          const { cwd, trust, catalog, notice, level } = yield* commands.setTrust(
            request.path,
            request.trusted,
          );
          yield* send({ _tag: "toast", level, message: notice });
          yield* send({ _tag: "trust", cwd, trust, requested: request.trusted });
          yield* send({ _tag: "models", catalog });
        }),
      // The browser holds the directory's trust control until this decision settles.
      unanswered: ({ path }, reason) => ({
        _tag: "trust_failed",
        cwd: path,
        message: unansweredText(reason),
      }),
    },
    // The command answers every outcome, failures included, and has the sidebar rediscover.
    create_worktree: {
      admission: "ordinary",
      run: ({ requestId, folder, branch, hooks }) =>
        commands
          .createWorktree(folder, branch, { hooks })
          .pipe(Effect.flatMap((result) => send({ _tag: "worktree_result", requestId, result }))),
      unanswered: worktreeUnanswered,
    },
    add_worktree: {
      admission: "ordinary",
      run: ({ requestId, folder, path }) =>
        commands
          .addWorktree(folder, path)
          .pipe(Effect.flatMap((result) => send({ _tag: "worktree_result", requestId, result }))),
      unanswered: worktreeUnanswered,
    },
    rename_session: {
      admission: "ordinary",
      run: ({ cwd, sessionId, title }) => sessions.rename(cwd, sessionId, title),
      unanswered: plainError,
    },
    pin_session: {
      admission: "ordinary",
      run: ({ cwd, sessionId, pinned }) => registry.pinSession(cwd, sessionId, pinned),
      unanswered: plainError,
    },
    archive_session: {
      admission: "ordinary",
      run: ({ cwd, sessionId }) => sessions.retire(cwd, sessionId, "archive"),
      unanswered: plainError,
    },
    delete_session: {
      admission: "ordinary",
      run: ({ cwd, sessionId }) => sessions.retire(cwd, sessionId, "delete"),
      unanswered: plainError,
    },
  };
  /** The policy for `request`'s own kind; TypeScript cannot correlate the lookup by itself. */
  const policyOf = <R extends ClientRequest>(request: R) =>
    requests[request._tag] as unknown as RequestPolicy<R>;

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
    yield* send(policyOf(request).unanswered(request, reason));
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

  const capacity = makeInboundCapacity(inboundLimits.client);
  const receive = Effect.fn("ClientDispatch.receive")(function* (request: ClientRequest) {
    const policy = policyOf(request);
    const admission =
      typeof policy.admission === "function" ? policy.admission(request) : policy.admission;
    /** The work, once admitted; a claim is made here, in receive order, and the work runs later. */
    const admitted: Effect.Effect<Effect.Effect<unknown, unknown>> =
      "claim" in policy
        ? policy.claim(request)
        : Effect.succeed(Effect.suspend(() => policy.run(request)));
    if (admission === "immediate") {
      yield* answered(request)(yield* admitted);
      return Effect.void;
    }
    const release = capacity.acquire(
      Buffer.byteLength(JSON.stringify(request)),
      admission === "control",
    );
    if (!release) {
      // Reject before claiming a selection or mutating anything. The receive loop
      // remains available for acknowledgements, dialog answers and cancellation.
      yield* settle(request, { _tag: "refused" });
      return Effect.void;
    }
    return (yield* admitted).pipe(answered(request), Effect.ensuring(Effect.sync(release)));
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
