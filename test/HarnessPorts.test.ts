import assert from "node:assert/strict";
import { Server, type AddressInfo } from "node:net";
import { test } from "node:test";
import { freePorts } from "./fixtures/ports.ts";

test("one journey gets distinct, released ports even when the OS reuses closed listeners", async (t) => {
  const listen = Server.prototype.listen;
  const allocations: { server: Server; port: number }[] = [];
  t.after(async () => {
    for (const { server } of allocations)
      await new Promise<void>((done) => server.close(() => done()));
  });
  // Model a valid OS choice deterministically, using real sockets: prefer a port that this
  // allocation has already released. Never try to reuse a listener that is still reserved.
  t.mock.method(
    Server.prototype,
    "listen",
    function (this: Server, port: number, host: string, ready: () => void) {
      const released = allocations.find(({ server }) => !server.listening);
      this.once("listening", () => {
        allocations.push({ server: this, port: (this.address() as AddressInfo).port });
      });
      return listen.call(this, { port: port === 0 ? (released?.port ?? 0) : port, host }, ready);
    },
  );
  // Main backend + Vite + two peers, as in remote-session.
  const ports = await freePorts(4);
  assert.equal(new Set(ports).size, 4, "no two services in the journey share a port");
  assert.ok(
    allocations.every(({ server }) => !server.listening),
    "reservations were released",
  );
  t.mock.restoreAll();
  const services = ports.map(() => new Server());
  try {
    for (const [index, server] of services.entries()) {
      await new Promise<void>((resolve, reject) =>
        server.once("error", reject).listen(ports[index], "127.0.0.1", resolve),
      );
    }
  } finally {
    await Promise.all(
      services.map((server) => new Promise<void>((done) => server.close(() => done()))),
    );
  }
});

test("a failed port batch releases its earlier reservations", async (t) => {
  const listen = Server.prototype.listen;
  const reservations: Server[] = [];
  t.after(async () => {
    for (const server of reservations)
      await new Promise<void>((done) => server.close(() => done()));
  });
  t.mock.method(
    Server.prototype,
    "listen",
    function (this: Server, port: number, host: string, ready: () => void) {
      reservations.push(this);
      // Force a real bind error after two successful reservations.
      const selected =
        reservations.length === 3 ? (reservations[0].address() as AddressInfo).port : port;
      return listen.call(this, { port: selected, host }, ready);
    },
  );
  await assert.rejects(freePorts(4), { code: "EADDRINUSE" });
  assert.ok(
    reservations.every((server) => !server.listening),
    "failed batches leave no listeners",
  );
});
