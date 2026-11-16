import { Data, Deferred, Effect, Exit, Scope, Semaphore, Stream } from "effect";
import { emptySnapshot } from "../shared/sessionProjection.ts";
import {
  type Attachment,
  type HostInfo,
  type ServerMessage,
  type SessionAction,
  type SessionReference,
  type StartOptions,
  sameSession,
} from "../shared/wire.ts";
import type { DeliveryOverflow } from "./BoundedDelivery.ts";
import { CreationAttempts } from "./CreationAttempts.ts";
import { bindSessionEvent } from "./ImagePreviews.ts";
import { type PiSession, PiSessionError, sessionActionPolicy } from "./PiSessions.ts";
import { type CreateSpec, SessionHosts, type SessionNotCreated } from "./SessionHosts.ts";

export interface CreateSessionRequest extends Omit<CreateSpec, "attempt"> {
  readonly attemptId?: string;
  readonly text?: string;
  readonly attachments?: ReadonlyArray<Attachment>;
}

export type RetireMode = "archive" | "delete";

export interface Selection {
  readonly attemptId?: string;
  readonly cwd: string;
  readonly sessionId: string | null;
  readonly selectionId: string;
}

export interface ClientOutput {
  readonly send: (message: ServerMessage) => Effect.Effect<void>;
  readonly overflow: (error: DeliveryOverflow) => Effect.Effect<void>;
}

export class ActRefused extends Data.TaggedError("ActRefused")<{
  readonly reason: "stale" | "not_running" | "no_session";
  readonly detail: string;
}> {}

const refused = {
  stale: "Selection changed; inspect the current session before acting.",
  not_running: "Session is not running; start it first.",
  no_session: "No session is selected. Create a session before sending to it.",
} as const;
export class InputNotSent extends Data.TaggedError("InputNotSent")<{
  readonly inputId: string;
  readonly detail: string;
  readonly cause: ActRefused | PiSessionError;
  readonly session?: { readonly cwd: string; readonly sessionId: string };
}> {}

const refuse = (reason: ActRefused["reason"], detail: string = refused[reason]) =>
  Effect.fail(new ActRefused({ reason, detail }));

interface ClientSessions {
  readonly selection: Effect.Effect<Selection | null>;
  readonly select: (selection: Selection) => Effect.Effect<Effect.Effect<void, PiSessionError>>;
  readonly create: (
    request: CreateSessionRequest & { readonly selectionId: string },
  ) => Effect.Effect<Effect.Effect<void, PiSessionError | SessionNotCreated | InputNotSent>>;
  readonly act: (
    selectionId: string,
    action: SessionAction,
    start?: StartOptions,
  ) => Effect.Effect<void, ActRefused | PiSessionError | InputNotSent>;
  readonly recheck: Effect.Effect<void>;
  readonly clearArchived: (
    references: ReadonlyArray<Pick<SessionReference, "cwd" | "sessionId" | "archived">>,
  ) => Effect.Effect<void>;
  readonly retire: (
    cwd: string,
    sessionId: string,
    mode: RetireMode,
  ) => Effect.Effect<void, PiSessionError>;
}

