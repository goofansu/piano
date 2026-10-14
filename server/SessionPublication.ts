/**
 * SessionPublication: one open session's snapshot and its live frames (INV-05: a snapshot and the
 * frames after it share one ordered boundary). It owns the snapshot fold, the lock, sequence
 * numbers and the cursor, subscriber attachment and the closure announcement. Under the lock a
 * subscriber attaches and receives the current snapshot with its cursor, then every later frame
 * in order. Publish never waits on a browser: a subscriber that falls behind fails
 * DeliveryOverflow and attaches again. Internal to PiSessions, which owns the child, the projector
 * and actions; SessionReadbacks and SessionDialogs land their work through it.
 */
import { Effect, Ref, Semaphore, Stream } from "effect";
import { applySessionEvent, isWorking } from "../shared/sessionProjection.ts";
import type { Dialog, SessionEvent, SessionFrame, SessionState, Snapshot } from "../shared/wire.ts";
import { type DeliveryOverflow, makeDelivery } from "./BoundedDelivery.ts";
import { projectSessionEvent, projectSnapshot } from "./DisplayProjection.ts";

export interface SessionPublicationOptions {
  readonly cwd: string;
  readonly sessionId: string;
  /** This open's generation, carried by every cursor. */
  readonly generation: string;
  /** The snapshot a subscriber attaching before any event receives. */
  readonly initial: Snapshot;
}

/** A published state change: the state before it and after it. */
export type StateChangeListener = (previous: SessionState, next: SessionState) => void;

const transactionBrand: unique symbol = Symbol("PublicationTransaction");

/** Only supplied by `transaction`. Use inline: never retain it or fork work with it. */
export interface PublicationTransaction {
  readonly [transactionBrand]: true;
  /** Fold one event into the snapshot and send it to every subscriber. */
  readonly publish: (event: SessionEvent) => Effect.Effect<void>;
  /** Merge state fields and publish the result if anything changed, telling every
   * `onStateChange` listener first. Working or a model change makes the context figure last known. */
  readonly mergeState: (patch: Partial<SessionState>) => Effect.Effect<void>;
}

export interface SessionPublication {
  /** No frame is published or subscriber attached meanwhile. Never await Pi/a browser,
   * nest transactions, or fork work here. The capability belongs to this callback only. */
  readonly transaction: <A, E, R>(
    use: (transaction: PublicationTransaction) => Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, R>;
  /** Take the lock, then publish each event; a thunk is evaluated under the lock. */
  readonly apply: (
    events: ReadonlyArray<SessionEvent> | (() => ReadonlyArray<SessionEvent>),
  ) => Effect.Effect<void>;
  /** Take the lock, then `mergeState`; a thunk is evaluated under the lock. */
  readonly patchState: (
    patch: Partial<SessionState> | (() => Partial<SessionState>),
  ) => Effect.Effect<void>;
  /** Hear every state change `mergeState` publishes, under the lock. */
  readonly onStateChange: (listener: StateChangeListener) => void;
  readonly snapshot: Effect.Effect<Snapshot>;
  readonly state: Effect.Effect<SessionState>;
  readonly dialogs: Effect.Effect<ReadonlyArray<Dialog>>;
  /** True once subscribers have been told Pi is gone. */
  readonly announced: () => boolean;
  /** Mark Pi as gone; true only for the first caller, which publishes the closure. */
  readonly announce: () => boolean;
  /** The snapshot with its cursor, then contiguous live frames until `closed`. `present` sets the
   * snapshot's state from the retained one, under the lock. */
  readonly subscribe: (
    present: (snapshot: Snapshot) => SessionState,
  ) => Stream.Stream<SessionFrame, DeliveryOverflow>;
}

export const makeSessionPublication = Effect.fn("SessionPublication.make")(function* ({
  cwd,
  sessionId,
  generation,
  initial,
}: SessionPublicationOptions): Effect.fn.Return<SessionPublication> {
  // Everything a subscriber's snapshot holds except host observations, kept by the shared fold.
  const snapshotRef = yield* Ref.make<Snapshot>(initial);
  const lock = yield* Semaphore.make(1);
  const locked = Semaphore.withPermits(lock, 1);
  const subscribers = new Set<Effect.Success<ReturnType<typeof makeDelivery<SessionFrame>>>>();
  const listeners: StateChangeListener[] = [];
  let sequence = 0;
  let announced = false;
  const cursor = () => ({ cwd, sessionId, generation, sequence });
  const state = Effect.map(Ref.get(snapshotRef), (snapshot) => snapshot.state);

  const publish = Effect.fnUntraced(function* (event: SessionEvent) {
    yield* Ref.update(snapshotRef, (snapshot) => applySessionEvent(snapshot, event));
    sequence++;
    const frame: SessionFrame = { ...projectSessionEvent(event), cursor: cursor() };
    for (const subscriber of subscribers) yield* subscriber.offer(frame);
  });

  const mergeState = Effect.fnUntraced(function* (patch: Partial<SessionState>) {
    const current = yield* state;
    const next = { ...current, ...patch };
    if (isWorking(next) || next.model !== current.model) next.contextIsLastKnown = true;
    if (JSON.stringify(next) === JSON.stringify(current)) return;
    for (const listener of listeners) listener(current, next);
    yield* publish({ _tag: "state", state: next });
  });

  const transaction: SessionPublication["transaction"] = (use) =>
    locked(Effect.suspend(() => use({ [transactionBrand]: true, publish, mergeState })));

  return {
    transaction,
    apply: (events) =>
      locked(
        Effect.gen(function* () {
          for (const event of typeof events === "function" ? events() : events)
            yield* publish(event);
        }),
      ),
    patchState: (patch) =>
      locked(Effect.suspend(() => mergeState(typeof patch === "function" ? patch() : patch))),
    onStateChange: (listener) => {
      listeners.push(listener);
    },
    snapshot: Ref.get(snapshotRef),
    state,
    dialogs: Effect.map(Ref.get(snapshotRef), (snapshot) => snapshot.dialogs),
    announced: () => announced,
    announce: () => {
      if (announced) return false;
      announced = true;
      return true;
    },
    subscribe: (present) =>
      Stream.unwrap(
        locked(
          Effect.gen(function* () {
            const sub = yield* makeDelivery<SessionFrame>();
            subscribers.add(sub);
            const retained = yield* Ref.get(snapshotRef);
            const snapshot: Snapshot = { ...retained, state: present(retained) };
            return Stream.make<[SessionFrame]>({
              _tag: "snapshot",
              snapshot: projectSnapshot(snapshot),
              cursor: cursor(),
            }).pipe(
              Stream.concat(snapshot.state.closure ? Stream.empty : sub.stream),
              Stream.takeUntil((e) => e._tag === "closed"),
              Stream.ensuring(
                Effect.sync(() => {
                  subscribers.delete(sub);
                }),
              ),
            );
          }),
        ),
      ),
  };
});
