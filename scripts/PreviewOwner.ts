import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { createServer, type Socket } from "node:net";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import {
  PreviewAdapter,
  type PreviewConfig,
  type PreviewOwnerIdentity,
  type PreviewRequest,
  PreviewStartError,
} from "./PreviewAdapter.ts";
import { READY_INTERVAL_MS } from "./PreviewReadiness.ts";

/** An adapter outcome. A failed observation after a failed start carries the instance that start
 * saved, if any: it may be running. */
export type PreviewOutcome = { result: unknown } | { error: unknown; attempted?: unknown };

/** What each admitted request showed: a start's progress (the app it replaced stopped, then its
 * own launch starting), its own outcome, or for a failed start, a status read of what that start
 * left behind. */
export type PreviewObserver = (request: PreviewRequest, outcome: PreviewOutcome) => void;

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
  private observer?: PreviewObserver;
  /** The warming-up app whose readiness this owner keeps checking, and its next check. */
  private warming?: { instanceId: string; timer: NodeJS.Timeout };

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

  /** Hear every admitted request's outcome in order, the session's tool and the browser alike,
   * and each readiness check of a warming-up app. */
  observe(observer: PreviewObserver) {
    this.observer = observer;
  }

  /** Publish an outcome, and keep checking a warming-up app until it answers, fails or its
   * warm-up window ends: a start's deadline ends only its caller's wait, never the checking. */
  private publish(request: PreviewRequest, outcome: PreviewOutcome) {
    this.observer?.(request, outcome);
    const result = "result" in outcome ? outcome.result : undefined;
    const instanceId =
      result && typeof result === "object" && "instanceId" in result
        ? (result as { instanceId: unknown }).instanceId
        : undefined;
    const warming =
      typeof instanceId === "string" &&
      (result as { warming?: unknown }).warming === true &&
      (result as { owner?: { generation?: unknown } }).owner?.generation ===
        this.identity.generation;
    if (warming && this.warming?.instanceId === instanceId) return;
    if (this.warming) clearTimeout(this.warming.timer);
    this.warming = undefined;
    if (!warming || this.ending) return;
    const check = () => {
      if (this.ending || this.warming?.instanceId !== instanceId) return;
      const status: PreviewRequest = { action: "status", workspace: this.identity.workspace };
      void this.serial(async () => {
        if (this.ending || this.warming?.instanceId !== instanceId) return;
        try {
          const result = await this.adapter.request(
            status,
            this.root,
            await this.config(),
            this.identity,
            undefined,
            false,
          );
          // Another request may have replaced or stopped the app while this one waited.
          if (this.warming?.instanceId !== instanceId) return;
          this.warming = undefined;
          this.publish(status, { result });
        } catch (error) {
          if (this.warming?.instanceId !== instanceId) return;
          this.warming = undefined;
          this.observer?.(status, { error });
        }
      });
    };
    this.warming = { instanceId, timer: setTimeout(check, READY_INTERVAL_MS) };
    // A pending check never keeps a process alive by itself.
    this.warming.timer.unref();
  }

  request(request: PreviewRequest) {
    if (this.ending)
      return Promise.reject(new Error("Pi owner is ending; no preview launch admitted."));
    this.pending++;
    return this.serial(async () => {
      if (this.ending) throw new Error("Pi owner is ending; no preview launch admitted.");
      if (request.action === "start") this.attempted = true;
      const run = async (request: PreviewRequest) =>
        this.adapter.request(
          { ...request, workspace: this.identity.workspace },
          this.root,
          await this.config(),
          this.identity,
          // A start publishes each change it has made as it makes it: a stopped app must not
          // look ready while its replacement waits for readiness.
          (result) => this.publish(request, { result }),
        );
      try {
        const result = await run(request);
        this.publish(request, { result });
        return result;
      } catch (error) {
        if (request.action !== "start") {
          this.publish(request, { error });
          throw error;
        }
        // A failed start may already have stopped the app it replaced, or launched one it could
        // not observe. Only the adapter can tell, so read the workspace before the next request.
        const status: PreviewRequest = { action: "status", workspace: this.identity.workspace };
        try {
          this.publish(status, { result: await run(status) });
        } catch (statusError) {
          const attempted = error instanceof PreviewStartError ? error.instance : undefined;
          this.publish(status, { error: statusError, attempted });
        }
        throw error;
      }
    }).finally(() => {
      this.pending--;
    });
  }

  /** Called at transport exit, before waiting for adapter locks or supervisor commands. */
  disconnect() {
    this.ending = true;
    if (this.warming) clearTimeout(this.warming.timer);
    this.warming = undefined;
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
