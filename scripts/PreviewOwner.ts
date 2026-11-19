import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { createServer, type Socket } from "node:net";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import {
  PreviewAdapter,
  PreviewBusyError,
  type PreviewConfig,
  type PreviewOwnerIdentity,
  type PreviewRequest,
  PreviewStartError,
} from "./PreviewAdapter.ts";
import { READY_INTERVAL_MS, WARMUP_SECONDS } from "./PreviewReadiness.ts";
import { PREVIEW_REQUEST_BYTES } from "./PreviewRequest.ts";

export type PreviewOutcome = { result: unknown } | { error: unknown; attempted?: unknown };

export type PreviewObserver = (request: PreviewRequest, outcome: PreviewOutcome) => void;

export type GenerationApp = Record<string, unknown> & { instanceId: string };

export type AppObservation =
  | { kind: "app"; app: GenerationApp }
  | { kind: "gone"; instanceId?: string }
  | { kind: "nothing" };

export function observeApp(
  generation: string,
  request: Pick<PreviewRequest, "action">,
  outcome: PreviewOutcome,
): AppObservation {
  if ("error" in outcome) return { kind: "nothing" };
  const { result } = outcome;
  if (typeof result !== "object" || result === null) return { kind: "nothing" };
  const app = result as Record<string, unknown>;
  const owner = app.owner as Record<string, unknown> | null | undefined;
  if (typeof app.instanceId === "string" && owner?.generation === generation)
    return { kind: "app", app: app as GenerationApp };
  if (app.status === "absent") return { kind: "gone" };
  if (app.status === "stopped" || app.status === "cleared")
    return typeof app.instanceId === "string"
      ? { kind: "gone", instanceId: app.instanceId }
      : { kind: "nothing" };
  if (request.action === "status" && typeof app.instanceId === "string") return { kind: "gone" };
  return { kind: "nothing" };
}

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
  private warming?: { instanceId: string; until: number; timer?: NodeJS.Timeout };

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
      socket.setTimeout(5000, () => socket.destroy());
      socket.setEncoding("utf8");
      let input = "";
      const receive = (chunk: string) => {
        input += chunk;
        if (Buffer.byteLength(input) > PREVIEW_REQUEST_BYTES) {
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

  observe(observer: PreviewObserver) {
    this.observer = observer;
  }

  private publish(request: PreviewRequest, outcome: PreviewOutcome) {
    this.observer?.(request, outcome);
    this.follow(request, outcome);
  }

  private follow(request: Pick<PreviewRequest, "action">, outcome: PreviewOutcome) {
    if (this.ending) return;
    const seen = observeApp(this.identity.generation, request, outcome);
    if (seen.kind === "app") {
      const { app } = seen;
      if (app.warming !== true) this.stopWarming();
      else if (this.warming?.instanceId !== app.instanceId) {
        this.stopWarming();
        const launched = typeof app.createdAt === "number" ? app.createdAt * 1000 : Date.now();
        this.warming = { instanceId: app.instanceId, until: launched + WARMUP_SECONDS * 1000 };
      }
    } else if (
      seen.kind === "gone" &&
      (seen.instanceId === undefined || seen.instanceId === this.warming?.instanceId)
    )
      this.stopWarming();
    const warming = this.warming;
    if (!warming || warming.timer) return;
    if (Date.now() >= warming.until) {
      this.warming = undefined;
      return;
    }
    warming.timer = setTimeout(() => this.check(warming), READY_INTERVAL_MS);
    warming.timer.unref();
  }

  private stopWarming() {
    clearTimeout(this.warming?.timer);
    this.warming = undefined;
  }

  private check(warming: NonNullable<PreviewOwner["warming"]>) {
    void this.serial(async () => {
      if (this.ending || this.warming !== warming) return;
      const status: PreviewRequest = { action: "status", workspace: this.identity.workspace };
      let outcome: PreviewOutcome;
      try {
        outcome = {
          result: await this.adapter.request(
            status,
            this.root,
            await this.config(),
            this.identity,
            undefined,
            false,
          ),
        };
      } catch (error) {
        outcome = { error };
      }
      if (this.ending || this.warming !== warming) return;
      warming.timer = undefined;
      if ("error" in outcome && outcome.error instanceof PreviewBusyError)
        this.follow(status, outcome);
      else this.publish(status, outcome);
    });
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

  disconnect() {
    this.ending = true;
    this.stopWarming();
    if (!this.disposed) {
      for (const socket of this.sockets) socket.destroy();
      this.disposed = new Promise<void>((resolve) => this.server.close(() => resolve())).then(() =>
        rm(join(this.identity.endpoint, ".."), { recursive: true, force: true }),
      );
      void this.disposed.catch(() => {});
    }
  }

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
