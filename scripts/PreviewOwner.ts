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

/** An adapter outcome. A failed observation after a failed start carries the instance that start
 * saved, if any: it may be running. */
export type PreviewOutcome = { result: unknown } | { error: unknown; attempted?: unknown };

/** What each admitted request showed: a start's progress (the app it replaced stopped, then its
 * own launch starting), its own outcome, or for a failed start, a status read of what that start
 * left behind. */
export type PreviewObserver = (request: PreviewRequest, outcome: PreviewOutcome) => void;

/** This generation's app as an adapter result shows it. */
export type GenerationApp = Record<string, unknown> & { instanceId: string };

/** What an outcome says about this generation's app, decided once for the owner's warming checks
 * and for the session's projection alike:
 * - `app`: an observation of this generation's app;
 * - `gone`: this session has no app (`instanceId` undefined: an absent record, or a status read
 *   finding another owner's app) or no longer the named instance (a confirmed stop or clear);
 * - `nothing`: nothing about the app, which stays as it was last seen. An error, busy or not, and
 *   a request naming an instance that is not current (`not-current`) observe nothing. */
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
  // A status naming another owner's app: this session has none in its workspace.
  if (request.action === "status" && typeof app.instanceId === "string") return { kind: "gone" };
  return { kind: "nothing" };
}

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
  /** The warming-up app whose readiness this owner keeps checking, until when at the latest, and
   * its scheduled or running check. */
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

  /** Publish an outcome to the observer, then let it decide the warming check. */
  private publish(request: PreviewRequest, outcome: PreviewOutcome) {
    this.observer?.(request, outcome);
    this.follow(request, outcome);
  }

  /** The one rule for checking a warming-up app, on the same reading of an outcome as the
   * session's projection (`observeApp`): an observation of this generation's app starts or ends
   * the check, and the app gone ends it; an outcome that observed nothing (an error, busy or not,
   * or a stale request's `not-current`) keeps checking the same app. A start's deadline ends only
   * its caller's wait. The check ends once the app answers, exits or is replaced, and at the
   * latest when its warm-up window after launch closes, so a persistent error cannot keep it
   * checking forever. */
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
    // A pending check never keeps a process alive by itself.
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
      // Another request may have replaced or stopped the app while this one waited.
      if (this.ending || this.warming !== warming) return;
      warming.timer = undefined;
      // A busy lock observed nothing worth showing: the app is as warm as it was.
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
    this.stopWarming();
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
