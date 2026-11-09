/**
 * Same-origin attachment to a configured Piano: an authenticated, bounded pipe. The remote's
 * `/ws/peer` decides what another machine may ask (PeerScope there) and answers refusals in its
 * own delivery sequence. No Pi protocol, request policy, local registry lookup, mutation retry,
 * delivery renumbering or remote process ownership lives here (INV-01/02/05).
 */
import { WebSocket } from "@effect/platform-node/NodeWS";
import { Data, Effect, Redacted, Schema } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { Socket } from "effect/socket";
import { Endpoints } from "../shared/http.ts";
import { ClientMessageJson, decodeServerMessage } from "../shared/wire.ts";
import { AllowedOrigins } from "./OriginPolicy.ts";
import { ConfiguredPeers, type PeerConfig } from "./PeerConfig.ts";

const limits = {
  connectMs: 5_000,
  requestMs: 10_000,
  clientBytes: 1024 * 1024,
  serverBytes: 8 * 1024 * 1024,
  bufferedFrames: 64,
  ackMs: 15_000,
  closeGraceMs: 1_000,
  /** A folder-commands request carries one path; a defaults save one model reference. */
  folderBodyBytes: 16 * 1024,
};
class PeerFailure extends Data.TaggedError("PeerFailure")<{
  readonly message: string;
  readonly code: number;
}> {}
const unavailable = () =>
  new PeerFailure({ message: "Remote Piano is unavailable or incompatible.", code: 1011 });
const refused = () =>
  new PeerFailure({ message: "Remote connection received an invalid message.", code: 1008 });
const overflow = () =>
  new PeerFailure({
    message: "Remote connection capacity exceeded; reconnect for a snapshot.",
    code: 1013,
  });
/** The browser stays closed on 1009 rather than refetching a view it can never receive. */
const tooLarge = () =>
  new PeerFailure({ message: "Remote session view exceeds the delivery limit.", code: 1009 });
/** Keep the remote's own close meaning: 1009 and 1013 tell the browser whether to reconnect. */
function peerFailure(error: unknown): PeerFailure {
  if (error instanceof PeerFailure) return error;
  if (Socket.SocketError.is(error)) {
    const reason = error.reason;
    if (reason._tag === "SocketCloseError" && reason.code === 1009) return tooLarge();
    if (reason._tag === "SocketCloseError" && reason.code === 1013) return overflow();
    // ws reports a frame above maxPayload as an error before closing with 1009.
    if (
      reason._tag === "SocketReadError" &&
      (reason.cause as { code?: unknown } | undefined)?.code === "WS_ERR_UNSUPPORTED_MESSAGE_LENGTH"
    )
      return tooLarge();
  }
  return new PeerFailure({
    message: "Remote connection ended; reconnect for a snapshot.",
    code: 1011,
  });
}
const envelope = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      _tag: Schema.String,
      deliveryId: Schema.Number,
    }),
  ),
);
const decodeInput = Schema.decodeUnknownSync(ClientMessageJson);

/**
 * Keep raw text intact, including fields this version does not interpret. Only the delivery ID is
 * read, to bound unacknowledged frames, and the first registry is decoded once as the remote's
 * compatibility check (INV-12).
 */
function inspectFrame(text: string) {
  const frame = envelope(text);
  if (!Number.isSafeInteger(frame.deliveryId) || frame.deliveryId <= 0) throw unavailable();
  return { deliveryId: frame.deliveryId, registry: frame._tag === "registry" };
}

function checkRegistry(text: string) {
  const registry = decodeServerMessage(text);
  if (registry._tag !== "registry" || !registry.sessionReferences || !registry.workspaces)
    throw unavailable();
}

/** Only startup configuration can supply upstream authentication. Never forward caller headers. */
const upstreamHeaders = (peer: PeerConfig) => ({
  Origin: peer.origin,
  ...(peer.vmToken ? { "X-Exedev-Authorization": `Bearer ${Redacted.value(peer.vmToken)}` } : {}),
});

