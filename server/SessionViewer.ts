/**
 * One browser client's view of sessions: which session it has selected and the live
 * attachment that forwards that session's frames. Selections are claimed in receive
 * order, so a slow lookup for an older selection never shows or acts on a newer one.
 * Attaching delivers the snapshot, then contiguous frames (INV-05), and returns only once
 * the snapshot is delivered, so a fast first prompt is observed. Starting goes through
 * SessionHosts, which keeps one child per session (INV-02).
 */
import { randomUUID } from "node:crypto";
import { Deferred, Effect, Exit, Scope, Semaphore, Stream } from "effect";
import type { ServerMessage, StartOptions } from "../shared/wire.ts";
import type { DeliveryOverflow } from "./BoundedDelivery.ts";
import type { PiSession, PiSessionError } from "./PiSessions.ts";
import { emptySnapshot } from "./SessionFiles.ts";
import { SessionHosts } from "./SessionHosts.ts";

export interface Selection {
  readonly cwd: string;
  /** `null` is a new session that is not started yet. */
  readonly sessionId: string | null;
  readonly selectionId: string;
}

export type ViewerMessage = Extract<ServerMessage, { _tag: "selected" | "session" }>;

export interface ViewerOutput {
  readonly deliver: (message: ViewerMessage) => Effect.Effect<void>;
  /** The client fell behind the attached session; the connection should close. */
  readonly overflow: (error: DeliveryOverflow) => Effect.Effect<void>;
}

export class StaleSelection extends Error {
  constructor() { super("Selection changed; inspect the current session before acting."); }
}

export interface SessionViewer {
  /** Claims the selection at once; the returned effect loads it and shows it if it is still current. */
  readonly select: (selection: Selection) => Effect.Effect<Effect.Effect<void, PiSessionError>>;
  /** Claims a new-session selection at once; the returned function attaches the opened session if it is still current. */
  readonly create: (selection: { readonly cwd: string; readonly selectionId: string }) =>
    Effect.Effect<<E>(open: Effect.Effect<PiSession, E>) => Effect.Effect<PiSession, E>>;
  /** The session to act on for this selection, started with `start` when it is not running. */
  readonly act: (selectionId: string, start?: StartOptions) =>
    Effect.Effect<{ readonly session: PiSession; readonly started: boolean }, StaleSelection | Error | PiSessionError>;
  /** Detach a session before `retire` stops it, then clear the selection if it showed that session. */
  readonly forget: <E>(cwd: string, sessionId: string, retire: Effect.Effect<void, E>) => Effect.Effect<void, E>;
  /** The selected checkout, if any. */
  readonly cwd: Effect.Effect<string | undefined>;
}

