/** Internal to PiHistory: one lazy worker, bounded distinct jobs, in-flight reuse only. */
import { stat } from "node:fs/promises";
import { SHARE_ENV, Worker } from "node:worker_threads";
import { retainImagePreview } from "./ImagePreviews.ts";
import type { HistoryReply, HistoryRequest } from "./PiHistoryWorker.ts";

type Job = {
  readonly key: string;
  readonly request: HistoryRequest;
  readonly promise: Promise<HistoryReply>;
  readonly resolve: (reply: HistoryReply) => void;
};
const failed: HistoryReply = { error: true };

export class PiHistoryJobs {
  private worker: Worker | undefined;
  private active: Job | undefined;
  private deadline: ReturnType<typeof setTimeout> | undefined;
  private readonly jobs = new Map<string, Job>();
  private closed = false;

  async read(request: HistoryRequest): Promise<HistoryReply> {
    // Stat on every observation, even while another projection is running. A mutation gets a
    // distinct job. No completed result is retained: subsequent reads always consult Pi again.
    let version: string;
    try {
      const s = await stat(request.path, { bigint: true });
      version = [s.dev, s.ino, s.mode, s.size, s.mtimeNs, s.ctimeNs].join(":");
    } catch {
      return failed;
    }
    if (this.closed) return failed;
    const key = JSON.stringify([request.operation, request.path, request.sessionId, version]);
    const existing = this.jobs.get(key);
    if (existing) return existing.promise;
    // Bound both CPU parallelism and queued file identities. Overload uses the existing
    // unreadable-history result rather than spawning more workers or retaining arbitrary work.
    if (this.jobs.size >= 64) return failed;
    let resolve!: (reply: HistoryReply) => void;
    const promise = new Promise<HistoryReply>((done) => {
      resolve = done;
    });
    this.jobs.set(key, { key, request, promise, resolve });
    this.next();
    return promise;
  }

  private next() {
    if (this.closed || this.active || !this.jobs.size) return;
    this.active = this.jobs.values().next().value!;
    try {
      if (!this.worker) {
        // Redaction reads the current environment, including secrets added after worker startup.
        // This worker only reads environment/history; it never starts Pi or writes either.
        const worker = new Worker(new URL("./PiHistoryWorker.ts", import.meta.url), {
          env: SHARE_ENV,
          // The worker has its own entry point; do not rerun server/test --import preloads.
          execArgv: [],
        });
        this.worker = worker;
        worker.on("message", (reply: HistoryReply) => {
          if (this.worker !== worker) return;
          clearTimeout(this.deadline);
          const job = this.active!;
          this.active = undefined;
          this.jobs.delete(job.key);
          if ("value" in reply) for (const image of reply.images ?? []) retainImagePreview(image);
          job.resolve(reply);
          this.next();
        });
        worker.on("error", () => this.fail(worker));
        worker.on("exit", () => this.fail(worker));
      }
      const worker = this.worker;
      this.deadline = setTimeout(() => this.fail(worker), 60_000);
      worker.postMessage(this.active.request);
    } catch {
      this.fail(this.worker);
    }
  }

  private fail(worker: Worker | undefined) {
    if (this.worker !== worker) return;
    this.worker = undefined;
    clearTimeout(this.deadline);
    this.active = undefined;
    for (const job of this.jobs.values()) job.resolve(failed);
    this.jobs.clear();
    // Error/exit/deadline never leaves pending readers hanging. A later read starts afresh.
    if (worker) void worker.terminate();
  }

  async close() {
    this.closed = true;
    const worker = this.worker;
    this.fail(worker);
    if (worker) await worker.terminate();
  }
}