const connect = Effect.fn("PeerGateway.connect")(
  function* (peer: PeerConfig) {
    const url = new URL("/ws/peer", peer.endpoint);
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
    let registry = false;
    // The remote may send hosts before registry. Hold that bounded prelude, not a second
    // delivery stream: the browser will acknowledge the original IDs after admission.
    while (!registry) {
      for (const chunk of yield* reader.pull) {
        if (typeof chunk !== "string") return yield* Effect.fail(unavailable());
        initialBytes += Buffer.byteLength(chunk);
        if (initialBytes > limits.serverBytes || initial.length >= limits.bufferedFrames)
          return yield* Effect.fail(overflow());
        const frame = yield* Effect.try({ try: () => inspectFrame(chunk), catch: unavailable });
        if (frame.registry) {
          yield* Effect.try({ try: () => checkRegistry(chunk), catch: unavailable });
          registry = true;
        }
        initial.push(chunk);
      }
    }
    // 1013 when this pipe's outgoing buffer is full; 1011 when the remote is closing or silent.
    const send = (text: string) =>
      Effect.callback<void, PeerFailure>((resume) => {
        if (ws.readyState !== WebSocket.OPEN) {
          resume(Effect.fail(unavailable()));
          return;
        }
        if (ws.bufferedAmount + Buffer.byteLength(text) > limits.clientBytes) {
          resume(Effect.fail(overflow()));
          return;
        }
        ws.send(text, (error) => resume(error ? Effect.fail(unavailable()) : Effect.void));
      }).pipe(
        Effect.timeoutOrElse({
          duration: limits.requestMs,
          orElse: () => Effect.fail(unavailable()),
        }),
      );
    return { reader, send, initial };
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
  let lastDeliveryId = 0;
  let pendingBytes = 0;
  const pending = new Map<number, { bytes: number; at: number }>();
  const forward = Effect.fnUntraced(function* (text: string) {
    const bytes = Buffer.byteLength(text);
    if (bytes > limits.serverBytes) return yield* Effect.fail(tooLarge());
    const frame = yield* Effect.try({ try: () => inspectFrame(text), catch: unavailable });
    if (frame.deliveryId <= lastDeliveryId) return yield* Effect.fail(unavailable());
    if (pendingBytes + bytes > limits.serverBytes || pending.size >= limits.bufferedFrames)
      return yield* Effect.fail(overflow());
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
      // The remote decides what this connection may do and answers refusals itself. Only
      // acknowledgements are read here, to release this pipe's window of unacknowledged frames.
      const message = yield* Effect.try({ try: () => decodeInput(chunk), catch: refused });
      if (message._tag === "ack") {
        if (!pending.has(message.deliveryId)) return yield* Effect.fail(refused());
        for (const [id, item] of pending) {
          if (id <= message.deliveryId) {
            pending.delete(id);
            pendingBytes -= item.bytes;
          }
        }
      }
      // A send fails when the remote is closing; let its own close code reach the browser first.
      yield* upstream
        .send(chunk)
        .pipe(
          Effect.catch((failure) =>
            failure.code === 1011
              ? Effect.sleep(limits.closeGraceMs).pipe(Effect.andThen(Effect.fail(failure)))
              : Effect.fail(failure),
          ),
        );
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
    Effect.catch((error) => {
      const failure = peerFailure(error);
      return writer.write(new Socket.CloseEvent(failure.code, failure.message)).pipe(Effect.ignore);
    }),
  );
});

/** The two slash-command reads; both answer with the same command list. */
type CommandsRead =
  | { readonly kind: "session"; readonly workspaceId: string; readonly sessionId: string }
  | { readonly kind: "folder"; readonly cwd: string };

const commands = Effect.fn("PeerGateway.commands")(function* (
  peer: PeerConfig,
  read: CommandsRead,
) {
  // The remote resolves the session IDs in its own registry; its peer folder read answers only for
  // a registered folder. Either refuses what it does not list.
  const url = new URL(
    read.kind === "session" ? "/api/session/commands" : "/api/peer/commands",
    peer.endpoint,
  );
  if (read.kind === "session") {
    url.searchParams.set("workspaceId", read.workspaceId);
    url.searchParams.set("sessionId", read.sessionId);
  }
  return yield* Effect.tryPromise({
    try: async (signal) => {
      const response = await fetch(url, {
        ...(read.kind === "folder"
          ? {
              method: "POST",
              headers: { ...upstreamHeaders(peer), "content-type": "application/json" },
              body: JSON.stringify({ cwd: read.cwd }),
            }
          : { headers: upstreamHeaders(peer) }),
        redirect: "manual",
        signal: AbortSignal.any([signal, AbortSignal.timeout(limits.requestMs)]),
      });
      if (response.status !== 200) {
        await response.body?.cancel();
        throw unavailable();
      }
      const text = await readBounded(response);
      Schema.decodeUnknownSync(Schema.fromJsonString(Endpoints.sessionCommands.response))(text);
      return text;
    },
    catch: unavailable,
  });
});

/** A remote's answer, read up to the client limit; a larger or missing body is unavailable. */
async function readBounded(response: Response): Promise<string> {
  if (!response.body) throw unavailable();
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
    return Buffer.concat(chunks).toString("utf8");
  } finally {
    await reader.cancel();
  }
}

const Refusal = Schema.Struct({ error: Schema.String, field: Schema.optional(Schema.String) });

/**
 * Save the remote's default model and effort through its own settings endpoint, so the remote
 * checks the model against its own catalog. Its refusal ("Choose an available model.") reaches
 * the browser as its ordinary 400; anything else is the remote being unavailable.
 */
