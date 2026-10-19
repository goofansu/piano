/**
 * One browser client's sessions: which session it has selected, the live attachment that
 * forwards that session's frames, and the session requests it makes — create, act and retire.
 * Each request runs its SessionHosts step and delivers its results (`action_result`, toasts) to
 * this client through its output.
 *
 * Selections are claimed in receive order, so a slow lookup for an older selection never shows
 * or acts on a newer one. Attaching delivers the snapshot, then contiguous frames (INV-05), and
 * returns only once the snapshot is delivered, so a fast first prompt is observed. Only `create`
 * creates a session: SessionHosts registers the folder, the reference and its project first, and
 * records each prompt's activity before Pi sees it (INV-01). `act` may restart an existing
 * session; SessionHosts keeps one child per session (INV-02).
 */
import { Data, Deferred, Effect, Exit, Scope, Semaphore, Stream } from "effect";
import { emptySnapshot } from "../shared/sessionProjection.ts";
import type { Attachment, ServerMessage, SessionAction, StartOptions } from "../shared/wire.ts";
import type { DeliveryOverflow } from "./BoundedDelivery.ts";
import { Notifications } from "./Notifications.ts";
import type { PiSession, PiSessionError } from "./PiSessions.ts";
import type { RegistryError, RegistryLookupError } from "./Registry.ts";
import { type CreateSpec, SessionHosts } from "./SessionHosts.ts";

/** A new session and the first message to send it, if any. */
export interface CreateSessionRequest extends CreateSpec {
  readonly text?: string;
  readonly attachments?: ReadonlyArray<Attachment>;
}

export type RetireMode = "archive" | "delete";

export interface Selection {
  readonly cwd: string;
  /** `null` is a new session that is not created yet. */
  readonly sessionId: string | null;
  readonly selectionId: string;
  /** Piano's dispatch tool watching a session, not a person opening it. */
  readonly observer?: boolean;
}

/** Where one client's messages go. */
export interface ClientOutput {
  readonly send: (message: ServerMessage) => Effect.Effect<void>;
  /** The client fell behind the attached session; the connection should close. */
  readonly overflow: (error: DeliveryOverflow) => Effect.Effect<void>;
}

/** Why an action was not sent to Pi. Nothing was started or created. */
export class ActRefused extends Data.TaggedError("ActRefused")<{
  readonly reason: "stale" | "not_running" | "no_session";
  readonly detail: string;
}> {}

const refused = {
  stale: "Selection changed; inspect the current session before acting.",
  not_running: "Session is not running; start it first.",
  no_session: "No session is selected. Create a session before sending to it.",
} as const;
const refuse = (reason: ActRefused["reason"]) =>
  Effect.fail(new ActRefused({ reason, detail: refused[reason] }));

export interface ClientSessions {
  /** Claims the selection at once; the returned effect loads it and shows it if it is still current. */
  readonly select: (selection: Selection) => Effect.Effect<Effect.Effect<void, PiSessionError>>;
  /**
   * Claims a new-session selection at once; the returned effect creates the session (folder,
   * reference and project first) and shows it if this selection is still current.
   */
  readonly create: (
    request: CreateSessionRequest & { readonly selectionId: string },
  ) => Effect.Effect<Effect.Effect<void, PiSessionError | RegistryError | RegistryLookupError>>;
  /**
   * Sends `action` to the selected session, starting it with `start` when it is not running,
   * and delivers any `action_result`. Never creates a session.
   */
  readonly act: (
    selectionId: string,
    action: SessionAction,
    start?: StartOptions,
  ) => Effect.Effect<void, ActRefused | PiSessionError>;
  /** Detaches a session, stops Pi and archives or deletes it, then clears the selection if it showed that session. */
  readonly retire: (
    cwd: string,
    sessionId: string,
    mode: RetireMode,
  ) => Effect.Effect<void, PiSessionError>;
}

