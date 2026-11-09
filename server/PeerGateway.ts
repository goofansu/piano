/**
 * Same-origin attachment to one configured Piano. No Pi protocol, local registry lookup,
 * mutation retry, delivery renumbering or remote process ownership lives here (INV-01/02/05).
 */
import { WebSocket } from "@effect/platform-node/NodeWS";
import { Data, Effect, Redacted, Schema } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { Socket } from "effect/socket";
import { Endpoints } from "../shared/http.ts";
import {
  ClientMessageJson,
  decodeServerMessage,
  type ClientMessage,
  type ServerMessage,
  sessionKey,
} from "../shared/wire.ts";
import { ConfiguredPeer, type PeerConfig } from "./PeerConfig.ts";

const limits = {
  connectMs: 5_000,
  requestMs: 10_000,
  clientBytes: 1024 * 1024,
  serverBytes: 8 * 1024 * 1024,
  bufferedFrames: 64,
  ackMs: 15_000,
};
class PeerFailure extends Data.TaggedError("PeerFailure")<{
  readonly message: string;
  readonly code: number;
}> {}
const unavailable = () =>
  new PeerFailure({ message: "Remote Piano is unavailable or incompatible.", code: 1011 });
const refused = () =>
  new PeerFailure({
    message: "This request is not supported for this remote machine.",
    code: 1008,
  });
const overflow = () =>
  new PeerFailure({
    message: "Remote connection capacity exceeded; reconnect for a snapshot.",
    code: 1013,
  });
const envelope = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      _tag: Schema.String,
      deliveryId: Schema.Number,
    }),
  ),
);
const decodeInput = Schema.decodeUnknownSync(ClientMessageJson);
type RegistryFrame = Extract<ServerMessage, { _tag: "registry" }>;

/** Keep raw text intact, including fields this version does not interpret. */
function inspectFrame(text: string) {
  const frame = envelope(text);
  if (!Number.isSafeInteger(frame.deliveryId) || frame.deliveryId <= 0) throw unavailable();
  if (frame._tag !== "registry") return { deliveryId: frame.deliveryId };
  const registry = decodeServerMessage(text);
  if (registry._tag !== "registry" || !registry.sessionReferences || !registry.workspaces)
    throw unavailable();
  return { deliveryId: frame.deliveryId, registry };
}

function listed(registry: RegistryFrame, cwd: string, sessionId: string) {
  return (
    registry.sessionReferences?.some((ref) => ref.cwd === cwd && ref.sessionId === sessionId) ===
    true
  );
}
function registered(registry: RegistryFrame, cwd: string) {
  return registry.workspaces?.some((workspace) => workspace.path === cwd) === true;
}

/** Only startup configuration can supply upstream authentication. Never forward caller headers. */
const upstreamHeaders = (peer: PeerConfig) => ({
  Origin: peer.origin,
  ...(peer.vmToken ? { "X-Exedev-Authorization": `Bearer ${Redacted.value(peer.vmToken)}` } : {}),
});

const connect = Effect.fn("PeerGateway.connect")(
  function* (peer: PeerConfig) {
    const url = new URL("/ws", peer.endpoint);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const ws = yield* Effect.acquireRelease(
      Effect.sync(
        () =>
          new WebSocket(url, {
            headers: upstreamHeaders(peer),
            followRedirects: false,
            handshakeTimeout: limits.connectMs,
            maxPayload: limits.serverBytes,
            perMessageDeflate: false,
          }),
      ),
      (ws) =>
        Effect.sync(() => {
          // End only this attachment, even during a failed handshake. Never send stop/abort.
          ws.on("error", () => {});
          ws.terminate();
        }),
    );
    const socket = yield* Socket.fromWebSocket(Effect.succeed(ws), { highWaterMark: 64 * 1024 });
    const reader = yield* socket.reader;
    const initial: string[] = [];
    let initialBytes = 0;
    let registry: RegistryFrame | undefined;
    // Existing Piano may send hosts before registry. Hold that bounded prelude, not a second
    // delivery stream: the browser will acknowledge the original IDs after admission.
    while (!registry) {
      for (const chunk of yield* reader.pull) {
        if (typeof chunk !== "string") return yield* Effect.fail(unavailable());
        initialBytes += Buffer.byteLength(chunk);
        if (initialBytes > limits.serverBytes || initial.length >= limits.bufferedFrames)
          return yield* Effect.fail(overflow());
        const frame = yield* Effect.try({ try: () => inspectFrame(chunk), catch: unavailable });
        if (frame.registry) registry = frame.registry;
        initial.push(chunk);
      }
    }
    const send = (text: string) =>
      Effect.callback<void, PeerFailure>((resume) => {
        if (
          ws.readyState !== WebSocket.OPEN ||
          ws.bufferedAmount + Buffer.byteLength(text) > limits.clientBytes
        ) {
          resume(Effect.fail(overflow()));
          return;
        }
        ws.send(text, (error) => resume(error ? Effect.fail(unavailable()) : Effect.void));
      }).pipe(
        Effect.timeout(limits.requestMs),
        Effect.catch(() => Effect.fail(unavailable())),
      );
    return { reader, send, initial, registry };
  },
  Effect.timeout(limits.connectMs),
  Effect.catch(() => Effect.fail(unavailable())),
);