/** Lives until the surrounding scope closes, which detaches the attachment. */
export const makeSessionViewer = (output: ViewerOutput) => Effect.gen(function* () {
  const hosts = yield* SessionHosts;
  const { deliver } = output;
  let selected: Selection | null = null;
  let attachment: { session: PiSession; scope: Scope.Closeable; selectionId: string } | null = null;
  // Serializes attach, detach and the stale checks that decide between them.
  const navigation = yield* Semaphore.make(1);
  const navigate = Semaphore.withPermits(navigation, 1);
  const current = (selection: Selection) => selected?.selectionId === selection.selectionId;
  const claim = (selection: Selection) => Effect.sync(() => { selected = selection; });

  const detach = Effect.suspend(() => {
    const a = attachment;
    attachment = null;
    return a ? Scope.close(a.scope, Exit.succeed(undefined)) : Effect.void;
  });
  yield* Effect.addFinalizer(() => detach);

  // Caller holds navigation; slow lookup/start happens before stale-result checks.
  const attachTo = (session: PiSession, selection: Selection) => Effect.gen(function* () {
    if (!current(selection)) return;
    yield* detach;
    const scope = yield* Scope.make();
    const mine = { session, scope, selectionId: selection.selectionId };
    attachment = mine;
    const ready = yield* Deferred.make<void>();
    yield* session.events.pipe(
      Stream.runForEach(event => Effect.gen(function* () {
        if (current(selection)) yield* event._tag === "snapshot"
          ? deliver({ _tag: "selected", selectionId: selection.selectionId, cursor: event.cursor, cwd: session.spec.cwd, sessionId: session.spec.sessionId, hosted: !event.snapshot.state.closedReason, snapshot: event.snapshot })
          : deliver({ _tag: "session", selectionId: selection.selectionId, cursor: event.cursor, event });
        if (event._tag === "snapshot") yield* Deferred.succeed(ready, undefined);
      })),
      Effect.catchTag("DeliveryOverflow", output.overflow),
      Effect.ensuring(Deferred.succeed(ready, undefined)),
      // The stream ends when Pi is gone; the next action will start it again.
      Effect.ensuring(Effect.sync(() => {
        if (attachment === mine) attachment = null;
      })),
      Effect.ignore,
      Effect.forkIn(scope),
    );
    // A fast first prompt must not complete before this client observes it.
    yield* Deferred.await(ready);
  });

  // Caller holds navigation.
  const attachOpened = <E>(selectionId: string, open: Effect.Effect<PiSession, E>) => Effect.gen(function* () {
    const session = yield* open;
    const selection = { cwd: session.spec.cwd, sessionId: session.spec.sessionId, selectionId };
    if (current(selection)) {
      selected = selection;
      yield* attachTo(session, selection);
    }
    return session;
  });

  const show = (selection: Selection) => Effect.gen(function* () {
    const { cwd, sessionId, selectionId } = selection;
    const running = sessionId ? yield* hosts.get(cwd, sessionId) : undefined;
    const view = running ? undefined : sessionId ? yield* hosts.peek(cwd, sessionId) : { cwd, snapshot: emptySnapshot("") };
    yield* navigate(Effect.gen(function* () {
      if (!current(selection)) return;
      if (running) return yield* attachTo(running, selection);
      yield* detach;
      yield* deliver({ _tag: "selected", selectionId, cursor: null, cwd: view!.cwd, sessionId, hosted: false, snapshot: view!.snapshot });
    }));
  });

  return {
    select: selection => claim(selection).pipe(Effect.as(show(selection))),
    create: ({ cwd, selectionId }) => claim({ cwd, sessionId: null, selectionId }).pipe(
      Effect.as(<E>(open: Effect.Effect<PiSession, E>) => navigate(attachOpened(selectionId, open)))),
    act: (selectionId, start) => navigate(Effect.gen(function* () {
      if (!selected || selected.selectionId !== selectionId) return yield* Effect.fail(new StaleSelection());
      if (attachment?.selectionId === selectionId) return { session: attachment.session, started: false };
      if (!start) return yield* Effect.fail(new Error("Session is not running; start it first"));
      const { cwd, sessionId } = selected;
      const session = yield* attachOpened(selectionId, hosts.open({
        cwd, sessionId: sessionId ?? randomUUID(), create: sessionId === null,
        model: start.model, thinkingLevel: start.thinkingLevel, name: start.name,
      }));
      return { session, started: true };
    })),
    forget: (cwd, sessionId, retire) => Effect.gen(function* () {
      yield* navigate(Effect.suspend(() =>
        attachment?.session.spec.cwd === cwd && attachment.session.spec.sessionId === sessionId ? detach : Effect.void));
      yield* retire;
      if (selected?.cwd !== cwd || selected.sessionId !== sessionId) return;
      const selectionId = selected.selectionId;
      selected = null;
      yield* deliver({ _tag: "selected", selectionId, cursor: null, cwd, sessionId: null, hosted: false, snapshot: emptySnapshot("") });
    }),
    cwd: Effect.sync(() => selected?.cwd),
  } satisfies SessionViewer as SessionViewer;
});
