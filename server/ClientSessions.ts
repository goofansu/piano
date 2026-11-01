/**
 * One browser client's sessions: which session it has selected, the live attachment that
 * forwards that session's frames, and the session requests that touch them — create, act and
 * retire. Each request runs its SessionHosts step and delivers its results (`selected`,
 * `action_result`) to this client through its output.
 *
 * Selections are claimed in receive order, so a slow lookup for an older selection never shows
 * or acts on a newer one. Attaching delivers the snapshot, then contiguous frames (INV-05), and
 * returns only once the snapshot is delivered, so a fast first prompt is observed. Only `create`
 * creates a session: SessionHosts registers the folder, the reference and its project first, and
 * records each prompt's activity before Pi sees it (INV-01). `act` may restart an existing
 * session; SessionHosts keeps one child per session (INV-02). A selected session shown stopped
 * attaches once another client starts it, without starting Pi itself.
 */
import { Data, Deferred, Effect, Exit, Scope, Semaphore, Stream } from "effect";
import { emptySnapshot } from "../shared/sessionProjection.ts";
import {
  type Attachment,
  type HostInfo,
  type ServerMessage,
  type SessionAction,
  type StartOptions,
  sameSession,
} from "../shared/wire.ts";
import type { DeliveryOverflow } from "./BoundedDelivery.ts";
import { type PiSession, type PiSessionError, sessionActionPolicy } from "./PiSessions.ts";
import { type CreateSpec, SessionHosts, type SessionNotCreated } from "./SessionHosts.ts";

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
/**
 * A prompt or steer refused before Pi saw it (stale selection, archived or unregistered session,
 * a start that failed): never delivered, so its sender may return it to the draft. `detail` is
 * the refusal's own.
 */
export class InputNotSent extends Data.TaggedError("InputNotSent")<{
  readonly inputId: string;
  readonly detail: string;
  readonly cause: ActRefused | PiSessionError;
}> {}

const refuse = (reason: ActRefused["reason"], detail: string = refused[reason]) =>
  Effect.fail(new ActRefused({ reason, detail }));

interface ClientSessions {
  /** Claims the selection at once; the returned effect loads it and shows it if it is still current. */
  readonly select: (selection: Selection) => Effect.Effect<Effect.Effect<void, PiSessionError>>;
  /**
   * Claims a new-session selection at once; the returned effect creates the session (folder,
   * reference and project first) and shows it if this selection is still current.
   */
  readonly create: (
    request: CreateSessionRequest & { readonly selectionId: string },
  ) => Effect.Effect<Effect.Effect<void, PiSessionError | SessionNotCreated>>;
  /**
   * Sends `action` to the selected session, starting it with `start` when it is not running,
   * and delivers any `action_result`. Never creates a session. Reuse the current select or
   * create selectionId; a new request id is refused as stale, even for the same hosted session.
   * Starting does not hold this client's navigation: if another selection is made meanwhile, the
   * action is still sent and its result delivered, but the started session is not shown.
   */
  readonly act: (
    selectionId: string,
    action: SessionAction,
    start?: StartOptions,
  ) => Effect.Effect<void, ActRefused | PiSessionError | InputNotSent>;
  /**
   * Shows the selected session again when its checkout has since gone or come back: no Pi watches
   * a saved session's checkout, and a live one's Pi keeps running without it, so its view would
   * otherwise keep the answer it was shown with.
   */
  readonly recheck: Effect.Effect<void>;
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
  const { send } = output;
  let selected: Selection | null = null;
  /** The session last shown, live or saved, with the checkout answer its view carries. */
  let shown: { selectionId: string; cwd: string; checkoutMissing: boolean } | null = null;
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
    shown = { selectionId: selection.selectionId, cwd: session.spec.cwd, checkoutMissing: false };
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

  // Caller holds navigation and has just opened `session`. Two acts that both started the
  // selected session attach it once.
  const attachOpened = Effect.fn("ClientSessions.attachOpened")(function* (
    selectionId: string,
    session: PiSession,
  ) {
    const selection = { cwd: session.spec.cwd, sessionId: session.spec.sessionId, selectionId };
    if (!current(selection)) return;
    selected = selection;
    if (attachment?.selectionId === selectionId && attachment.session === session) return;
    yield* attachTo(session, selection);
  });