const bridge = Effect.fn("PeerGateway.bridge")(function* (
  browser: Socket.Socket,
  upstream: Effect.Success<ReturnType<typeof connect>>,
) {
  const reader = yield* browser.reader;
  const writer = yield* browser.writer;
  let registry = upstream.registry;
  let selection: { selectionId: string; cwd: string; sessionId: string } | undefined;
  let lastDeliveryId = 0;
  let pendingBytes = 0;
  const pending = new Map<number, { bytes: number; at: number }>();
  const forward = Effect.fnUntraced(function* (text: string) {
    const bytes = Buffer.byteLength(text);
    if (bytes > limits.serverBytes) return yield* Effect.fail(overflow());
    const frame = yield* Effect.try({ try: () => inspectFrame(text), catch: unavailable });
    if (frame.deliveryId <= lastDeliveryId) return yield* Effect.fail(unavailable());
    if (pendingBytes + bytes > limits.serverBytes || pending.size >= limits.bufferedFrames)
      return yield* Effect.fail(overflow());
    if (frame.registry) registry = frame.registry;
    lastDeliveryId = frame.deliveryId;
    pending.set(frame.deliveryId, { bytes, at: Date.now() });
    pendingBytes += bytes;
    yield* writer.write(text);
  });
  const fromPeer = Effect.gen(function* () {
    for (const text of upstream.initial) yield* forward(text);
    yield* Effect.gen(function* () {
      for (const chunk of yield* upstream.reader.pull) {
        if (typeof chunk !== "string") return yield* Effect.fail(unavailable());
        yield* forward(chunk);
      }
    }).pipe(Effect.forever);
  });
  const fromBrowser = Effect.gen(function* () {
    for (const chunk of yield* reader.pull) {
      if (typeof chunk !== "string" || Buffer.byteLength(chunk) > limits.clientBytes)
        return yield* Effect.fail(refused());
      // Excess fields must not smuggle new capabilities past the installed schema.
      const message = yield* Effect.try({
        try: () => decodeInput(chunk, { onExcessProperty: "error" }),
        catch: refused,
      });
      let allowed = false;
      switch (message._tag) {
        case "registry":
        case "ping":
          allowed = true;
          break;
        case "ack": {
          if (!pending.has(message.deliveryId)) return yield* Effect.fail(refused());
          for (const [id, item] of pending) {
            if (id <= message.deliveryId) {
              pending.delete(id);
              pendingBytes -= item.bytes;
            }
          }
          allowed = true;
          break;
        }
        case "models":
        case "trust":
          allowed = registered(registry, message.cwd);
          break;
        case "set_trust":
          allowed = registered(registry, message.path);
          break;
        case "select":
          allowed = message.sessionId !== null && listed(registry, message.cwd, message.sessionId);
          if (allowed && message.sessionId !== null)
            selection = { ...message, sessionId: message.sessionId };
          break;
        case "act":
          allowed =
            !!selection &&
            selection.selectionId === message.selectionId &&
            listed(registry, selection.cwd, selection.sessionId) &&
            allowedAction(message);
          break;
      }
      if (!allowed) return yield* Effect.fail(refused());
      yield* upstream.send(chunk);
    }
  }).pipe(Effect.forever);
  const deadline = Effect.gen(function* () {
    yield* Effect.sleep(1000);
    const oldest = pending.values().next().value;
    if (oldest && Date.now() - oldest.at > limits.ackMs) return yield* Effect.fail(overflow());
  }).pipe(Effect.forever);
  yield* fromPeer.pipe(
    Effect.raceFirst(fromBrowser),
    Effect.raceFirst(deadline),
    Effect.catch((error) =>
      writer
        .write(
          new Socket.CloseEvent(
            error instanceof PeerFailure ? error.code : 1011,
            error instanceof PeerFailure
              ? error.message
              : "Remote connection ended; reconnect for a snapshot.",
          ),
        )
        .pipe(Effect.ignore),
    ),
  );
});

