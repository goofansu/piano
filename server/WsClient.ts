import { Cause, Effect } from "effect";
import { Socket } from "effect/socket";
import {
  type ClientMessage,
  CloseCode,
  decodeClientMessage,
  encodeServerMessage,
  type ServerMessage,
} from "../shared/wire.ts";
import { makeSocketDelivery } from "./BoundedDelivery.ts";
import { makeClientDispatch } from "./ClientDispatch.ts";
import { projectServerMessage } from "./DisplayProjection.ts";
import { inboundLimits } from "./InboundCapacity.ts";

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

export const handleSocket = Effect.fn("WsClient.handleSocket")(function* (
  socket: Socket.Socket,
  options: { readonly peer?: boolean } = {},
) {
  const reader = yield* socket.reader;
  const writer = yield* socket.writer;

  const delivery = yield* makeSocketDelivery(
    (text: string) => writer.write(text),
    (m: ServerMessage, id) => encodeServerMessage(m, id),
  );
  const frames = makeDisplayFrames();
  const client = yield* makeClientDispatch(
    {
      send: (message) =>
        Effect.suspend(() => {
          const shown = frames(message);
          return shown ? delivery.offer(shown) : Effect.void;
        }),
      overflow: (error) =>
        delivery.close(
          error.detail,
          error.oversized ? CloseCode.tooLarge : CloseCode.tryAgainLater,
        ),
    },
    options,
  );

  const decoder = new TextDecoder();
  yield* Effect.gen(function* () {
    const chunks = yield* reader.pull;
    for (const chunk of chunks) {
      const size = typeof chunk === "string" ? Buffer.byteLength(chunk) : chunk.byteLength;
      if (size > inboundLimits.frameBytes) {
        yield* delivery.close(
          "Input exceeds the WebSocket message byte limit. Reduce it before reconnecting.",
          CloseCode.tooLarge,
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
      yield* Effect.forkScoped(yield* client.receive(msg));
    }
  }).pipe(
    Effect.forever,
    Effect.catchTag("SocketError", (error) =>
      error.reason._tag === "SocketCloseError" ? Effect.void : Effect.fail(error),
    ),
    Effect.catchCause((cause) =>
      Cause.hasInterruptsOnly(cause)
        ? Effect.void
        : writer
            .write(
              new Socket.CloseEvent(
                CloseCode.ended,
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
