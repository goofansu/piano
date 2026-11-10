import { createServer, type AddressInfo, type Server } from "node:net";

/** Select distinct loopback ports for one scratch journey, including its peers. */
export async function freePorts(count: number): Promise<number[]> {
  const reservations: Server[] = [];
  try {
    for (let i = 0; i < count; i++) {
      const server = createServer();
      reservations.push(server);
      await new Promise<void>((done, fail) =>
        server.once("error", fail).listen(0, "127.0.0.1", done),
      );
    }
    return reservations.map((server) => (server.address() as AddressInfo).port);
  } finally {
    // Keep the entire batch bound until selection finishes: closing each listener before
    // selecting the next lets the OS hand the same port to two services in this journey.
    // This does not reserve ports across the later handoff to the actual child processes.
    await Promise.all(
      reservations.map((server) => new Promise<void>((done) => server.close(() => done()))),
    );
  }
}

/** Select one free loopback port. Take ports for one journey from a single `freePorts` call. */
export async function freePort(): Promise<number> {
  const [port] = await freePorts(1);
  return port;
}
