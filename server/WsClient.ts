/**
 * One browser socket: bounded delivery of ServerMessages and the read loop that decodes
 * ClientMessages. Acknowledgements go to delivery; every other message goes to the client's
 * ClientDispatch, which owns what the message means.
 */
import { Effect } from "effect";
import { Socket } from "effect/socket";
import { type ClientMessage, decodeClientMessage, encodeServerMessage, type ServerMessage } from "../shared/wire.ts";
import { makeSocketDelivery } from "./BoundedDelivery.ts";
import { makeClientDispatch } from "./ClientDispatch.ts";
import { projectDisplay } from "./DisplayProjection.ts";

export const handleSocket = Effect.fn("WsClient.handleSocket")(function* (socket: Socket.Socket) {
  // The reader performs the upgrade handshake; the writer waits on it.
  const reader = yield* socket.reader;
  const writer = yield* socket.writer;

  // Bound both host queues and the transport; the window and close codes live in BoundedDelivery.
  const delivery = yield* makeSocketDelivery((text: string) => writer.write(text), (m: ServerMessage, id) => encodeServerMessage(projectDisplay(m), id));
  const client = yield* makeClientDispatch({
    send: delivery.offer,
    overflow: error => delivery.close(error.detail, error.oversized ? 1009 : 1013),
  });

  const decoder = new TextDecoder();
  yield* Effect.gen(function* () {
    const chunks = yield* reader.pull;
    for (const chunk of chunks) {
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
  }).pipe(Effect.forever, Effect.catchCause(() => Effect.void), Effect.raceFirst(
    delivery.closed.pipe(Effect.flatMap(({ reason, code }) => writer.write(new Socket.CloseEvent(code, reason)).pipe(Effect.ignore))),
  ));
}, Effect.scoped);
