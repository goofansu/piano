/**
 * One browser client. Decodes ClientMessages from the socket, keeps the
 * client's selected session, and forwards SessionEvents from the attached
 * PiSession as ServerMessages. The session module already speaks the wire
 * vocabulary, so this is mostly routing.
 */
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { Cause, Deferred, Effect, Exit, Scope, Semaphore, Stream } from "effect";
import { Socket } from "effect/socket";
import {
  type ClientMessage,
  decodeClientMessage,
  encodeServerMessage,
  type ServerMessage,
  type StartOptions,
} from "../shared/wire.ts";
import { makeDelivery } from "./BoundedDelivery.ts";
import { Broadcast } from "./Broadcast.ts";
import { Catalog } from "./Catalog.ts";
import { projectDisplay } from "./DisplayProjection.ts";
import { expandHome } from "./PiEnv.ts";
import type { PiSession } from "./PiSessions.ts";
import { projectTrust, setProjectTrust } from "./ProjectTrust.ts";
import { Registry } from "./Registry.ts";
import { emptySnapshot } from "./SessionFiles.ts";
import { SessionHosts } from "./SessionHosts.ts";
import { buildProjects, buildSessionReferences } from "./Views.ts";
import { createWorktree, listWorktrees, WorktreeError } from "./Worktrees.ts";

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

    // Bound both host queues and the transport: ws.send itself has no backpressure.
    // Up to 32 frames / 8 MiB in flight, plus 256 queued frames / 8 MiB
    // and one staging frame (at most 8 MiB) waiting for credit.
    // Cumulative browser acknowledgements avoid stop-and-wait RTT per token.
    const disconnected = yield* Deferred.make<{ reason: string; code: number }>();
    const disconnect = (reason: string, code = 1013) => Deferred.succeed(disconnected, { reason, code }).pipe(Effect.asVoid);
    const outbox = yield* makeDelivery<ServerMessage>();
    let deliveryId = 0;
    const pending = new Map<number, { bytes: number; done: Deferred.Deferred<void> }>();
    let pendingBytes = 0;
    let credit = yield* Deferred.make<void>();
    yield* outbox.stream.pipe(
      Stream.runForEach(m => Effect.gen(function* () {
        const text = encodeServerMessage(projectDisplay(m), ++deliveryId);
        const bytes = Buffer.byteLength(text);
        if (bytes > 8 * 1024 * 1024) return yield* disconnect("Session view exceeds the 8 MiB delivery limit. Reduce the context before reconnecting.", 1009);
        while (pending.size >= 32 || pendingBytes + bytes > 8 * 1024 * 1024) yield* Deferred.await(credit);
        const done = yield* Deferred.make<void>();
        pending.set(deliveryId, { bytes, done }); pendingBytes += bytes;
        yield* writer.write(text);
        // A tail shorter than the window also has a deadline; never retain it forever.
        yield* Deferred.await(done).pipe(Effect.timeout("10 seconds"),
          Effect.catchCause(() => disconnect("Delivery acknowledgement timed out; reconnect for a current snapshot.")), Effect.forkScoped);
      })),
      Effect.raceFirst(outbox.failure),
      Effect.catchTag("DeliveryOverflow", error => disconnect(error.detail, error.oversized ? 1009 : 1013)),
      Effect.catchCause(() => disconnect("Delivery interrupted; reconnect for a current snapshot.")),
      Effect.forkScoped,
    );
    const send = outbox.offer;
    const sendError = (e: unknown, selectionId?: string) =>
      Effect.logWarning(`client error: ${describe(e)}`).pipe(Effect.andThen(send({ _tag: "error", message: describe(e), selectionId })));
    const publishProjects = buildProjects.pipe(Effect.flatMap(projects => Effect.gen(function* () {
      const observed = yield* buildSessionReferences;
      // Filesystem reads may overlap a membership edit. Publish the latest metadata,
      // never a grouping snapshot captured before those asynchronous observations.
      const data = yield* registry.get;
      const sessionReferences = data.sessions.map(s => ({ ...s, unavailable: observed.find(o => o.cwd === s.cwd && o.sessionId === s.sessionId)?.unavailable }));
      yield* broadcast.publish({ _tag: "projects", projects, outcomeProjects: data.outcomeProjects, sessionReferences, workspaces: data.workspaces });
    })));

    // ── selection / attachment ──
    type Selection = { cwd: string; sessionId: string | null; selectionId: string };
    let selected: Selection | null = null;
    let attachment: { session: PiSession; scope: Scope.Closeable; selectionId: string } | null = null;
    const navigation = yield* Semaphore.make(1);
    const current = (selection: Selection) => selected?.selectionId === selection.selectionId;

    const detach = Effect.suspend(() => {
      const a = attachment;
      attachment = null;
      return a ? Scope.close(a.scope, Exit.succeed(undefined)) : Effect.void;
    });
    yield* Effect.addFinalizer(() => detach);
    const detachSession = (cwd: string, sessionId: string) => Semaphore.withPermits(navigation, 1)(Effect.suspend(() =>
      attachment?.session.spec.cwd === cwd && attachment.session.spec.sessionId === sessionId ? detach : Effect.void));

    // Caller holds navigation; slow lookup/start happens before stale-result checks.
    const attachTo = (session: PiSession, selection: Selection) =>
      Effect.gen(function* () {
        if (!current(selection)) return;
        yield* detach;
        const scope = yield* Scope.make();
        const mine = { session, scope, selectionId: selection.selectionId };
        attachment = mine;
        const ready = yield* Deferred.make<void>();
        yield* session.events.pipe(
          Stream.runForEach((event) => Effect.gen(function* () {
            if (current(selection)) yield* event._tag === "snapshot"
              ? send({ _tag: "selected", selectionId: selection.selectionId, cursor: event.cursor, cwd: session.spec.cwd, sessionId: session.spec.sessionId, hosted: !event.snapshot.state.closedReason, snapshot: event.snapshot })
              : send({ _tag: "session", selectionId: selection.selectionId, cursor: event.cursor, event });
            if (event._tag === "snapshot") yield* Deferred.succeed(ready, undefined);
          })),
          Effect.catchTag("DeliveryOverflow", error => disconnect(error.detail, error.oversized ? 1009 : 1013)),
          Effect.ensuring(Deferred.succeed(ready, undefined)),
          // The stream ends when Pi is gone; the next message will start it again.
          Effect.ensuring(Effect.sync(() => {
            if (attachment === mine) attachment = null;
          })),
          Effect.ignore,
          Effect.forkIn(scope),
        );
        // A fast first prompt must not complete before this client observes it.
        yield* Deferred.await(ready);
      });

    const show = (selection: Selection) => Effect.gen(function* () {
      const { cwd, sessionId, selectionId } = selection;
      const running = sessionId ? yield* hosts.get(cwd, sessionId) : undefined;
      const view = running ? undefined : sessionId ? yield* hosts.peek(cwd, sessionId) : { cwd, snapshot: emptySnapshot("") };
      yield* Semaphore.withPermits(navigation, 1)(Effect.gen(function* () {
        if (!current(selection)) return;
        if (running) return yield* attachTo(running, selection);
        yield* detach;
        yield* send({ _tag: "selected", selectionId, cursor: null, cwd: view!.cwd, sessionId, hosted: false, snapshot: view!.snapshot });
      }));
    });

    const start = (selection: Selection, options: StartOptions) =>
      Effect.gen(function* () {
        const create = selection.sessionId === null;
        const { cwd } = selection;
        const sessionId = selection.sessionId ?? randomUUID();
        const session = yield* hosts.open({ cwd, sessionId, create, model: options.model, thinkingLevel: options.thinkingLevel, name: options.name });
        if (current(selection)) {
          selected = { cwd: session.spec.cwd, sessionId, selectionId: selection.selectionId };
          yield* attachTo(session, selection);
        }
        yield* publishProjects;
        return session;
      });

    const handle = (msg: ClientMessage) =>
      Effect.gen(function* () {
        switch (msg._tag) {
          case "projects":
            return yield* publishProjects;
          case "worktrees": {
            const discovery = (yield* registry.get).projects.includes(msg.project) ? yield* listWorktrees(msg.project)
              : { status: "error" as const, observedAt: new Date().toISOString(), detail: "Select a registered project first." };
            return yield* send({ _tag: "worktrees", project: msg.project, discovery });
          }
          case "models": {
            const cwd = resolve(expandHome(msg.cwd ?? selected?.cwd ?? homedir()));
            return yield* send({ _tag: "models", catalog: yield* (msg.refresh ? catalog.refresh(cwd) : catalog.get(cwd)) });
          }
          case "save_outcome_project":
            yield* registry.saveOutcomeProject(msg.project);
            return yield* publishProjects;
          case "archive_outcome_project":
            yield* registry.archiveOutcomeProject(msg.id, msg.archived);
            return yield* publishProjects;
          case "assign_project":
            yield* registry.assignProject(msg.cwd, msg.sessionId, msg.projectId);
            return yield* publishProjects;
          case "add_project":
            yield* registry.addProject(msg.path);
            return yield* publishProjects;
          case "remove_project":
            yield* registry.removeProject(msg.path);
            return yield* publishProjects;
          case "trust": {
            const cwd = resolve(expandHome(msg.cwd));
            return yield* send({ _tag: "trust", cwd, trust: yield* projectTrust(cwd) });
          }
          case "set_trust": {
            const path = resolve(expandHome(msg.path));
            yield* setProjectTrust(path, msg.trusted).pipe(
              Effect.andThen(send({ _tag: "toast", level: "success", message: msg.trusted ? "Trusted. Sessions started from now load this folder's Pi settings and skills." : "Untrusted. Sessions started from now skip this folder's Pi settings and skills." })),
              Effect.catchTag("ProjectTrustError", e => sendError(e.detail)));
            yield* send({ _tag: "models", catalog: yield* catalog.refresh(path) });
            yield* send({ _tag: "trust", cwd: path, trust: yield* projectTrust(path) });
            return yield* publishProjects;
          }
          case "create_worktree":
          case "add_worktree": {
            yield* Effect.gen(function* () {
              if (!(yield* registry.get).projects.includes(msg.project)) return yield* new WorktreeError({ detail: "Select a registered project first." });
              const result = msg._tag === "create_worktree"
                ? yield* createWorktree(msg.project, msg.branch.trim(), { hooks: msg.hooks }).pipe(Effect.map(w => ({
                    status: "ready" as const, project: msg.project, path: w.path, branch: w.branch,
                    creation: { baseBranch: w.baseBranch, hooks: w.hooks },
                  })))
                : yield* Effect.gen(function* () {
                    const discovery = yield* listWorktrees(msg.project);
                    if (discovery.status !== "ready") return yield* new WorktreeError({ detail: discovery.status === "error" ? discovery.detail : "This project is non-Git." });
                    const w = discovery.worktrees.find(w => w.path === msg.path);
                    if (!w || w.prunable) return yield* new WorktreeError({ detail: "This checkout is absent or unavailable. Refresh discovery and inspect it before selecting." });
                    return { status: "ready" as const, project: msg.project, path: w.path, branch: w.branch };
                  });
              if (result.path !== msg.project) yield* registry.addWorktree({ project: msg.project, path: result.path, branch: result.branch ?? "" });
              yield* send({ _tag: "worktree_result", requestId: msg.requestId, result });
            }).pipe(Effect.catchTag("WorktreeError", e => send({ _tag: "worktree_result", requestId: msg.requestId, result: { status: "error", detail: e.detail } })));
            // Failure may have left a checkout behind. Refresh rather than retrying a mutation.
            return yield* publishProjects;
          }
          case "ack": {
            if (!pending.has(msg.deliveryId)) return;
            for (const [id, item] of pending) if (id <= msg.deliveryId) {
              pending.delete(id); pendingBytes -= item.bytes;
              yield* Deferred.succeed(item.done, undefined);
            }
            const available = credit;
            credit = yield* Deferred.make<void>();
            yield* Deferred.succeed(available, undefined);
            return;
          }
          case "select":
            return yield* show(msg);
          case "create_session": {
            if (msg.outcomeProjectId && !(yield* registry.get).outcomeProjects.some(p => p.id === msg.outcomeProjectId && !p.archived)) return yield* Effect.fail(new Error("Project is unavailable or archived. Choose a current project before starting."));
            const cwd = yield* registry.ensureProject(msg.cwd);
            const session = yield* Semaphore.withPermits(navigation, 1)(start({ cwd, sessionId: null, selectionId: msg.selectionId }, msg.options));
            if (msg.outcomeProjectId) {
              yield* registry.assignProject(session.spec.cwd, session.spec.sessionId, msg.outcomeProjectId);
              yield* publishProjects;
            }
            const text = msg.text?.trim() ?? "";
            if (!text && !msg.attachments?.length) return;
            yield* registry.touchSession(session.spec.cwd, session.spec.sessionId, text);
            yield* publishProjects;
            return yield* session.act({ _tag: "prompt", text, attachments: msg.attachments });
          }
          case "act": {
            const session = yield* Semaphore.withPermits(navigation, 1)(Effect.gen(function* () {
              if (!selected || selected.selectionId !== msg.selectionId) return yield* Effect.fail(new Error("Selection changed; inspect the current session before acting."));
              if (attachment?.selectionId === msg.selectionId) return attachment.session;
              if (!msg.start) return yield* Effect.fail(new Error("Session is not running; start it first"));
              return yield* start(selected, msg.start);
            }));
            if (msg.action._tag === "prompt" || msg.action._tag === "steer") {
              yield* registry.touchSession(session.spec.cwd, session.spec.sessionId, msg.action.text);
              yield* publishProjects;
            }
            const result = yield* session.act(msg.action);
            if (result) yield* send({ _tag: "action_result", cwd: session.spec.cwd, sessionId: session.spec.sessionId, result });
            return;
          }
          case "delete_session": {
            yield* detachSession(msg.cwd, msg.sessionId);
            yield* hosts.delete(msg.cwd, msg.sessionId);
            if (selected?.cwd === msg.cwd && selected.sessionId === msg.sessionId) {
              const selectionId = selected.selectionId;
              selected = null;
              yield* send({ _tag: "selected", selectionId, cursor: null, cwd: msg.cwd, sessionId: null, hosted: false, snapshot: emptySnapshot("") });
            }
            yield* send({ _tag: "toast", message: "Session deleted", level: "success" });
            return yield* publishProjects;
          }
          case "rename_session": {
            // The name belongs to Pi's history, so a stopped session is started for it; the host
            // releases it again when idle. The registry title follows what Pi recorded.
            const session = (yield* hosts.get(msg.cwd, msg.sessionId)) ?? (yield* hosts.open({ cwd: msg.cwd, sessionId: msg.sessionId }));
            yield* session.act({ _tag: "set_name", name: msg.title });
            const state = yield* session.state;
            yield* registry.renameSession(session.spec.cwd, session.spec.sessionId, state.sessionName ?? msg.title);
            return yield* publishProjects;
          }
          case "archive_session": {
            yield* detachSession(msg.cwd, msg.sessionId);
            yield* hosts.archive(msg.cwd, msg.sessionId);
            if (selected?.cwd === msg.cwd && selected.sessionId === msg.sessionId) {
              const selectionId = selected.selectionId;
              selected = null;
              yield* send({ _tag: "selected", selectionId, cursor: null, cwd: msg.cwd, sessionId: null, hosted: false, snapshot: emptySnapshot("") });
            }
            return yield* publishProjects;
          }
        }
      });

    // ── initial state and global updates ──
    // Worktree discovery can take seconds in a large repository. Show the last observation at
    // once and let a fresh one follow, so it never holds up the page or this socket's requests.
    const updates = yield* broadcast.subscribe;
    const last = yield* broadcast.latest;
    if (last) yield* send(last);
    yield* send({ _tag: "hosts", hosts: yield* hosts.list });
    // The browser requests models for its selected cwd; home cannot establish
    // project-local providers/resources and must not stand in for that catalog.
    yield* updates.pipe(Stream.runForEach(send), Effect.ignore, Effect.forkScoped);
    yield* catalog.changes.pipe(Stream.runForEach(() => send({ _tag: "catalogs_invalidated" })), Effect.ignore, Effect.forkScoped);
    yield* publishProjects.pipe(Effect.forkScoped);
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
        // Claim selection in receive order, before any asynchronous lookup can finish.
        if (msg._tag === "select" || msg._tag === "create_session") {
          selected = { cwd: msg.cwd, sessionId: msg._tag === "select" ? msg.sessionId : null, selectionId: msg.selectionId };
        }
        // Each message runs in its own fiber: a prompt that opens an extension dialog only
        // gets its response after the dialog is answered, so handling must not serialize.
        yield* handle(msg).pipe(
          Effect.catchCause((cause) => (Cause.hasInterruptsOnly(cause) ? Effect.void : sendError(Cause.squash(cause), "selectionId" in msg ? msg.selectionId : undefined))),
          Effect.forkScoped,
        );
      }
    }).pipe(Effect.forever, Effect.catchCause(() => Effect.void), Effect.raceFirst(
      Deferred.await(disconnected).pipe(Effect.flatMap(({ reason, code }) => writer.write(new Socket.CloseEvent(code, reason)).pipe(Effect.ignore))),
    ));
  }).pipe(Effect.scoped);
