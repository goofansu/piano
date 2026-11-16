import { createServer, type AddressInfo, type Server } from "node:net";

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
    await Promise.all(
      reservations.map((server) => new Promise<void>((done) => server.close(() => done()))),
    );
  }
}

export async function freePort(): Promise<number> {
  const [port] = await freePorts(1);
  return port;
}