  // The one place a request brings up Pi for a selection. Opening (Pi readiness can take 30 s, a
  // new worktree a minute) runs outside navigation, so this client can show other sessions
  // meanwhile; navigation is taken only to attach the result. If the selection changed in the
  // meantime, the newer view stays: the opened session is not shown, but the request still
  // completes (create sends its first prompt, act its action and `action_result`), because it
  // was accepted while its selection was current.
  const openThenAttach = <A extends { readonly session: PiSession }, E>(
    selectionId: string,
    opening: Effect.Effect<A, E>,
  ) => opening.pipe(Effect.tap(({ session }) => navigate(attachOpened(selectionId, session))));

  const show = Effect.fn("ClientSessions.show")(function* (selection: Selection) {
    const { cwd, sessionId, selectionId } = selection;
    const view = sessionId
      ? yield* hosts.read(cwd, sessionId)
      : { _tag: "saved" as const, cwd, snapshot: emptySnapshot("") };
    yield* navigate(
      Effect.gen(function* () {
        if (!current(selection)) return;
        if (view._tag === "live") {
          // An act that started this session, or a follow, may have attached it already.
          if (attachment?.selectionId === selectionId && attachment.session === view.session)
            return;
          return yield* attachTo(view.session, selection);
        }
        yield* detach;
        shown = sessionId
          ? { selectionId, cwd: view.cwd, checkoutMissing: !!view.snapshot.state.checkoutMissing }
          : null;
        yield* send({
          _tag: "selected",
          selectionId,
          cursor: null,
          cwd: view.cwd,
          sessionId,
          hosted: false,
          snapshot: view.snapshot,
        });
      }),
    );
  });

  // Another client may start the session this one shows stopped. Its live frames arrive only
  // through an attachment, so attach once it is running: reading never starts Pi (INV-02), and
  // `show` drops the result if the selection changed meanwhile. Runs one change at a time, so a
  // burst of changes attaches once.
  const follow = Effect.fn("ClientSessions.follow")(function* (running: ReadonlyArray<HostInfo>) {
    const selection = selected;
    const view = shown;
    if (!selection?.sessionId || view?.selectionId !== selection.selectionId) return;
    if (attachment?.selectionId === selection.selectionId) return;
    const { sessionId } = selection;
    if (!running.some((h) => sameSession(h, { cwd: view.cwd, sessionId }))) return;
    yield* show(selection);
  });
  yield* hosts.subscribe.pipe(
    Effect.flatMap(
      Stream.runForEach((running) =>
        follow(running).pipe(
          Effect.catchTag("PiSessionError", (e) =>
            Effect.logWarning(`Could not follow the selected session: ${e.detail}`),
          ),
        ),
      ),
    ),
    Effect.forkScoped,
  );

  // Draft choices travel with the input. Pi took them as launch arguments if this request
  // launched it; a session that was already running, here or in another tab, takes them as
  // actions in order before submission. A name only names a session Pi launches.
  const applyChoices = Effect.fn("ClientSessions.applyChoices")(function* (
    session: PiSession,
    start: StartOptions | undefined,
  ) {
    if (start?.model) yield* session.act({ _tag: "set_model", model: start.model });
    if (start?.thinkingLevel)
      yield* session.act({ _tag: "set_thinking_level", level: start.thinkingLevel });
    return session;
  });

  // With `start`, the selected session as SessionHosts starts it: its live host, or a new Pi when
  // none is running or the attached one is closing (SessionHosts decides under the session's
  // lock, after any close completes; the attachment here may be stale). Without `start`, only the
  // attached session. Only the decision holds navigation; starting runs outside it (see
  // `openThenAttach`). Two quick acts may both start the session: SessionHosts shares its one
  // host, and the act that did not launch Pi applies its choices as actions.
  const target = Effect.fn("ClientSessions.target")(function* (
    selectionId: string,
    start: StartOptions | undefined,
  ) {
    const decided = yield* navigate(
      Effect.gen(function* () {
        if (!selected || selected.selectionId !== selectionId)
          return yield* refuse(
            "stale",
            `${refused.stale} selected.selectionId=${JSON.stringify(selected?.selectionId ?? null)}; act.selectionId=${JSON.stringify(selectionId)}. Reuse the selectionId from the current select or create_session; do not mint a new id for act.`,
          );
        const attached = attachment;
        if (!start && attached?.selectionId === selectionId)
          return { _tag: "attached" as const, session: attached.session };
        const { cwd, sessionId } = selected;
        // Creating belongs to `create`, which registers the folder and project first.
        if (sessionId === null) return yield* refuse("no_session");
        if (!start) return yield* refuse("not_running");
        return { _tag: "start" as const, cwd, sessionId, start };
      }),
    );
    if (decided._tag === "attached") return yield* applyChoices(decided.session, start);
    const { cwd, sessionId, start: options } = decided;
    // A start reaches browsers as a `hosts` update.
    const { session, launched } = yield* openThenAttach(
      selectionId,
      hosts.start({
        cwd,
        sessionId,
        model: options.model,
        thinkingLevel: options.thinkingLevel,
        name: options.name,
      }),
    );
    return launched ? session : yield* applyChoices(session, options);
  });

