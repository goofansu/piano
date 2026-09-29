/**
 * One browser client. Decodes ClientMessages from the socket, keeps the
 * client's selected session, and forwards SessionEvents from the attached
 * PiSession as ServerMessages. The session module already speaks the wire
 * vocabulary, so this is mostly routing.
 */
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
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
import type { PiSession } from "./PiSessions.ts";
import { Registry } from "./Registry.ts";
import { emptySnapshot, findSessionFile, peekSession } from "./SessionFiles.ts";
import { SessionHosts } from "./SessionHosts.ts";
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
    const hosts = yield* SessionHosts;
    const catalog = yield* Catalog;
    const broadcast = yield* Broadcast;
    const registry = yield* Registry;
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
    let attachment: { session: PiSession; scope: Scope.Closeable } | null = null;

    const detach = Effect.suspend(() => {
      const a = attachment;
      attachment = null;
      return a ? Scope.close(a.scope, Exit.succeed(undefined)) : Effect.void;
    });
    yield* Effect.addFinalizer(() => detach);

    const attachTo = (session: PiSession) =>
      Effect.gen(function* () {
        yield* detach;
        const scope = yield* Scope.make();
        const mine = { session, scope };
        attachment = mine;
        yield* session.events.pipe(
          Stream.runForEach((event) =>
            event._tag === "snapshot"
              ? send({ _tag: "selected", cwd: session.spec.cwd, sessionId: session.spec.sessionId, hosted: true, snapshot: event.snapshot })
              : send({ _tag: "session", event }),
          ),
          // The stream ends when pi is gone; the next message will start it again.
          Effect.ensuring(Effect.sync(() => {
            if (attachment === mine) attachment = null;
          })),
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
        if (!selected) return yield* Effect.fail(new Error("Select a session first"));
        if (!selected.sessionId) selected = { cwd: selected.cwd, sessionId: randomUUID() };
        const { cwd, sessionId } = selected as { cwd: string; sessionId: string };
        const session = yield* hosts.open({ cwd, sessionId, model: options.model, thinkingLevel: options.thinkingLevel, name: options.name });
        yield* registry.addSession(cwd, sessionId, options.name);
        yield* attachTo(session);
        yield* publishProjects;
        return session;
      });

    const handle = (msg: ClientMessage) =>
      Effect.gen(function* () {
        switch (msg._tag) {
          case "projects":
            return yield* send({ _tag: "projects", projects: yield* buildProjects });
          case "models":
            return yield* send({ _tag: "models", catalog: yield* catalog.refresh });
          case "add_project":
            yield* registry.addProject(msg.path);
            return yield* publishProjects;
          case "remove_project":
            yield* registry.removeProject(msg.path);
            return yield* publishProjects;
          case "create_worktree": {
            const wt = yield* createWorktree(msg.project, msg.branch.trim(), { hooks: msg.hooks });
            yield* registry.addWorktree({ project: msg.project, path: wt.path, branch: wt.branch });
            yield* send({ _tag: "worktree_created", project: msg.project, path: wt.path, branch: wt.branch });
            return yield* publishProjects;
          }
          case "select": {
            selected = { cwd: msg.cwd, sessionId: msg.sessionId };
            const running = msg.sessionId ? yield* hosts.get(msg.cwd, msg.sessionId) : undefined;
            if (running) return yield* attachTo(running);
            return yield* showUnhosted(msg.cwd, msg.sessionId);
          }
          case "create_session": {
            const cwd = yield* registry.ensureProject(msg.cwd);
            yield* detach;
            selected = { cwd, sessionId: null };
            const session = yield* start(msg.options);
            const text = msg.text?.trim();
            if (!text) return;
            yield* registry.touchSession(session.spec.cwd, session.spec.sessionId, text);
            yield* publishProjects;
            return yield* session.act({ _tag: "prompt", text });
          }
          case "act": {
            let session = attachment?.session;
            if (!session) {
              if (!msg.start) return yield* Effect.fail(new Error("Session is not running; start it first"));
              session = yield* start(msg.start);
            }
            if (msg.action._tag === "prompt") {
              yield* registry.touchSession(session.spec.cwd, session.spec.sessionId, msg.action.text);
              yield* publishProjects;
            }
            return yield* session.act(msg.action);
          }
          case "delete_session": {
            if (attachment?.session.spec.cwd === msg.cwd && attachment.session.spec.sessionId === msg.sessionId) yield* detach;
            if (yield* hosts.get(msg.cwd, msg.sessionId)) yield* hosts.release(msg.cwd, msg.sessionId);
            const file = yield* findSessionFile(msg.cwd, msg.sessionId);
            if (file) yield* Effect.tryPromise({ try: () => rm(file, { force: true }), catch: (e) => new Error(`Could not delete session file: ${describe(e)}`) });
            yield* registry.removeSession(msg.cwd, msg.sessionId);
            if (selected?.cwd === msg.cwd && selected.sessionId === msg.sessionId) {
              selected = null;
              yield* send({ _tag: "selected", cwd: msg.cwd, sessionId: null, hosted: false, snapshot: emptySnapshot("") });
            }
            yield* send({ _tag: "toast", message: "Session deleted", level: "success" });
            return yield* publishProjects;
          }
          case "archive_session": {
            if (attachment?.session.spec.cwd === msg.cwd && attachment.session.spec.sessionId === msg.sessionId) yield* detach;
            if (yield* hosts.get(msg.cwd, msg.sessionId)) yield* hosts.release(msg.cwd, msg.sessionId);
            yield* registry.archiveSession(msg.cwd, msg.sessionId);
            if (selected?.cwd === msg.cwd && selected.sessionId === msg.sessionId) {
              selected = null;
              yield* send({ _tag: "selected", cwd: msg.cwd, sessionId: null, hosted: false, snapshot: emptySnapshot("") });
            }
            return yield* publishProjects;
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
