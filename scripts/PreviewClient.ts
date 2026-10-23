import { createConnection } from "node:net";

/** Losing a client reply never cancels the admitted operation or the owner's connection. */
export function ownerRequest(
  endpoint: string,
  request: unknown,
  signal?: AbortSignal,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ path: endpoint, signal });
    socket.setEncoding("utf8");
    socket.setTimeout(120_000, () =>
      socket.destroy(new Error("Preview observation timed out; read status.")),
    );
    let output = "";
    socket.on("connect", () => socket.write(`${JSON.stringify(request)}\n`));
    socket.on("data", (data) => {
      output += data;
      if (Buffer.byteLength(output) > 32768)
        socket.destroy(new Error("Preview output exceeded 32 KiB; read status."));
    });
    socket.on("error", reject);
    socket.on("end", () => {
      try {
        const result = JSON.parse(output);
        if (result.error) reject(new Error(result.error));
        else resolve(output.trim());
      } catch {
        reject(new Error("Preview observation interrupted; read status before another start."));
      }
    });
  });
}