  const act = Effect.fn("ClientSessions.act")(function* (
    selectionId: string,
    action: SessionAction,
    start?: StartOptions,
  ) {
    // An action its policy forbids from starting Pi ignores start options, even when an old or
    // malformed client sends them.
    // Until `session.act`, Pi has not seen the input: a refusal before it names the input.
    const inputId = "inputId" in action ? action.inputId : undefined;
    const session = yield* target(
      selectionId,
      sessionActionPolicy[action._tag].startsPi ? start : undefined,
    ).pipe(
      Effect.mapError((cause) =>
        inputId === undefined ? cause : new InputNotSent({ inputId, detail: cause.detail, cause }),
      ),
    );
    const result = yield* session.act(action);
    if (result)
      yield* send({
        _tag: "action_result",
        cwd: session.spec.cwd,
        sessionId: session.spec.sessionId,
        result,
      });
  });

  // One stat per call; the session is read again only when the answer changed, and reading stops
  // a live host whose checkout is gone. Show forgets the view first, so a session that can no
  // longer be read is not retried on every refresh.
  const recheck = Effect.gen(function* () {
    const view = shown;
    if (!view || !selected || selected.selectionId !== view.selectionId) return;
    const selection = selected;
    if ((yield* hosts.checkoutMissing(view.cwd)) === view.checkoutMissing) return;
    shown = null;
    yield* show(selection);
  }).pipe(
    Effect.catchTag("PiSessionError", (e) =>
      Effect.logWarning(`Could not recheck the selected session: ${e.detail}`),
    ),
  );

  const retire = Effect.fn("ClientSessions.retire")(function* (
    cwd: string,
    sessionId: string,
    mode: RetireMode,
  ) {
    // Detach first, so this client sees no frames from a session being stopped.
    yield* navigate(
      Effect.suspend(() =>
        attachment && sameSession(attachment.session.spec, { cwd, sessionId })
          ? detach
          : Effect.void,
      ),
    );
    yield* (mode === "delete" ? hosts.delete(cwd, sessionId) : hosts.archive(cwd, sessionId)).pipe(
      // A refused retire leaves Pi running: show the selection again, so this client reattaches.
      Effect.tapError(() =>
        selected?.cwd === cwd && selected.sessionId === sessionId
          ? show(selected).pipe(
              Effect.catchTag("PiSessionError", (e) =>
                Effect.logWarning(`Could not show the session again: ${e.detail}`),
              ),
            )
          : Effect.void,
      ),
    );
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
  });

  // Caller has claimed the new-session selection. Creating runs outside navigation (see
  // `openThenAttach`). A client acts only after its `selected`, which attaching sends, so no act
  // waits on a pending creation.
  const create = Effect.fn("ClientSessions.create")(function* (
    selectionId: string,
    { text, attachments, ...spec }: CreateSessionRequest,
  ) {
    const { session } = yield* openThenAttach(
      selectionId,
      hosts.create(spec).pipe(Effect.map((session) => ({ session }))),
    );
    const trimmed = text?.trim() ?? "";
    if (!trimmed && !attachments?.length) return;
    // Sent only once this client has attached, so it observes the prompt.
    yield* session.act({ _tag: "prompt", text: trimmed, attachments, inputId: selectionId });
  });

  return {
    select: (selection) => claim(selection).pipe(Effect.as(show(selection))),
    create: ({ selectionId, ...request }) =>
      claim({ cwd: request.cwd, sessionId: null, selectionId }).pipe(
        Effect.as(create(selectionId, request)),
      ),
    act,
    recheck,
    retire,
  } satisfies ClientSessions as ClientSessions;
});
