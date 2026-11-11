/**
 * One browser client's requests and the server-wide updates it hears, without the socket.
 * Session requests go to the client's ClientSessions; the rest run their SessionHosts,
 * WorkspaceCommands, Registry or DirectoryFacts step here and answer through the client's
 * output. Each request kind is described once, in `requests`: how it is admitted, its work, the
 * toast that confirms a change once its work succeeds, and the one reply its sender awaits when
 * capacity refuses it or it fails. A refused or failed request never ends the connection.
 */
import { Cause, Effect, Stream } from "effect";
import type { ClientMessage, ServerMessage } from "../shared/wire.ts";
import { type ClientOutput, InputNotSent, makeClientSessions } from "./ClientSessions.ts";
import { CreationAttempts } from "./CreationAttempts.ts";
import { DirectoryFacts } from "./DirectoryFacts.ts";
import { errorText } from "./ErrorText.ts";
import { inboundLimits, makeInboundCapacity } from "./InboundCapacity.ts";
import { inputBytes } from "./InputBytes.ts";
import { peerVerdict } from "./PeerScope.ts";
import { sessionActionPolicy } from "./PiSessions.ts";
import { PreparedImages } from "./PreparedImages.ts";
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

/**
 * Why a request ends without its ordinary answer: refused unstarted at admission, not offered to
 * another machine's Piano (PeerScope), or failed.
 */
type Unanswered =
  | { readonly _tag: "refused" }
  | { readonly _tag: "unsupported" }
  | { readonly _tag: "images"; readonly detail: string }
  | { readonly _tag: "failed"; readonly error: unknown };

const unansweredText = (reason: Unanswered) =>
  reason._tag === "refused"
    ? "Client input capacity is full. Request was not started; wait for pending work before trying again."
    : reason._tag === "unsupported"
      ? "Not available from another machine: this session is not listed here, or the request is not supported remotely."
      : reason._tag === "images"
        ? reason.detail
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
  /**
   * The success toast that ends a change once its work has succeeded, naming it as the UI does
   * ("Project saved"); a function when the name depends on the request or the registry. Null for
   * a request answered otherwise: reads, controls, selections, and changes with their own reply.
   */
  readonly confirmed: string | ((request: R) => Effect.Effect<string>) | null;
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
    reason._tag !== "failed"
      ? { status: "error", detail: unansweredText(reason), unconfirmed: false }
      : worktreeFailure(reason.error),
});

