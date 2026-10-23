import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { createServer, type Socket } from "node:net";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import {
  PreviewAdapter,
  type PreviewConfig,
  type PreviewOwnerIdentity,
  type PreviewRequest,
} from "./PreviewAdapter.ts";

/** One Pi generation's admission gate and live connections. Browser/tool cancellation never
 * closes it. The service runner must connect before it can spawn, including a late submission
 * after Piano dies. A server crash closes the kernel connections without running JS cleanup. */
export class PreviewOwner {
  readonly identity: PreviewOwnerIdentity;
  private readonly adapter: PreviewAdapter;
  private readonly root: string;
  private readonly config: () => Promise<PreviewConfig>;
  private readonly sockets = new Set<Socket>();
  private readonly server;
  private tail: Promise<unknown> = Promise.resolve();
  private pending = 0;
  private attempted = false;
  private ending = false;
  private disposed?: Promise<void>;

  private constructor(
    identity: PreviewOwnerIdentity,
    options: {
      adapter?: PreviewAdapter;
      root?: string;
      config?: () => Promise<PreviewConfig>;
    },
  ) {
    this.identity = identity;
    this.adapter = options.adapter ?? new PreviewAdapter();
    this.root =
      options.root ??
      process.env.PIANO_PREVIEW_STATE ??
      join(homedir(), ".local/state/piano/previews");
    this.config =
      options.config ??
      (async () =>
        process.env.PIANO_PREVIEW_CONFIG
          ? JSON.parse(await readFile(process.env.PIANO_PREVIEW_CONFIG, "utf8"))
          : {});
    this.server = createServer((socket) => {
      this.sockets.add(socket);
      socket.on("error", () => {});
      socket.on("close", () => this.sockets.delete(socket));
      // Only the initial frame has a deadline; a held owner connection never expires.
      socket.setTimeout(5000, () => socket.destroy());
      socket.setEncoding("utf8");
      let input = "";
      const receive = (chunk: string) => {
        input += chunk;
        if (Buffer.byteLength(input) > 65536) {
          socket.destroy();
          return;
        }
        if (!input.includes("\n")) return;
        socket.off("data", receive);
        socket.setTimeout(0);
        try {
          const message = JSON.parse(input);
          if (this.ending)
            throw new Error("Pi owner is ending; reopen does not inherit its preview.");
          if (message.lease) {
            if (message.generation !== this.identity.generation)
              throw new Error("Preview owner generation mismatch.");
            // This per-generation private socket is not inherited by the app. A runner cannot
            // reconnect to a new owner: that generation has a different endpoint.
            socket.write("owned\n");
          } else {
            void this.request(message).then(
              (result) => socket.end(`${JSON.stringify(result)}\n`),
              (error) => socket.end(`${JSON.stringify({ error: String(error) })}\n`),
            );
          }
        } catch (error) {
          socket.end(`${JSON.stringify({ error: String(error) })}\n`);
        }
      };
      socket.on("data", receive);
    });
  }

  static async open(
    spec: { cwd: string; sessionId: string },
    generation: string,
    options: {
      adapter?: PreviewAdapter;
      root?: string;
      config?: () => Promise<PreviewConfig>;
    } = {},
  ) {
    const workspace = await realpath(spec.cwd);
    // Short enough for macOS Unix-domain paths, private to the current OS user.
    const directory = await mkdtemp(join(tmpdir(), "piano-"));
    const owner = new PreviewOwner(
      { workspace, sessionId: spec.sessionId, generation, endpoint: join(directory, generation) },
      options,
    );
    try {
      await new Promise<void>((resolve, reject) => {
        owner.server.once("error", reject);
        owner.server.listen(owner.identity.endpoint, () => {
          owner.server.off("error", reject);
          resolve();
        });
      });
      return owner;
    } catch (error) {
      await rm(directory, { recursive: true, force: true });
      throw error;
    }
  }

  private serial<A>(work: () => Promise<A>): Promise<A> {
    const next = this.tail.then(work);
    this.tail = next.catch(() => {});
    return next;
  }

  request(request: PreviewRequest) {
    if (this.ending)
      return Promise.reject(new Error("Pi owner is ending; no preview launch admitted."));
    this.pending++;
    return this.serial(async () => {
      if (this.ending) throw new Error("Pi owner is ending; no preview launch admitted.");
      if (request.action === "start") this.attempted = true;
      return this.adapter.request(
        { ...request, workspace: this.identity.workspace },
        this.root,
        await this.config(),
        this.identity,
      );
    }).finally(() => {
      this.pending--;
    });
  }

  /** Called at transport exit, before waiting for adapter locks or supervisor commands. */
  disconnect() {
    this.ending = true;
    if (!this.disposed) {
      for (const socket of this.sockets) socket.destroy();
      this.disposed = new Promise<void>((resolve) => this.server.close(() => resolve())).then(() =>
        rm(join(this.identity.endpoint, ".."), { recursive: true, force: true }),
      );
      // Transport exit cannot await filesystem cleanup. Keep the rejection for prepareRelease,
      // but never turn a delayed cleanup error into an unhandled process-wide rejection.
      void this.disposed.catch(() => {});
    }
  }

  /** Reserve idle retirement atomically against incoming launches, or clean up for release.
   * False means active/unknown. Explicit cleanup failures propagate and can be retried. */
  async prepareRelease(idle = false): Promise<boolean> {
    if (!idle) this.disconnect();
    return this.serial(async () => {
      if (idle && this.pending > 0) return false;
      const ready = !this.attempted || (await this.adapter.retire(this.identity, this.root, idle));
      if (!ready || (idle && this.pending > 0)) return false;
      this.disconnect();
      await this.disposed;
      return true;
    });
  }
}