export const makeClientSessions = Effect.fn("ClientSessions.make")(function* (
  output: ClientOutput,
) {
  const hosts = yield* SessionHosts;
  const attempts = yield* CreationAttempts;
  const { send } = output;
  let selected: Selection | null = null;
  let shown: {
    selectionId: string;
    cwd: string;
    checkoutMissing: boolean;
  } | null = null;
  let attachment: {
    session: PiSession;
    scope: Scope.Closeable;
    selectionId: string;
  } | null = null;
  const navigation = yield* Semaphore.make(1);
  const navigate = Semaphore.withPermits(navigation, 1);
  const current = (selection: Selection) => selected?.selectionId === selection.selectionId;
  let superseded = Deferred.makeUnsafe<void>();
  const choose = (next: Selection | null) => {
    if (next?.selectionId !== selected?.selectionId) {
      Deferred.doneUnsafe(superseded, Effect.void);
      superseded = Deferred.makeUnsafe<void>();
    }
    selected = next;
  };
  const claim = (selection: Selection) => Effect.sync(() => choose(selection));
  const unlessSuperseded = <A, E>(selection: Selection, wait: Effect.Effect<A, E>) =>
    Effect.suspend(() =>
      current(selection)
        ? Effect.raceFirst(wait, Deferred.await(superseded).pipe(Effect.as(undefined)))
        : Effect.succeed(undefined),
    );

  const detach = Effect.suspend(() => {
    const a = attachment;
    attachment = null;
    return a ? Scope.close(a.scope, Exit.succeed(undefined)) : Effect.void;
  });
  yield* Effect.addFinalizer(() => detach);

  const attachTo = Effect.fn("ClientSessions.attachTo")(function* (
    session: PiSession,
    selection: Selection,
  ) {
    if (!current(selection)) return;
    shown = {
      selectionId: selection.selectionId,
      cwd: session.spec.cwd,
      checkoutMissing: false,
    };
    yield* detach;
    const scope = yield* Scope.make();
    const mine = { session, scope, selectionId: selection.selectionId };
    attachment = mine;
    const ready = yield* Deferred.make<void>();
    yield* session.events.pipe(
      Stream.runForEach((event) =>
        Effect.gen(function* () {
          bindSessionEvent(session.spec.cwd, session.spec.sessionId, event);
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
      Effect.ensuring(
        Effect.sync(() => {
          if (attachment === mine) attachment = null;
        }),
      ),
      Effect.ignore,
      Effect.forkIn(scope),
    );
    yield* Deferred.await(ready);
  });

  const attachOpened = Effect.fn("ClientSessions.attachOpened")(function* (
    selectionId: string,
    session: PiSession,
  ) {
    const selection = {
      cwd: session.spec.cwd,
      sessionId: session.spec.sessionId,
      selectionId,
    };
    if (!current(selection)) return;
    choose(selection);
    if (attachment?.selectionId === selectionId && attachment.session === session) return;
    yield* attachTo(session, selection);
  });

  const openThenAttach = <A extends { readonly session: PiSession }, E>(
    selectionId: string,
    opening: Effect.Effect<A, E>,
  ) => opening.pipe(Effect.tap(({ session }) => navigate(attachOpened(selectionId, session))));

  const show = Effect.fn("ClientSessions.show")(function* (
    selection: Selection,
  ): Effect.fn.Return<void, PiSessionError> {
    if (!current(selection)) return;
    if (selection.attemptId) return yield* reconcile(selection);
    const { cwd, sessionId, selectionId } = selection;
    const view = sessionId
      ? yield* unlessSuperseded(selection, hosts.read(cwd, sessionId))
      : { _tag: "saved" as const, cwd, snapshot: emptySnapshot("") };
    if (!view) return;
    yield* navigate(
      Effect.gen(function* () {
        if (!current(selection)) return;
        if (view._tag === "live") {
          if (attachment?.selectionId === selectionId && attachment.session === view.session)
            return;
          return yield* attachTo(view.session, selection);
        }
        yield* detach;
        shown = sessionId
          ? {
              selectionId,
              cwd: view.cwd,
              checkoutMissing: !!view.snapshot.state.checkoutMissing,
            }
          : null;
        if (sessionId)
          bindSessionEvent(view.cwd, sessionId, {
            _tag: "snapshot",
            snapshot: view.snapshot,
          });
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

  const reconcile = Effect.fn("ClientSessions.reconcile")(function* (
    selection: Selection,
  ): Effect.fn.Return<void, PiSessionError> {
    const outcome = yield* unlessSuperseded(selection, attempts.outcome(selection.attemptId!));
    if (!outcome || !current(selection)) return;
    switch (outcome._tag) {
      case "failed":
        return yield* send({
          _tag: "selection_rejected",
          selectionId: selection.selectionId,
          inputId: selection.attemptId!,
          message: outcome.detail,
        });
      case "created": {
        const target = {
          cwd: outcome.cwd,
          sessionId: outcome.sessionId,
          selectionId: selection.selectionId,
        };
        yield* navigate(Effect.suspend(() => (current(selection) ? claim(target) : Effect.void)));
        return yield* show(target);
      }
      case "uncertain":
      case "unclaimed":
        return yield* send({
          _tag: "error",
          selectionId: selection.selectionId,
          message:
            outcome._tag === "uncertain"
              ? outcome.detail
              : "Could not confirm the original session start. Nothing was restarted or resent.",
        });
    }
  });

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

  const applyChoices = Effect.fn("ClientSessions.applyChoices")(function* (
    session: PiSession,
    start: StartOptions | undefined,
  ) {
    if (start?.model) yield* session.act({ _tag: "set_model", model: start.model });
    if (start?.thinkingLevel)
      yield* session.act({
        _tag: "set_thinking_level",
        level: start.thinkingLevel,
      });
    return session;
  });

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
        if (sessionId === null) return yield* refuse("no_session");
        if (!start) return yield* refuse("not_running");
        return { _tag: "start" as const, cwd, sessionId, start };
      }),
    );
    if (decided._tag === "attached") return yield* applyChoices(decided.session, start);
    const { cwd, sessionId, start: options } = decided;
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

  const deliver = (session: PiSession, action: SessionAction) =>
    session.act(action).pipe(
      Effect.mapError((cause) =>
        "inputId" in action && action.inputId !== undefined && cause.notSent
          ? new InputNotSent({
              inputId: action.inputId,
              detail: cause.detail,
              cause,
            })
          : cause,
      ),
    );

  const act = Effect.fn("ClientSessions.act")(function* (
    selectionId: string,
    action: SessionAction,
    start?: StartOptions,
  ) {
    const inputId = "inputId" in action ? action.inputId : undefined;
    const session = yield* target(
      selectionId,
      sessionActionPolicy[action._tag].startsPi ? start : undefined,
    ).pipe(
      Effect.mapError((cause) =>
        inputId === undefined ? cause : new InputNotSent({ inputId, detail: cause.detail, cause }),
      ),
    );
    const result = yield* deliver(session, action);
    if (result)
      yield* send({
        _tag: "action_result",
        cwd: session.spec.cwd,
        sessionId: session.spec.sessionId,
        result,
      });
  });

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

  const forget = (
    matches: (selection: { readonly cwd: string; readonly sessionId: string }) => boolean,
  ) =>
    navigate(
      Effect.gen(function* () {
        const selection = selected;
        if (
          !selection?.sessionId ||
          !matches({ cwd: selection.cwd, sessionId: selection.sessionId })
        )
          return;
        choose(null);
        shown = null;
        yield* detach;
        yield* send({
          _tag: "selected",
          selectionId: selection.selectionId,
          cursor: null,
          cwd: selection.cwd,
          sessionId: null,
          hosted: false,
          snapshot: emptySnapshot(""),
        });
      }),
    );

  const retire = Effect.fn("ClientSessions.retire")(function* (
    cwd: string,
    sessionId: string,
    mode: RetireMode,
  ) {
    yield* navigate(
      Effect.suspend(() =>
        attachment && sameSession(attachment.session.spec, { cwd, sessionId })
          ? detach
          : Effect.void,
      ),
    );
    yield* (mode === "delete" ? hosts.delete(cwd, sessionId) : hosts.archive(cwd, sessionId)).pipe(
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
    yield* forget((selection) => sameSession(selection, { cwd, sessionId }));
  });

  const create = Effect.fn("ClientSessions.create")(function* (
    selectionId: string,
    { text, attachments, attemptId, ...spec }: CreateSessionRequest,
  ) {
    const first = (opening: Effect.Effect<PiSession, PiSessionError | SessionNotCreated>) =>
      Effect.gen(function* () {
        const { session } = yield* openThenAttach(
          selectionId,
          opening.pipe(Effect.map((session) => ({ session }))),
        );
        const trimmed = text?.trim() ?? "";
        if (!trimmed && !attachments?.length) return;
        yield* deliver(session, {
          _tag: "prompt",
          text: trimmed,
          attachments,
          inputId: attemptId ?? selectionId,
        }).pipe(
          Effect.mapError((e) =>
            e instanceof InputNotSent
              ? new InputNotSent({
                  inputId: e.inputId,
                  detail: e.detail,
                  cause: e.cause,
                  session: { cwd: session.spec.cwd, sessionId: session.spec.sessionId },
                })
              : e,
          ),
        );
      });
    if (attemptId === undefined) return first(hosts.create(spec));
    const begun = yield* attempts.begin({ ...spec, id: attemptId, text, attachments }, (attempt) =>
      hosts.create({ ...spec, attempt }),
    );
    if (begun._tag === "duplicate")
      return reconcile({ cwd: spec.cwd, sessionId: null, selectionId, attemptId });
    return first(begun.creation);
  });

  return {
    selection: Effect.sync(() => selected),
    select: (selection) => claim(selection).pipe(Effect.as(show(selection))),
    create: ({ selectionId, ...request }) =>
      claim({ cwd: request.cwd, sessionId: null, selectionId }).pipe(
        Effect.andThen(
          create(selectionId, request).pipe(
            Effect.catch((error) => Effect.succeed(Effect.fail(error))),
          ),
        ),
      ),
    act,
    recheck,
    clearArchived: (references) =>
      forget((selection) => references.some((r) => r.archived && sameSession(r, selection))),
    retire,
  } satisfies ClientSessions as ClientSessions;
});