/** Sends the current hosts and sidebar, then forwards updates until the surrounding scope closes. */
export const makeClientDispatch = Effect.fn("ClientDispatch.make")(function* (
  output: ClientOutput,
  /** Another machine's Piano through its gateway: only PeerScope's slice is admitted. */
  { peer = false }: { readonly peer?: boolean } = {},
) {
  const hosts = yield* SessionHosts;
  const facts = yield* DirectoryFacts;
  const sidebar = yield* SidebarView;
  const registry = yield* Registry;
  const attempts = yield* CreationAttempts;
  const commands = yield* WorkspaceCommands;
  const status = yield* SessionStatus;
  const prepared = yield* PreparedImages;
  const pendingImages = new Set<() => void>();
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      for (const release of pendingImages) release();
      pendingImages.clear();
    }),
  );
  const sessions = yield* makeClientSessions(output);
  const { send } = output;

  const requests: RequestPolicies = {
    // Heartbeats are immediate transport liveness, not Pi work. Rejecting one
    // during saturation makes a healthy browser reconnect and abandon controls.
    ping: {
      admission: "immediate",
      run: ({ nonce }) => send({ _tag: "pong", nonce }),
      unanswered: plainError,
      confirmed: null,
    },
    select: {
      admission: "claim",
      claim: sessions.select,
      unanswered: ({ selectionId }, reason) =>
        reason._tag !== "failed"
          ? { _tag: "selection_rejected", selectionId, message: unansweredText(reason) }
          : { _tag: "selection_failed", selectionId, message: unansweredText(reason) },
      confirmed: null,
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
      // unless SessionHosts confirms no session/input remains (including a stopped, empty startup),
      // or the session's host refused the first message before Pi saw it, which names it.
      unanswered: ({ selectionId, attemptId }, reason) =>
        reason._tag !== "failed" ||
        (reason._tag === "failed" && reason.error instanceof SessionNotCreated)
          ? {
              _tag: "selection_rejected",
              selectionId,
              inputId: attemptId ?? selectionId,
              message: unansweredText(reason),
            }
          : {
              _tag: "error",
              message: unansweredText(reason),
              selectionId,
              ...(reason._tag === "failed" && reason.error instanceof InputNotSent
                ? { inputId: reason.error.inputId, ...reason.error.session }
                : {}),
            },
      confirmed: null,
    },
    // A read: it answers every outcome, an unknown session or project included.
    session_status: {
      admission: "ordinary",
      run: ({ requestId, target }) =>
        status.read(target).pipe(
          Effect.match({
            onSuccess: (sessions) => ({ status: "ready" as const, sessions }),
            onFailure: (e) => ({ status: "unlisted" as const, detail: e.detail }),
          }),
          Effect.flatMap((result) => send({ _tag: "session_status", requestId, result })),
        ),
      unanswered: ({ requestId }, reason) => ({
        _tag: "session_status",
        requestId,
        result: { status: "error", detail: unansweredText(reason) },
      }),
      confirmed: null,
    },
    act: {
      admission: ({ action }) =>
        sessionActionPolicy[action._tag].priority ? "control" : "ordinary",
      run: ({ selectionId, action, start }) => sessions.act(selectionId, action, start),
      // A status read settles by its request ID, whether client or session admission refused it
      // or it failed; the browser then shows the app as unknown and may read again.
      unanswered: ({ selectionId, action }, reason) =>
        action._tag === "preview_status" && action.requestId !== undefined
          ? {
              _tag: "preview_unobserved",
              selectionId,
              requestId: action.requestId,
              message: unansweredText(reason),
            }
          : {
              _tag: "error",
              message: unansweredText(reason),
              selectionId,
              // Refused at admission or before Pi saw it: the input was never delivered.
              ...("inputId" in action &&
              action.inputId !== undefined &&
              (reason._tag !== "failed" || reason.error instanceof InputNotSent)
                ? { inputId: action.inputId }
                : {}),
            },
      confirmed: null,
    },
    registry: {
      admission: "ordinary",
      run: () => sidebar.refresh.pipe(Effect.andThen(sessions.recheck)),
      unanswered: plainError,
      confirmed: null,
    },
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
      confirmed: null,
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
      confirmed: null,
    },
    // Every client's sidebar hears a registry write on its own; the sender also gets the toast.
    save_project: {
      admission: "ordinary",
      run: ({ project, assign }) => registry.saveProject(project, assign),
      unanswered: plainError,
      confirmed: "Project created",
    },
    delete_project: {
      admission: "ordinary",
      run: ({ id }) => registry.deleteProject(id),
      unanswered: plainError,
      confirmed: "Project deleted",
    },
    update_project: {
      admission: "ordinary",
      run: ({ id, name, instructions }) => registry.updateProject(id, { name, instructions }),
      unanswered: plainError,
      confirmed: "Project saved",
    },
    set_project_done: {
      admission: "ordinary",
      run: ({ id, done }) => registry.setProjectDone(id, done),
      unanswered: plainError,
      confirmed: ({ done }) => Effect.succeed(done ? "Project marked done" : "Project reopened"),
    },
    // Add to project and Move to project both send this, so the toast names where it went.
    assign_project: {
      admission: "ordinary",
      run: ({ cwd, sessionId, projectId }) => registry.assignProject(cwd, sessionId, projectId),
      unanswered: plainError,
      confirmed: ({ projectId }) =>
        projectId === null
          ? Effect.succeed("Session removed from project")
          : registry.requireProject(projectId).pipe(
              Effect.map((project) => `Session moved to ${project.name}`),
              // Deleted since the move: the move still happened.
              Effect.orElseSucceed(() => "Session moved"),
            ),
    },
    remove_folder: {
      admission: "ordinary",
      run: ({ path }) => registry.removeFolder(path),
      unanswered: plainError,
      // The folder's action is Close.
      confirmed: "Folder closed",
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
      confirmed: null,
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
      // The decision's own notice is its toast: it says what Pi now holds.
      confirmed: null,
    },
    // The command answers every outcome, failures included, and has the sidebar rediscover.
    create_worktree: {
      admission: "ordinary",
      run: ({ requestId, folder, branch, hooks }) =>
        commands
          .createWorktree(folder, branch, { hooks })
          .pipe(Effect.flatMap((result) => send({ _tag: "worktree_result", requestId, result }))),
      unanswered: worktreeUnanswered,
      confirmed: null,
    },
    add_worktree: {
      admission: "ordinary",
      run: ({ requestId, folder, path }) =>
        commands
          .addWorktree(folder, path)
          .pipe(Effect.flatMap((result) => send({ _tag: "worktree_result", requestId, result }))),
      unanswered: worktreeUnanswered,
      confirmed: null,
    },
    // Pi owns the name, so a stopped session is started for it.
    rename_session: {
      admission: "ordinary",
      run: ({ cwd, sessionId, title }) => hosts.rename(cwd, sessionId, title),
      unanswered: plainError,
      confirmed: "Session renamed",
    },
    // Pinning answers in place: the row moves to Pinned.
    pin_session: {
      admission: "ordinary",
      run: ({ cwd, sessionId, pinned }) => registry.pinSession(cwd, sessionId, pinned),
      unanswered: plainError,
      confirmed: null,
    },
    archive_session: {
      admission: "ordinary",
      run: ({ cwd, sessionId }) => sessions.retire(cwd, sessionId, "archive"),
      unanswered: plainError,
      confirmed: "Session archived",
    },
    delete_session: {
      admission: "ordinary",
      run: ({ cwd, sessionId }) => sessions.retire(cwd, sessionId, "delete"),
      unanswered: plainError,
      confirmed: "Session deleted",
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
    // Refusing this delivery does not undo an older request with the same durable identity.
    // This also covers an expired image capability on a duplicate remote start.
    if (request._tag === "create_session" && request.attemptId && reason._tag !== "failed") {
      // As recorded now: an unanswered delivery never waits for the original's start.
      const known = yield* attempts.outcome(request.attemptId, { wait: false }).pipe(Effect.result);
      if (
        known._tag === "Failure" ||
        (known.success._tag !== "failed" && known.success._tag !== "unclaimed")
      ) {
        yield* send({
          _tag: "error",
          selectionId: request.selectionId,
          message:
            "Could not admit this request. The original start may already have run; inspect it before retrying.",
        });
        return;
      }
    }
    yield* send(policyOf(request).unanswered(request, reason));
  });

  /** The toast that ends `request` once its work has succeeded, if its kind confirms one. */
  const confirm = (request: ClientRequest): Effect.Effect<void> => {
    const { confirmed } = policyOf(request);
    if (confirmed === null) return Effect.void;
    const message = typeof confirmed === "string" ? Effect.succeed(confirmed) : confirmed(request);
    return message.pipe(
      Effect.flatMap((message) => send({ _tag: "toast", level: "success", message })),
    );
  };

  /**
   * Runs a request's work and confirms it; any failure but interruption settles the request
   * instead, without the confirmation.
   */
  const answered =
    (request: ClientRequest) =>
    <A, E>(work: Effect.Effect<A, E>): Effect.Effect<void> =>
      work.pipe(
        Effect.andThen(confirm(request)),
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.void
            : settle(request, { _tag: "failed", error: Cause.squash(cause) }),
        ),
      );

  const capacity = makeInboundCapacity(inboundLimits.client);
  const receive = Effect.fn("ClientDispatch.receive")(function* (request: ClientRequest) {
    const selection = peer ? yield* sessions.selection : null;
    if (peer) {
      const verdict = peerVerdict(yield* registry.get, request, selection);
      if (verdict === "skip") return Effect.void;
      if (verdict === "refuse") {
        yield* settle(request, { _tag: "unsupported" });
        return Effect.void;
      }
    }
    // References are transport capabilities, resolved here before any start/create. PiSessions
    // receives only its existing image action; mixed inline/reference input is never ambiguous.
    let releaseImages = () => {};
    let imageLease = false;
    if ((request._tag === "act" || request._tag === "create_session") && request.preparedImages) {
      const reference = request.preparedImages;
      const create = request._tag === "create_session";
      const input = request._tag === "create_session" ? request : request.action;
      const target =
        request._tag === "create_session"
          ? { cwd: request.cwd }
          : selection?.sessionId
            ? { cwd: selection.cwd, sessionId: selection.sessionId }
            : undefined;
      if (
        !peer ||
        !target ||
        (!create && input._tag !== "prompt" && input._tag !== "steer") ||
        ("attachments" in input && input.attachments !== undefined)
      ) {
        yield* settle(request, { _tag: "unsupported" });
        return Effect.void;
      }
      const lease = yield* prepared
        .claim(yield* registry.get, reference, target)
        .pipe(Effect.result);
      if (lease._tag === "Failure") {
        // No session or input was started. Preserve the normal known-unsent receipt shape.
        yield* settle(request, { _tag: "images", detail: lease.failure.detail });
        return Effect.void;
      }
      releaseImages = lease.success.release;
      imageLease = true;
      pendingImages.add(releaseImages);
      request =
        request._tag === "create_session"
          ? { ...request, preparedImages: undefined, attachments: lease.success.attachments }
          : {
              ...request,
              preparedImages: undefined,
              action: {
                ...request.action,
                attachments: lease.success.attachments,
              } as typeof request.action,
            };
    }
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
    const release = capacity.acquire(inputBytes(request), admission === "control");
    if (!release) {
      // Reject before claiming a selection or mutating anything. The receive loop
      // remains available for acknowledgements, dialog answers and cancellation.
      releaseImages();
      pendingImages.delete(releaseImages);
      yield* settle(request, { _tag: "refused" });
      return Effect.void;
    }
    const work = (yield* admitted).pipe(
      answered(request),
      Effect.ensuring(
        Effect.sync(() => {
          releaseImages();
          release();
        }),
      ),
    );
    // Once consumed, a disconnected observer must not free the image budget while Pi still
    // processes the operation. Existing Pi admission/write deadlines bound its settlement.
    return imageLease
      ? Effect.sync(() => {
          pendingImages.delete(releaseImages);
        }).pipe(Effect.andThen(work), Effect.uninterruptible)
      : work;
  }, Effect.uninterruptible);

  // ── initial state and global updates ──
  // Worktree discovery can take seconds in a large repository. Show the last observation at
  // once and let a fresh one follow, so it never holds up the page or this client's requests.
  // Each subscription is taken before anything is sent, so no change between the first message
  // and a later one is missed.
  const updates = yield* sidebar.subscribe;
  const running = yield* hosts.subscribe;
  yield* (yield* facts.changes).pipe(
    Stream.runForEach(() => send({ _tag: "catalogs_invalidated" })),
    Effect.ignore,
    Effect.forkScoped,
  );
  yield* running.pipe(
    Stream.runForEach((list) => send({ _tag: "hosts", hosts: list })),
    Effect.ignore,
    Effect.forkScoped,
  );
  yield* updates.pipe(Stream.runForEach(send), Effect.ignore, Effect.forkScoped);
  yield* sidebar.refresh;

  return { receive, report } satisfies ClientDispatch as ClientDispatch;
});