const saveDefaults = Effect.fn("PeerGateway.saveDefaults")(function* (
  peer: PeerConfig,
  body: string,
) {
  return yield* Effect.tryPromise({
    try: async (signal) => {
      const response = await fetch(new URL(Endpoints.saveDefaults.path, peer.endpoint), {
        method: "PUT",
        headers: { ...upstreamHeaders(peer), "content-type": "application/json" },
        body,
        redirect: "manual",
        signal: AbortSignal.any([signal, AbortSignal.timeout(limits.requestMs)]),
      });
      if (response.status !== 200 && response.status !== 400) {
        await response.body?.cancel();
        throw unavailable();
      }
      const text = await readBounded(response);
      if (response.status === 200) {
        Schema.decodeUnknownSync(Schema.fromJsonString(Endpoints.saveDefaults.response))(text);
        return { status: 200, text };
      }
      const { error, field } = Schema.decodeUnknownSync(Schema.fromJsonString(Refusal))(text);
      return {
        status: 400,
        text: JSON.stringify(field === undefined ? { error } : { error, field }),
      };
    },
    catch: unavailable,
  });
});

const FolderRead = Schema.Struct({ cwd: Schema.NonEmptyString });

const commandsResponse = (body: string) =>
  HttpServerResponse.text(body, {
    contentType: "application/json",
    headers: { "cache-control": "no-store" },
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
  const peers = yield* ConfiguredPeers;
  const allowedOrigins = yield* AllowedOrigins;
  const byId = new Map(peers.map((peer) => [peer.id, peer]));
  yield* router.add(
    "GET",
    "/api/machines",
    Effect.succeed(
      json({
        machines: [{ id: "local", name: "Local" }, ...peers.map(({ id, name }) => ({ id, name }))],
      }),
    ),
  );
  const handler = Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = new URL(request.url, "http://localhost");
    const match =
      /^\/peer\/([^/]+)(\/ws|\/api\/session\/commands|\/api\/commands|\/api\/settings\/defaults)$/.exec(
        url.pathname,
      );
    // The request owns this immutable destination, including credentials, through completion.
    const peer = match ? byId.get(match[1]) : undefined;
    if (!peer) return json({ error: "Unknown remote machine or unsupported remote request." }, 404);
    const method =
      match?.[2] === "/api/commands"
        ? "POST"
        : match?.[2] === Endpoints.saveDefaults.path
          ? Endpoints.saveDefaults.method
          : "GET";
    if (request.method !== method)
      return json({ error: "Remote request method is not supported." }, 405);
    // Every remote request spends the peer's credential, so another site's page must not make the
    // browser send one (an image or script tag needs no Origin). Browsers label such loads.
    const site = request.headers["sec-fetch-site"];
    const origin = request.headers.origin;
    if (
      (site !== undefined && site !== "same-origin") ||
      (origin !== undefined && !allowedOrigins.has(origin))
    )
      return json({ error: "Remote requests must come from this Piano's own page." }, 403);
    if (match?.[2] === "/ws") {
      if (url.search || request.headers.upgrade?.toLowerCase() !== "websocket")
        return json({ error: "A remote WebSocket upgrade is required." }, 400);
      const upstream = yield* connect(peer);
      yield* bridge(yield* request.upgrade, upstream);
      return HttpServerResponse.empty();
    }
    if (match?.[2] === "/api/commands") {
      // A folder path travels only in this bounded body, never in a URL.
      const length = Number(request.headers["content-length"]);
      if (url.search || !Number.isSafeInteger(length) || length > limits.folderBodyBytes)
        return json({ error: "A remote folder is required." }, 400);
      const text = yield* request.text;
      const folder = Schema.decodeUnknownExit(Schema.fromJsonString(FolderRead))(text, {
        onExcessProperty: "error",
      });
      if (folder._tag === "Failure" || Buffer.byteLength(text) > limits.folderBodyBytes)
        return json({ error: "A remote folder is required." }, 400);
      return commandsResponse(yield* commands(peer, { kind: "folder", cwd: folder.value.cwd }));
    }
    if (match?.[2] === Endpoints.saveDefaults.path) {
      const length = Number(request.headers["content-length"]);
      if (url.search || !Number.isSafeInteger(length) || length > limits.folderBodyBytes)
        return json({ error: Endpoints.saveDefaults.invalid }, 400);
      const text = yield* request.text;
      const defaults = Schema.decodeUnknownExit(Schema.fromJsonString(Endpoints.saveDefaults.body))(
        text,
        { onExcessProperty: "error" },
      );
      if (defaults._tag === "Failure" || Buffer.byteLength(text) > limits.folderBodyBytes)
        return json({ error: Endpoints.saveDefaults.invalid }, 400);
      const saved = yield* saveDefaults(peer, JSON.stringify(defaults.value));
      return HttpServerResponse.text(saved.text, {
        status: saved.status,
        contentType: "application/json",
        headers: { "cache-control": "no-store" },
      });
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
    return commandsResponse(yield* commands(peer, { kind: "session", workspaceId, sessionId }));
  }).pipe(
    Effect.catch(() =>
      Effect.succeed(
        json(
          {
            error:
              "Remote request refused: machine unavailable, incompatible, or session or folder not listed.",
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
