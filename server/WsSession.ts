/**
 * One browser client. Decodes ClientMessages from the socket, keeps the
 * client's selected thread, and forwards ThreadEvents from the attached
 * PiThread as ServerMessages. The thread module already speaks the wire
 * vocabulary, so this is mostly routing.
 */
import { randomUUID } from "node:crypto";
import { Cause, Effect, Exit, Queue, Scope, Stream } from "effect";
import type { Socket } from "effect/socket";
import {
  type ClientMessage,
  decodeClientMessage,
  encodeServerMessage,
  type ServerMessage,
  type StartOptions,
} from "../shared/wire.ts";
import { Broadcast } from "./Broadcast.ts";
import { Catalog } from "./Catalog.ts";
import type { PiThread } from "./PiThreads.ts";
import { addProject, removeProject } from "./Projects.ts";
import { emptySnapshot, findSessionFile, peekSession } from "./Sessions.ts";
import { ThreadHosts } from "./ThreadHosts.ts";
import { buildProjects } from "./Views.ts";
import { createWorktree } from "./Worktrees.ts";

const describe = (e: unknown): string => {
  if (e && typeof e === "object") {
    const o = e as { detail?: string; message?: string; _tag?: string };
    return o.detail ?? o.message ?? o._tag ?? String(e);
  }
  return String(e);
};

export const handleSocket = (socket: Socket.Socket) =>
  Effect.gen(function* () {
    const hosts = yield* ThreadHosts;
    const catalog = yield* Catalog;
    const broadcast = yield* Broadcast;
    const reader = yield* socket.reader;
    const writer = yield* socket.writer;

    // Single writer fiber so concurrent producers never interleave frames.
    const outbox = yield* Queue.unbounded<ServerMessage>();
    yield* Stream.fromQueue(outbox).pipe(
      Stream.runForEach((m) => writer.write(encodeServerMessage(m))),
      Effect.ignore,
      Effect.forkScoped,
    );
    const send = (m: ServerMessage) => Queue.offer(outbox, m).pipe(Effect.asVoid);
    const sendError = (e: unknown) =>
      Effect.logWarning(`client error: ${describe(e)}`).pipe(Effect.andThen(send({ _tag: "error", message: describe(e) })));
    const publishProjects = buildProjects.pipe(Effect.flatMap((projects) => broadcast.publish({ _tag: "projects", projects })));

    // ── selection / attachment ──
    let selected: { cwd: string; sessionId: string | null } | null = null;
    let attachment: { thread: PiThread; scope: Scope.Closeable } | null = null;

    const detach = Effect.suspend(() => {
      const a = attachment;
      attachment = null;
      return a ? Scope.close(a.scope, Exit.succeed(undefined)) : Effect.void;
    });
    yield* Effect.addFinalizer(() => detach);

    const attachTo = (thread: PiThread) =>
      Effect.gen(function* () {
        yield* detach;
        const scope = yield* Scope.make();
        yield* hosts.attach(thread.spec.cwd, thread.spec.sessionId).pipe(Scope.provide(scope));
        attachment = { thread, scope };
        yield* thread.events.pipe(
          Stream.runForEach((event) =>
            event._tag === "snapshot"
              ? send({ _tag: "selected", cwd: thread.spec.cwd, sessionId: thread.spec.sessionId, hosted: true, snapshot: event.snapshot })
              : send({ _tag: "thread", event }),
          ),
          Effect.ignore,
          Effect.forkIn(scope),
        );
      });

    const showUnhosted = (cwd: string, sessionId: string | null) =>
      Effect.gen(function* () {
        yield* detach;
        const file = sessionId ? yield* findSessionFile(cwd, sessionId) : undefined;
        const snapshot = file && sessionId ? yield* peekSession(file, sessionId) : emptySnapshot(sessionId ?? "");
        yield* send({ _tag: "selected", cwd, sessionId, hosted: false, snapshot });
      });

    const start = (options: StartOptions) =>
      Effect.gen(function* () {
        if (!selected) return yield* Effect.fail(new Error("Select a thread first"));
        if (!selected.sessionId) selected = { cwd: selected.cwd, sessionId: randomUUID() };
        const thread = yield* hosts.open({ cwd: selected.cwd, sessionId: selected.sessionId as string, model: options.model, name: options.name });
        yield* attachTo(thread);
        yield* publishProjects;
        return thread;
      });

    const handle = (msg: ClientMessage) =>
      Effect.gen(function* () {
        switch (msg._tag) {
          case "projects":
            return yield* send({ _tag: "projects", projects: yield* buildProjects });
          case "models":
            return yield* send({ _tag: "models", catalog: yield* catalog.refresh });
          case "add_project":
            yield* addProject(msg.path);
            return yield* publishProjects;
          case "remove_project":
            yield* removeProject(msg.path);
            return yield* publishProjects;
          case "create_worktree": {
            const wt = yield* createWorktree(msg.project, msg.branch.trim(), { hooks: msg.hooks });
            yield* send({ _tag: "toast", message: `Worktree ${wt.branch} at ${wt.path}` });
            return yield* publishProjects;
          }
          case "select": {
            selected = { cwd: msg.cwd, sessionId: msg.sessionId };
            const running = msg.sessionId ? yield* hosts.get(msg.cwd, msg.sessionId) : undefined;
            if (running) return yield* attachTo(running);
            return yield* showUnhosted(msg.cwd, msg.sessionId);
          }
          case "start":
            yield* start(msg.options);
            return;
          case "act": {
            let thread = attachment?.thread;
            if (!thread) {
              if (!msg.start) return yield* Effect.fail(new Error("Thread is not running; start it first"));
              thread = yield* start(msg.start);
            }
            return yield* thread.act(msg.action);
          }
          case "release": {
            const a = attachment;
            if (!a) return;
            yield* detach;
            yield* hosts.release(a.thread.spec.cwd, a.thread.spec.sessionId);
            yield* publishProjects;
            return yield* showUnhosted(a.thread.spec.cwd, a.thread.spec.sessionId);
          }
        }
      });

    // ── initial state and global updates ──
    yield* send({ _tag: "projects", projects: yield* buildProjects });
    yield* send({ _tag: "hosts", hosts: yield* hosts.list });
    yield* catalog.get.pipe(Effect.flatMap((c) => send({ _tag: "models", catalog: c })), Effect.forkScoped);
    yield* broadcast.stream.pipe(Stream.runForEach(send), Effect.ignore, Effect.forkScoped);
    yield* hosts.changes.pipe(
      Stream.runForEach((list) => send({ _tag: "hosts", hosts: list })),
      Effect.ignore,
      Effect.forkScoped,
    );

    // ── read loop ──
    const decoder = new TextDecoder();
    yield* Effect.gen(function* () {
      const chunks = yield* reader.pull;
      for (const chunk of chunks) {
        const text = typeof chunk === "string" ? chunk : decoder.decode(chunk);
        let msg: ClientMessage;
        try {
          msg = decodeClientMessage(text);
        } catch (e) {
          yield* sendError(e);
          continue;
        }
        // Each message runs in its own fiber: a prompt that opens an extension dialog only
        // gets its response after the dialog is answered, so handling must not serialize.
        yield* handle(msg).pipe(
          Effect.catchCause((cause) => (Cause.hasInterruptsOnly(cause) ? Effect.void : sendError(Cause.squash(cause)))),
          Effect.forkScoped,
        );
      }
    }).pipe(Effect.forever, Effect.catchCause(() => Effect.void));
  }).pipe(Effect.scoped);