/** Lives until the surrounding scope closes, which detaches the attachment. */
export const makeClientSessions = Effect.fn("ClientSessions.make")(function* (
  output: ClientOutput,
) {
  const hosts = yield* SessionHosts;
  const notifications = yield* Notifications;
  const { send } = output;
  let selected: Selection | null = null;
  let attachment: { session: PiSession; scope: Scope.Closeable; selectionId: string } | null = null;
  // Serializes attach, detach and the stale checks that decide between them.
  const navigation = yield* Semaphore.make(1);
  const navigate = Semaphore.withPermits(navigation, 1);
  const current = (selection: Selection) => selected?.selectionId === selection.selectionId;
  const claim = (selection: Selection) =>
    Effect.sync(() => {
      selected = selection;
    });

  const detach = Effect.suspend(() => {
    const a = attachment;
    attachment = null;
    return a ? Scope.close(a.scope, Exit.succeed(undefined)) : Effect.void;
  });
  yield* Effect.addFinalizer(() => detach);

  // Caller holds navigation; slow lookup/start happens before stale-result checks.
  const attachTo = Effect.fn("ClientSessions.attachTo")(function* (
    session: PiSession,
    selection: Selection,
  ) {
    if (!current(selection)) return;
    yield* detach;
    const scope = yield* Scope.make();
    const mine = { session, scope, selectionId: selection.selectionId };
    attachment = mine;
    const ready = yield* Deferred.make<void>();
    yield* session.events.pipe(
      Stream.runForEach((event) =>
        Effect.gen(function* () {
          if (current(selection))
            yield* event._tag === "snapshot"
              ? send({
                  _tag: "selected",
                  selectionId: selection.selectionId,
                  cursor: event.cursor,
                  cwd: session.spec.cwd,
                  sessionId: session.spec.sessionId,
                  hosted: !event.snapshot.state.closure,
                  snapshot: event.snapshot,
                })
              : send({
                  _tag: "session",
                  selectionId: selection.selectionId,
                  cursor: event.cursor,
                  event,
                });
          if (event._tag === "snapshot") yield* Deferred.succeed(ready, undefined);
        }),
      ),
      Effect.catchTag("DeliveryOverflow", output.overflow),
      Effect.ensuring(Deferred.succeed(ready, undefined)),
      // The stream ends when Pi is gone; the next action will start it again.
      Effect.ensuring(
        Effect.sync(() => {
          if (attachment === mine) attachment = null;
        }),
      ),
      Effect.ignore,
      Effect.forkIn(scope),
    );
    // A fast first prompt must not complete before this client observes it.
    yield* Deferred.await(ready);
  });

  // Caller holds navigation.
  const attachOpened = Effect.fn("ClientSessions.attachOpened")(function* <E>(
    selectionId: string,
    open: Effect.Effect<PiSession, E>,
  ) {
    const session = yield* open;
    const selection = { cwd: session.spec.cwd, sessionId: session.spec.sessionId, selectionId };
    if (current(selection)) {
      selected = selection;
      yield* attachTo(session, selection);
    }
    return session;
  });

  const show = Effect.fn("ClientSessions.show")(function* (selection: Selection) {
    const { cwd, sessionId, selectionId } = selection;
    // A person opening the session is here: a completion message waiting for it is dropped.
    if (sessionId && !selection.observer) yield* notifications.touched(sessionId);
    const running = sessionId ? yield* hosts.get(cwd, sessionId) : undefined;
    const view = running
      ? undefined
      : sessionId
        ? yield* hosts.peek(cwd, sessionId)
        : { cwd, snapshot: emptySnapshot("") };
    yield* navigate(
      Effect.gen(function* () {
        if (!current(selection)) return;
        if (running) return yield* attachTo(running, selection);
        yield* detach;
        yield* send({
          _tag: "selected",
          selectionId,
          cursor: null,
          cwd: view!.cwd,
          sessionId,
          hosted: false,
          snapshot: view!.snapshot,
        });
      }),
    );
  });

  // The attached session for this selection, or the selected one started with `start`.
  const target = (selectionId: string, start: StartOptions | undefined) =>
    navigate(
      Effect.gen(function* () {
        if (!selected || selected.selectionId !== selectionId) return yield* refuse("stale");
        if (attachment?.selectionId === selectionId) {
          const session = attachment.session;
          // Offline draft choices travel with the input: apply them in order before submission.
          if (start?.model) yield* session.act({ _tag: "set_model", model: start.model });
          if (start?.thinkingLevel)
            yield* session.act({ _tag: "set_thinking_level", level: start.thinkingLevel });
          return session;
        }
        const { cwd, sessionId } = selected;
        // Creating belongs to `create`, which registers the folder and project first.
        if (sessionId === null) return yield* refuse("no_session");
        if (!start) return yield* refuse("not_running");
        // A start reaches browsers as a `hosts` update.
        return yield* attachOpened(
          selectionId,
          hosts.open({
            cwd,
            sessionId,
            model: start.model,
            thinkingLevel: start.thinkingLevel,
            name: start.name,
          }),
        );
      }),
    );

  const act = Effect.fn("ClientSessions.act")(function* (
    selectionId: string,
    action: SessionAction,
    start?: StartOptions,
  ) {
    const session = yield* target(selectionId, start);
    const result = yield* session.act(action);
    if (result)
      yield* send({
        _tag: "action_result",
        cwd: session.spec.cwd,
        sessionId: session.spec.sessionId,
        result,
      });
  });

  const retire = Effect.fn("ClientSessions.retire")(function* (
    cwd: string,
    sessionId: string,
    mode: RetireMode,
  ) {
    // Detach first, so this client sees no frames from a session being stopped.
    yield* navigate(
      Effect.suspend(() =>
        attachment?.session.spec.cwd === cwd && attachment.session.spec.sessionId === sessionId
          ? detach
          : Effect.void,
      ),
    );
    yield* mode === "delete" ? hosts.delete(cwd, sessionId) : hosts.archive(cwd, sessionId);
    if (selected?.cwd === cwd && selected.sessionId === sessionId) {
      const selectionId = selected.selectionId;
      selected = null;
      yield* send({
        _tag: "selected",
        selectionId,
        cursor: null,
        cwd,
        sessionId: null,
        hosted: false,
        snapshot: emptySnapshot(""),
      });
    }
    if (mode === "delete")
      yield* send({ _tag: "toast", message: "Session deleted", level: "success" });
  });

  // Caller has claimed the new-session selection.
  const create = Effect.fn("ClientSessions.create")(function* (
    selectionId: string,
    { text, attachments, ...spec }: CreateSessionRequest,
  ) {
    const session = yield* navigate(attachOpened(selectionId, hosts.create(spec)));
    const trimmed = text?.trim() ?? "";
    if (!trimmed && !attachments?.length) return;
    // Sent only once this client has attached, so it observes the prompt.
    yield* session.act({ _tag: "prompt", text: trimmed, attachments });
  });

  return {
    select: (selection) => claim(selection).pipe(Effect.as(show(selection))),
    create: ({ selectionId, ...request }) =>
      claim({ cwd: request.cwd, sessionId: null, selectionId }).pipe(
        Effect.as(create(selectionId, request)),
      ),
    act,
    retire,
  } satisfies ClientSessions as ClientSessions;
});
