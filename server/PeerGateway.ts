import { WebSocket } from "@effect/platform-node/NodeWS";
import { Data, Duration, Effect, Redacted, Schema } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { Socket } from "effect/socket";
import { type RemoteRequest, RemoteRequests } from "../shared/http.ts";
import { PEER_FRAME_BYTES } from "../shared/machine.ts";
import { IMAGE_PATHS } from "../shared/remoteImages.ts";
import { URL_ID } from "../shared/urlId.ts";
import { ClientMessageJson, CloseCode, ServerMessage, disconnectReason } from "../shared/wire.ts";
import { socketLimits } from "./BoundedDelivery.ts";
import { AllowedOrigins, fromOwnPage } from "./OriginPolicy.ts";
import { ConfiguredPeers, type PeerConfig } from "./PeerConfig.ts";
import { makePeerImageRelay } from "./PeerImageGateway.ts";

const imagePaths: ReadonlySet<string> = new Set(IMAGE_PATHS);

const limits = {
  connectMs: 5_000,
  requestMs: 10_000,
  clientBytes: PEER_FRAME_BYTES,
  serverBytes: socketLimits.frameBytes,
  window: socketLimits.window,
  ackMs: Duration.toMillis(socketLimits.ackTimeout) + 5_000,
  closeGraceMs: 1_000,
  bodyBytes: 16 * 1024,
  fileTransfers: 2,
};
class PeerFailure extends Data.TaggedError("PeerFailure")<{
  readonly message: string;
  readonly code: number;
}> {}
const unavailable = () =>
  new PeerFailure({
    message: "Remote Piano is unavailable or incompatible.",
    code: CloseCode.ended,
  });
const refused = () =>
  new PeerFailure({
    message: "Remote connection received an invalid message.",
    code: CloseCode.refused,
  });
const overflow = () =>
  new PeerFailure({
    message: "Remote connection capacity exceeded; reconnect for a snapshot.",
    code: CloseCode.tryAgainLater,
  });
const tooLarge = () =>
  new PeerFailure({
    message: "Remote session view exceeds the delivery limit.",
    code: CloseCode.tooLarge,
  });
function peerFailure(error: unknown): PeerFailure {
  if (error instanceof PeerFailure) return error;
  if (Socket.SocketError.is(error)) {
    const reason = error.reason;
    if (reason._tag === "SocketCloseError") {
      const meaning = disconnectReason(reason.code);
      if (meaning === "too-large") return tooLarge();
      if (meaning === "behind") return overflow();
    }
    if (
      reason._tag === "SocketReadError" &&
      (reason.cause as { code?: unknown } | undefined)?.code === "WS_ERR_UNSUPPORTED_MESSAGE_LENGTH"
    )
      return tooLarge();
  }
  return new PeerFailure({
    message: "Remote connection ended; reconnect for a snapshot.",
    code: CloseCode.ended,
  });
}
const envelope = Schema.decodeUnknownSync(
  Schema.Struct({
    _tag: Schema.String,
    deliveryId: Schema.Number,
  }),
);
const decodePayload = Schema.decodeUnknownSync(ServerMessage);
const decodeInput = Schema.decodeUnknownSync(ClientMessageJson);

