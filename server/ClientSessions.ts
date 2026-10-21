/**
 * One browser client's sessions: which session it has selected, the live attachment that
 * forwards that session's frames, and the session requests it makes — create, act, rename and
 * retire. Each request runs its SessionHosts step and delivers its results (`action_result`,
 * toasts) to this client through its output.
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
import type { PiSession, PiSessionError } from "./PiSessions.ts";
import type { RegistryError, RegistryLookupError } from "./Registry.ts";
import { type CreateSpec, SessionHosts } from "./SessionHosts.ts";
import type { WorktreeError } from "./Worktrees.ts";

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
  ) => Effect.Effect<
    Effect.Effect<void, PiSessionError | RegistryError | RegistryLookupError | WorktreeError>
  >;
  /**
   * Sends `action` to the selected session, starting it with `start` when it is not running,
   * and delivers any `action_result`. Never creates a session. Reuse the current select or
   * create selectionId; a new request id is refused as stale, even for the same hosted session.
   */
  readonly act: (
    selectionId: string,
    action: SessionAction,
    start?: StartOptions,
  ) => Effect.Effect<void, ActRefused | PiSessionError>;
  /** Pi owns the name, so a stopped session is started for it; returns the mirrored title. */
  readonly rename: (
    cwd: string,
    sessionId: string,
    title: string,
  ) => Effect.Effect<string, PiSessionError | RegistryError>;
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

  // Caller holds navigation and has just opened `session`.
  const attachOpened = Effect.fn("ClientSessions.attachOpened")(function* (
    selectionId: string,
    session: PiSession,
  ) {
    const selection = { cwd: session.spec.cwd, sessionId: session.spec.sessionId, selectionId };
    if (current(selection)) {
      selected = selection;
      yield* attachTo(session, selection);
    }
  });

  const show = Effect.fn("ClientSessions.show")(function* (selection: Selection) {
    const { cwd, sessionId, selectionId } = selection;
    const view = sessionId
      ? yield* hosts.read(cwd, sessionId)
      : { _tag: "saved" as const, cwd, snapshot: emptySnapshot("") };
    yield* navigate(
      Effect.gen(function* () {
        if (!current(selection)) return;
        if (view._tag === "live") return yield* attachTo(view.session, selection);
        yield* detach;
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

  // The attached session for this selection, or the selected one started with `start`.
  const target = (selectionId: string, start: StartOptions | undefined) =>
    navigate(
      Effect.gen(function* () {
        if (!selected || selected.selectionId !== selectionId)
          return yield* refuse(
            "stale",
            `${refused.stale} selected.selectionId=${JSON.stringify(selected?.selectionId ?? null)}; act.selectionId=${JSON.stringify(selectionId)}. Reuse the selectionId from the current select or create_session; do not mint a new id for act.`,
          );
        if (attachment?.selectionId === selectionId)
          return yield* applyChoices(attachment.session, start);
        const { cwd, sessionId } = selected;
        // Creating belongs to `create`, which registers the folder and project first.
        if (sessionId === null) return yield* refuse("no_session");
        if (!start) return yield* refuse("not_running");
        // A start reaches browsers as a `hosts` update.
        const { session, launched } = yield* hosts.start({
          cwd,
          sessionId,
          model: start.model,
          thinkingLevel: start.thinkingLevel,
          name: start.name,
        });
        yield* attachOpened(selectionId, session);
        return launched ? session : yield* applyChoices(session, start);
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
    const session = yield* navigate(
      hosts.create(spec).pipe(Effect.tap((session) => attachOpened(selectionId, session))),
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
    rename: hosts.rename,
    retire,
  } satisfies ClientSessions as ClientSessions;
});
