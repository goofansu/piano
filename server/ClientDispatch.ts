import { Cause, Effect, Stream } from "effect";
import type { ClientMessage, ServerMessage } from "../shared/wire.ts";
import { type ClientOutput, InputNotSent, makeClientSessions } from "./ClientSessions.ts";
import { CreationAttempts } from "./CreationAttempts.ts";
import { DirectoryFacts } from "./DirectoryFacts.ts";
import { errorText } from "./ErrorText.ts";
import { inboundLimits, makeInboundCapacity } from "./InboundCapacity.ts";
import { inputBytes } from "./InputBytes.ts";
import { sessionActionPolicy } from "./PiSessions.ts";
import { Registry } from "./Registry.ts";
import { SessionHosts, SessionNotCreated } from "./SessionHosts.ts";
import { SessionStatus } from "./SessionStatus.ts";
import { SidebarView } from "./SidebarView.ts";
import { WorkspaceCommands } from "./WorkspaceCommands.ts";

export type ClientRequest = Exclude<ClientMessage, { _tag: "ack" }>;

export interface ClientDispatch {
  readonly receive: (request: ClientRequest) => Effect.Effect<Effect.Effect<void>>;
  readonly report: (error: unknown, selectionId?: string) => Effect.Effect<void>;
}

type Unanswered =
  | { readonly _tag: "refused" }
  | { readonly _tag: "failed"; readonly error: unknown };

const unansweredText = (reason: Unanswered) =>
  reason._tag === "refused"
    ? "Client input capacity is full. Request was not started; wait for pending work before trying again."
    : errorText(reason.error);

type Admission = "immediate" | "ordinary" | "control" | "claim";