function inspectFrame(text: string, checkRegistry = false) {
  const value: unknown = JSON.parse(text);
  const frame = envelope(value);
  if (!Number.isSafeInteger(frame.deliveryId) || frame.deliveryId <= 0) throw unavailable();
  if (checkRegistry && frame._tag === "registry") {
    const registry = decodePayload(value);
    if (registry._tag !== "registry" || !registry.sessionReferences || !registry.workspaces)
      throw unavailable();
  }
  return { deliveryId: frame.deliveryId, registry: frame._tag === "registry" };
}

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
          ws.on("error", () => {});
          ws.terminate();
        }),
    );
    const socket = yield* Socket.fromWebSocket(Effect.succeed(ws), { highWaterMark: 64 * 1024 });
    const reader = yield* socket.reader;
    const initial: { text: string; frame: ReturnType<typeof inspectFrame> }[] = [];
    let initialBytes = 0;
    let registry = false;
    while (!registry) {
      for (const chunk of yield* reader.pull) {
        if (typeof chunk !== "string") return yield* Effect.fail(unavailable());
        initialBytes += Buffer.byteLength(chunk);
        if (initialBytes > limits.window.bytes || initial.length >= limits.window.frames)
          return yield* Effect.fail(overflow());
        const frame = yield* Effect.try({
          try: () => inspectFrame(chunk, true),
          catch: unavailable,
        });
        if (frame.registry) registry = true;
        initial.push({ text: chunk, frame });
      }
    }
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
  const forward = Effect.fnUntraced(function* (
    text: string,
    inspected?: ReturnType<typeof inspectFrame>,
  ) {
    const bytes = Buffer.byteLength(text);
    if (bytes > limits.serverBytes) return yield* Effect.fail(tooLarge());
    const frame =
      inspected ?? (yield* Effect.try({ try: () => inspectFrame(text), catch: unavailable }));
    if (frame.deliveryId <= lastDeliveryId) return yield* Effect.fail(unavailable());
    if (pendingBytes + bytes > limits.window.bytes || pending.size >= limits.window.frames)
      return yield* Effect.fail(overflow());
    lastDeliveryId = frame.deliveryId;
    pending.set(frame.deliveryId, { bytes, at: Date.now() });
    pendingBytes += bytes;
    yield* writer.write(text);
  });
  const fromPeer = Effect.gen(function* () {
    for (const { text, frame } of upstream.initial) yield* forward(text, frame);
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
      yield* upstream
        .send(chunk)
        .pipe(
          Effect.catch((failure) =>
            failure.code === CloseCode.ended
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

async function readBounded(response: Response, maximum: number): Promise<Buffer> {
  if (!response.body) throw unavailable();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > maximum) throw unavailable();
      chunks.push(part.value);
    }
    return Buffer.concat(chunks);
  } finally {
    await reader.cancel();
  }
}

const json = (body: unknown, status = 200) =>
  HttpServerResponse.text(JSON.stringify(body), {
    status,
    contentType: "application/json",
    headers: { "cache-control": "no-store" },
  });

const Refusal = Schema.Struct({ error: Schema.String, field: Schema.optional(Schema.String) });

const relay = Effect.fn("PeerGateway.relay")(function* (
  peer: PeerConfig,
  { browser, upstream, passRefusal, answer, answerBytes, requestMs }: RemoteRequest,
  query: ReadonlyArray<readonly [string, string]>,
  body: string | undefined,
) {
  const url = new URL(upstream.path, peer.endpoint);
  for (const [name, value] of query) url.searchParams.set(name, value);
  return yield* Effect.tryPromise({
    try: async (signal) => {
      const response = await fetch(url, {
        method: upstream.method,
        headers:
          body === undefined
            ? upstreamHeaders(peer)
            : { ...upstreamHeaders(peer), "content-type": "application/json" },
        body,
        redirect: "manual",
        signal: AbortSignal.any([signal, AbortSignal.timeout(requestMs ?? limits.requestMs)]),
      });
      const refusal = passRefusal && response.status === upstream.refused;
      if (response.status !== 200 && !refusal) {
        await response.body?.cancel();
        throw unavailable();
      }
      if (refusal) {
        const text = (await readBounded(response, limits.clientBytes)).toString("utf8");
        const { error, field } = Schema.decodeUnknownSync(Schema.fromJsonString(Refusal))(text);
        return json(
          field === undefined ? { error } : { error, field },
          browser.refused ?? response.status,
        );
      }
      if (answer === "bytes") {
        const contentType = response.headers.get("content-type");
        const disposition = response.headers.get("content-disposition");
        if (!contentType || response.headers.has("content-encoding")) {
          await response.body?.cancel();
          throw unavailable();
        }
        const bytes = await readBounded(response, answerBytes ?? limits.clientBytes);
        return HttpServerResponse.uint8Array(new Uint8Array(bytes), {
          contentType,
          headers: {
            "cache-control": "no-store",
            "x-content-type-options": "nosniff",
            ...(disposition ? { "content-disposition": disposition } : {}),
          },
        });
      }
      const text = (await readBounded(response, answerBytes ?? limits.clientBytes)).toString(
        "utf8",
      );
      Schema.decodeUnknownSync(Schema.fromJsonString(upstream.response))(text);
      return HttpServerResponse.text(text, {
        status: 200,
        contentType: "application/json",
        headers: { "cache-control": "no-store" },
      });
    },
    catch: unavailable,
  });
});

const remoteRequests = new Map<string, RemoteRequest[]>();
for (const request of RemoteRequests)
  remoteRequests.set(request.browser.path, [
    ...(remoteRequests.get(request.browser.path) ?? []),
    request,
  ]);

export const addPeerRoutes = Effect.fn("PeerGateway.routes")(function* (
  router: HttpRouter.HttpRouter,
) {
  const peers = yield* ConfiguredPeers;
  const allowedOrigins = yield* AllowedOrigins;
  const byId = new Map(peers.map((peer) => [peer.id, peer]));
  const relayImages = makePeerImageRelay();
  const files = new Map<string, number>();
  const handler = Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = new URL(request.url, "http://localhost");
    const match = /^\/peer\/([^/]+)(\/.*)$/.exec(url.pathname);
    const peer = match ? byId.get(match[1]) : undefined;
    const known = match ? remoteRequests.get(match[2]) : undefined;
    const remote = known?.find(({ browser }) => browser.method === request.method);
    const imagePath = match && imagePaths.has(match[2]) ? match[2] : undefined;
    if (!peer || (!known && !imagePath && match?.[2] !== "/ws"))
      return json({ error: "Unknown remote machine or unsupported remote request." }, 404);
    if (!imagePath && (known ? !remote : request.method !== "GET"))
      return json({ error: "Remote request method is not supported." }, 405);
    if (!fromOwnPage(request.headers, allowedOrigins))
      return json({ error: "Remote requests must come from this Piano's own page." }, 403);
    if (imagePath) return yield* relayImages(peer, imagePath, request, upstreamHeaders(peer));
    if (!remote) {
      if (url.search || request.headers.upgrade?.toLowerCase() !== "websocket")
        return json({ error: "A remote WebSocket upgrade is required." }, 400);
      const upstream = yield* connect(peer);
      yield* bridge(yield* request.upgrade, upstream);
      return HttpServerResponse.empty();
    }
    const { browser } = remote;
    const invalid = json({ error: remote.invalid }, 400);
    const query = browser.query.map((name) => [name, url.searchParams.get(name) ?? ""] as const);
    if (
      request.headers.upgrade ||
      (query.length === 0
        ? url.search !== ""
        : [...url.searchParams.keys()].length !== query.length ||
          query.some(([, value]) => !URL_ID.test(value)))
    )
      return invalid;
    let body: string | undefined;
    if (browser.body !== undefined) {
      const maximum = remote.bodyBytes ?? limits.bodyBytes;
      const length = Number(request.headers["content-length"]);
      if (!Number.isSafeInteger(length) || length > maximum) return invalid;
      const text = yield* request.text;
      const decoded = Schema.decodeUnknownExit(Schema.fromJsonString(browser.body))(text, {
        onExcessProperty: "error",
      });
      if (decoded._tag === "Failure" || Buffer.byteLength(text) > maximum) return invalid;
      body = JSON.stringify(decoded.value);
    }
    if (remote.answer !== "bytes") return yield* relay(peer, remote, query, body);
    if ((files.get(peer.id) ?? 0) >= limits.fileTransfers)
      return json({ error: "Remote files are busy. Try again." }, 429);
    files.set(peer.id, (files.get(peer.id) ?? 0) + 1);
    return yield* relay(peer, remote, query, body).pipe(
      Effect.ensuring(Effect.sync(() => files.set(peer.id, (files.get(peer.id) ?? 1) - 1))),
    );
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
  yield* router.add("*", "/peer/*", handler);
});
