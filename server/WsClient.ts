/**
 * One browser socket: bounded delivery of ServerMessages and the read loop that decodes
 * ClientMessages. Acknowledgements go to delivery; every other message goes to the client's
 * ClientDispatch, which owns what the message means.
 *
 * Every message is projected for display (INV-11) as it enters this socket's delivery, and the
 * frame that projection produces is what decides whether the socket has anything to say: a
 * sidebar identical to the one this connection last sent is dropped there.
 */
import { Cause, Effect } from "effect";
import { Socket } from "effect/socket";
import {
  type ClientMessage,
  decodeClientMessage,
  encodeServerMessage,
  type ServerMessage,
} from "../shared/wire.ts";
import { makeSocketDelivery } from "./BoundedDelivery.ts";
import { makeClientDispatch } from "./ClientDispatch.ts";
import { projectServerMessage } from "./DisplayProjection.ts";
import { inboundLimits } from "./InboundCapacity.ts";

/**
 * What one connection sends, decided on the displayed frame: the message projected for display,
 * or undefined when the connection has nothing to say. The sidebar is state, so a frame identical
 * to the last one this connection sent tells a browser nothing it is not already showing; every
 * other kind is an event, whose repetition is its meaning, and always goes out. Comparing after
 * the projection compares exactly what the browser would apply.
 */
const makeDisplayFrames = () => {
  let sidebar: string | undefined;
  return (message: ServerMessage): ServerMessage | undefined => {
    const shown = projectServerMessage(message);
    if (shown._tag !== "registry") return shown;
    const frame = JSON.stringify(shown);
    if (frame === sidebar) return undefined;
    sidebar = frame;
    return shown;
  };
};

export const handleSocket = Effect.fn("WsClient.handleSocket")(function* (socket: Socket.Socket) {
  // The reader performs the upgrade handshake; the writer waits on it.
  const reader = yield* socket.reader;
  const writer = yield* socket.writer;

  // Bound both host queues and the transport; the window and close codes live in BoundedDelivery.
  // Frames reach delivery already projected, through `send` below and nowhere else.
  const delivery = yield* makeSocketDelivery(
    (text: string) => writer.write(text),
    (m: ServerMessage, id) => encodeServerMessage(m, id),
  );
  const frames = makeDisplayFrames();
  const client = yield* makeClientDispatch({
    send: (message) =>
      Effect.suspend(() => {
        const shown = frames(message);
        return shown ? delivery.offer(shown) : Effect.void;
      }),
    overflow: (error) => delivery.close(error.detail, error.oversized ? 1009 : 1013),
  });

  const decoder = new TextDecoder();
  yield* Effect.gen(function* () {
    const chunks = yield* reader.pull;
    for (const chunk of chunks) {
      const size = typeof chunk === "string" ? Buffer.byteLength(chunk) : chunk.byteLength;
      if (size > inboundLimits.frameBytes) {
        yield* delivery.close(
          "Input exceeds the WebSocket message byte limit. Reduce it before reconnecting.",
          1009,
        );
        return yield* Effect.never;
      }
      const text = typeof chunk === "string" ? chunk : decoder.decode(chunk);
      let msg: ClientMessage;
      try {
        msg = decodeClientMessage(text);
      } catch (e) {
        yield* client.report(e);
        continue;
      }
      if (msg._tag === "ack") {
        yield* delivery.ack(msg.deliveryId);
        continue;
      }
      // Receiving claims a selection in receive order. The work runs in its own fiber: a prompt
      // that opens an extension dialog only gets its response after the dialog is answered.
      yield* Effect.forkScoped(yield* client.receive(msg));
    }
  }).pipe(
    Effect.forever,
    // Peer close already ends this client scope; a failed reader must explicitly
    // close an otherwise live socket. Never replay work or stop its Pi session.
    Effect.catchTag("SocketError", (error) =>
      error.reason._tag === "SocketCloseError" ? Effect.void : Effect.fail(error),
    ),
    Effect.catchCause((cause) =>
      Cause.hasInterruptsOnly(cause)
        ? Effect.void
        : writer
            .write(
              new Socket.CloseEvent(
                1011,
                "Socket reader failed; reconnect for a current snapshot.",
              ),
            )
            .pipe(Effect.ignore),
    ),
    Effect.raceFirst(
      delivery.closed.pipe(
        Effect.flatMap(({ reason, code }) =>
          writer.write(new Socket.CloseEvent(code, reason)).pipe(Effect.ignore),
        ),
      ),
    ),
  );
}, Effect.scoped);