type RequestPolicy<R extends ClientRequest> = {
  readonly unanswered: (request: R, reason: Unanswered) => ServerMessage;
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

type RequestPolicies = {
  readonly [K in ClientRequest["_tag"]]: RequestPolicy<Extract<ClientRequest, { _tag: K }>>;
};

const plainError = (_request: unknown, reason: Unanswered): ServerMessage => ({
  _tag: "error",
  message: unansweredText(reason),
  selectionId: undefined,
});

const dataControlsUnanswered = (
  request: { readonly requestId: string },
  reason: Unanswered,
): ServerMessage => ({
  _tag: "data_controls_result",
  requestId: request.requestId,
  result: { status: "error", detail: unansweredText(reason) },
});

export const makeClientDispatch = Effect.fn("ClientDispatch.make")(function* (
  output: ClientOutput,
) {
  const hosts = yield* SessionHosts;
  const facts = yield* DirectoryFacts;
  const sidebar = yield* SidebarView;
  const registry = yield* Registry;
  const attempts = yield* CreationAttempts;
  const commands = yield* WorkspaceCommands;
  const status = yield* SessionStatus;
  const sessions = yield* makeClientSessions(output);
  const { send } = output;

  const requests: RequestPolicies = {
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
      unanswered: ({ selectionId, action }, reason) => ({
        _tag: "error",
        message: unansweredText(reason),
        selectionId,
        ...("inputId" in action &&
        action.inputId !== undefined &&
        (reason._tag !== "failed" || reason.error instanceof InputNotSent)
          ? { inputId: action.inputId }
          : {}),
      }),
      confirmed: null,
    },
    registry: {
      admission: "ordinary",
      run: () => sidebar.refresh.pipe(Effect.andThen(sessions.recheck)),
      unanswered: plainError,
      confirmed: null,
    },
    directory: {
      admission: "ordinary",
      run: Effect.fn("ClientDispatch.directory")(function* ({ cwd, requestId }) {
        const catalog = yield* facts.catalog(cwd);
        const { trust } = yield* facts.trust(cwd);
        yield* send({
          _tag: "directory",
          cwd,
          requestId,
          result: { status: "ready", catalog: { ...catalog, cwd }, trust },
        });
      }),
      unanswered: ({ cwd, requestId }, reason) => ({
        _tag: "directory",
        cwd,
        requestId,
        result: { status: "error", message: unansweredText(reason) },
      }),
      confirmed: null,
    },
    models: {
      admission: "ordinary",
      run: ({ cwd, requestId }) =>
        facts
          .catalog(cwd, { refresh: true })
          .pipe(
            Effect.flatMap((catalog) =>
              send(
                catalog.error
                  ? { _tag: "models_failed", cwd, requestId, message: catalog.error }
                  : { _tag: "models", catalog: { ...catalog, cwd }, requestId },
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
    assign_project: {
      admission: "ordinary",
      run: ({ cwd, sessionId, projectId }) => registry.assignProject(cwd, sessionId, projectId),
      unanswered: plainError,
      confirmed: ({ projectId }) =>
        projectId === null
          ? Effect.succeed("Session removed from project")
          : registry.requireProject(projectId).pipe(
              Effect.map((project) => `Session moved to ${project.name}`),
              Effect.orElseSucceed(() => "Session moved"),
            ),
    },
    remove_folder: {
      admission: "ordinary",
      run: ({ path }) => registry.removeFolder(path),
      unanswered: plainError,
      confirmed: "Folder closed",
    },
    set_trust: {
      admission: "ordinary",
      run: (request) =>
        Effect.gen(function* () {
          const { cwd, trust, catalog, notice, level } = yield* commands.setTrust(
            request.path,
            request.trusted,
          );
          yield* send({ _tag: "toast", level, message: notice });
          yield* send({ _tag: "trust", cwd, trust, requestId: request.requestId });
          yield* send({ _tag: "models", catalog });
        }),
      unanswered: ({ path, requestId }, reason) => ({
        _tag: "trust_failed",
        requestId,
        cwd: path,
        message: unansweredText(reason),
      }),
      confirmed: null,
    },
    rename_session: {
      admission: "ordinary",
      run: ({ cwd, sessionId, title }) => hosts.rename(cwd, sessionId, title),
      unanswered: plainError,
      confirmed: "Session renamed",
    },
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
    unarchive_session: {
      admission: "ordinary",
      run: Effect.fn("ClientDispatch.unarchive")(function* ({ cwd, sessionId, requestId }) {
        const closed = yield* hosts.unarchive(cwd, sessionId);
        yield* send({
          _tag: "data_controls_result",
          requestId,
          result: { status: "ready", count: 1 },
        });
        yield* send({
          _tag: "toast",
          level: "success",
          message: closed ? "Session unarchived · Folder remains closed" : "Session unarchived",
        });
      }),
      unanswered: dataControlsUnanswered,
      confirmed: null,
    },
    archive_sessions_count: {
      admission: "ordinary",
      run: ({ requestId }) =>
        hosts.archiveCount.pipe(
          Effect.flatMap((count) =>
            send({ _tag: "data_controls_result", requestId, result: { status: "ready", count } }),
          ),
        ),
      unanswered: dataControlsUnanswered,
      confirmed: null,
    },
    archive_all_sessions: {
      admission: "ordinary",
      run: Effect.fn("ClientDispatch.archiveAll")(function* ({ requestId }) {
        const count = yield* hosts.archiveAll;
        yield* sessions.clearArchived((yield* registry.get).sessions);
        yield* send({
          _tag: "data_controls_result",
          requestId,
          result: { status: "ready", count },
        });
        yield* send({ _tag: "toast", level: "success", message: `${count} sessions archived` });
      }),
      unanswered: dataControlsUnanswered,
      confirmed: null,
    },
    delete_session: {
      admission: "ordinary",
      run: ({ cwd, sessionId }) => sessions.retire(cwd, sessionId, "delete"),
      unanswered: plainError,
      confirmed: "Session deleted",
    },
  };
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
    if (request._tag === "create_session" && request.attemptId && reason._tag !== "failed") {
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

  const confirm = (request: ClientRequest): Effect.Effect<void> => {
    const { confirmed } = policyOf(request);
    if (confirmed === null) return Effect.void;
    const message = typeof confirmed === "string" ? Effect.succeed(confirmed) : confirmed(request);
    return message.pipe(
      Effect.flatMap((message) => send({ _tag: "toast", level: "success", message })),
    );
  };

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
  let pendingSelection:
    | { bytes: number; release: () => void; work: Effect.Effect<void> }
    | undefined;
  let selectionReader: symbol | undefined;
  const readSelections = Effect.fn("ClientDispatch.readSelections")(
    function* (_owner: symbol) {
      for (;;) {
        const next = pendingSelection;
        if (!next) {
          selectionReader = undefined;
          return;
        }
        pendingSelection = undefined;
        yield* next.work.pipe(Effect.ensuring(Effect.sync(() => next.release())));
      }
    },
    (work, owner) =>
      work.pipe(
        Effect.ensuring(
          Effect.sync(() => {
            if (selectionReader !== owner) return;
            selectionReader = undefined;
            pendingSelection?.release();
            pendingSelection = undefined;
          }),
        ),
      ),
  );
  const receive = Effect.fn("ClientDispatch.receive")(function* (request: ClientRequest) {
    const policy = policyOf(request);
    const admission =
      typeof policy.admission === "function" ? policy.admission(request) : policy.admission;
    const admitted: Effect.Effect<Effect.Effect<unknown, unknown>> =
      "claim" in policy
        ? policy.claim(request)
        : Effect.succeed(Effect.suspend(() => policy.run(request)));
    if (admission === "immediate") {
      yield* answered(request)(yield* admitted);
      return Effect.void;
    }
    const bytes = inputBytes(request);
    const replaced = request._tag === "select" ? pendingSelection : undefined;
    if (replaced) {
      pendingSelection = undefined;
      replaced.release();
    }
    const release = capacity.acquire(bytes, admission === "control");
    if (!release) {
      if (replaced) {
        replaced.release = capacity.acquire(replaced.bytes)!;
        pendingSelection = replaced;
      }
      yield* settle(request, { _tag: "refused" });
      return Effect.void;
    }
    const admittedWork = yield* admitted;
    if (request._tag === "select") {
      pendingSelection = { bytes, release, work: answered(request)(admittedWork) };
      if (selectionReader) return Effect.void;
      selectionReader = Symbol();
      return readSelections(selectionReader);
    }
    return admittedWork.pipe(answered(request), Effect.ensuring(Effect.sync(release)));
  }, Effect.uninterruptible);

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