function allowedAction(message: Extract<ClientMessage, { _tag: "act" }>): boolean {
  // Restarting an existing remote session is allowed, but not renaming it or inventing ancestry.
  if (message.start?.name !== undefined || message.start?.dispatchedFrom !== undefined)
    return false;
  switch (message.action._tag) {
    case "prompt":
    case "steer":
      return !message.action.attachments?.length;
    case "stop":
    case "abort":
    case "restore_queue":
    case "set_model":
    case "set_thinking_level":
    case "answer":
      return true;
    default:
      return false;
  }
}

const commands = Effect.fn("PeerGateway.commands")(function* (
  peer: PeerConfig,
  workspaceId: string,
  sessionId: string,
) {
  // HTTP has no browser attachment identity. A fresh read-only registry observation prevents
  // arbitrary terminal history access and avoids consulting Local even when IDs collide.
  const registry = yield* Effect.scoped(
    connect(peer).pipe(Effect.map((connection) => connection.registry)),
  );
  const workspace = registry.workspaces?.find((item) => item.id === workspaceId);
  const reference = registry.sessionReferences?.find(
    (item) => item.workspaceId === workspaceId && item.sessionId === sessionId,
  );
  if (
    !workspace ||
    !reference ||
    sessionKey(workspace.path, sessionId) !== sessionKey(reference.cwd, reference.sessionId)
  )
    return yield* Effect.fail(refused());
  const url = new URL("/api/session/commands", peer.endpoint);
  url.searchParams.set("workspaceId", workspaceId);
  url.searchParams.set("sessionId", sessionId);
  return yield* Effect.tryPromise({
    try: async (signal) => {
      const response = await fetch(url, {
        headers: upstreamHeaders(peer),
        redirect: "manual",
        signal: AbortSignal.any([signal, AbortSignal.timeout(limits.requestMs)]),
      });
      if (response.status !== 200 || !response.body) {
        await response.body?.cancel();
        throw unavailable();
      }
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          bytes += part.value.byteLength;
          if (bytes > limits.clientBytes) throw unavailable();
          chunks.push(part.value);
        }
        const text = Buffer.concat(chunks).toString("utf8");
        Schema.decodeUnknownSync(Schema.fromJsonString(Endpoints.sessionCommands.response))(text);
        return text;
      } finally {
        await reader.cancel();
      }
    },
    catch: unavailable,
  });
});

const json = (body: unknown, status = 200) =>
  HttpServerResponse.text(JSON.stringify(body), {
    status,
    contentType: "application/json",
    headers: { "cache-control": "no-store" },
  });

/** Installed after Router's global Host/Origin middleware, including unsupported paths. */
export const addPeerRoutes = Effect.fn("PeerGateway.routes")(function* (
  router: HttpRouter.HttpRouter,
) {
  const peer = yield* ConfiguredPeer;
  yield* router.add(
    "GET",
    "/api/machines",
    Effect.succeed(
      json({
        machines: [
          { id: "local", name: "Local" },
          ...(peer ? [{ id: peer.id, name: peer.name }] : []),
        ],
      }),
    ),
  );
  const handler = Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = new URL(request.url, "http://localhost");
    const prefix = peer ? `/peer/${peer.id}` : undefined;
    if (
      !prefix ||
      (url.pathname !== `${prefix}/ws` && url.pathname !== `${prefix}/api/session/commands`)
    )
      return json({ error: "Unknown remote machine or unsupported remote request." }, 404);
    if (request.method !== "GET")
      return json({ error: "Remote request method is not supported." }, 405);
    if (url.pathname === `${prefix}/ws`) {
      if (url.search || request.headers.upgrade?.toLowerCase() !== "websocket")
        return json({ error: "A remote WebSocket upgrade is required." }, 400);
      const upstream = yield* connect(peer!);
      yield* bridge(yield* request.upgrade, upstream);
      return HttpServerResponse.empty();
    }
    const workspaceId = url.searchParams.get("workspaceId"),
      sessionId = url.searchParams.get("sessionId");
    if (
      !workspaceId ||
      !sessionId ||
      !/^[a-zA-Z0-9_-]{1,200}$/.test(workspaceId) ||
      !/^[a-zA-Z0-9_-]{1,200}$/.test(sessionId) ||
      [...url.searchParams.keys()].length !== 2 ||
      request.headers.upgrade
    )
      return json({ error: "Remote workspace and session IDs are required." }, 400);
    const body = yield* commands(peer!, workspaceId, sessionId);
    return HttpServerResponse.text(body, {
      contentType: "application/json",
      headers: { "cache-control": "no-store" },
    });
  }).pipe(
    Effect.catch(() =>
      Effect.succeed(
        json(
          {
            error:
              "Remote request refused: machine unavailable, incompatible, or session not listed.",
          },
          502,
        ),
      ),
    ),
    Effect.scoped,
  );
  // HttpRouter's terminal wildcard also matches the bare /peer prefix.
  yield* router.add("*", "/peer/*", handler);
});
