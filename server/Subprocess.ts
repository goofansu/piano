/** The one subprocess runner. It owns spawning, closed stdin, bounded output, accepted exit
 * codes, timeout and cancellation; callers only phrase failures for users. Tool binaries are
 * References, the seam through which tests supply fakes (Worktrunk's lives in Worktrees.ts).
 */
import { type ChildProcess, spawn } from "node:child_process";
import { Context, Data, Effect } from "effect";

export const GitCommand = Context.Reference<string>("piano/GitCommand", { defaultValue: () => "git" });
export const GhCommand = Context.Reference<string>("piano/GhCommand", { defaultValue: () => "gh" });

export interface RunOptions {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd?: string;
  /** Defaults to the server's environment. */
  readonly env?: NodeJS.ProcessEnv;
  /** Stdin always closes after this, so a headless prompt fails rather than waits. */
  readonly input?: Buffer | string;
  /** Stdout byte limit (default 8 MiB). Exceeding it fails unless `truncate` keeps the head. */
  readonly limit?: number;
  readonly truncate?: boolean;
  /** Exit codes that count as success (default `[0]`). */
  readonly okCodes?: readonly number[];
  readonly timeout?: number;
  /** Run in its own process group with output discarded; cancellation kills the whole group. */
  readonly group?: boolean;
}
export interface RunResult { readonly stdout: Buffer; readonly code: number; readonly truncated: boolean }

export class SubprocessError extends Data.TaggedError("SubprocessError")<{
  readonly reason: "start" | "exit" | "limit" | "timeout" | "aborted";
  readonly command: string;
  readonly code: number | null;
  /** The first 16 KiB of stderr. */
  readonly stderr: string;
  readonly limit: number;
  readonly cause?: unknown;
}> {
  override get message() {
    switch (this.reason) {
      case "start": return this.cause instanceof Error ? this.cause.message : `Could not start ${this.command}.`;
      case "exit": return this.stderr.trim() || `exit ${this.code}`;
      case "limit": return `Output exceeds ${this.limit} bytes.`;
      case "timeout": return `${this.command} timed out.`;
      default: return "The operation was aborted";
    }
  }
}

const STDERR = 16 * 1024;

export function runAsync(options: RunOptions, signal?: AbortSignal): Promise<RunResult> {
  const { command, args, limit = 8 * 1024 * 1024, truncate = false, okCodes = [0], timeout, group = false } = options;
  const timer = timeout === undefined ? undefined : AbortSignal.timeout(timeout);
  const abort = signal && timer ? AbortSignal.any([signal, timer]) : signal ?? timer;
  return new Promise((resolve, reject) => {
    let stderr = "", stopped: "timeout" | "aborted" | undefined;
    const fail = (reason: SubprocessError["reason"], code: number | null = null, cause?: unknown) =>
      reject(new SubprocessError({ reason, command, code, stderr, limit, ...(cause === undefined ? {} : { cause }) }));
    if (abort?.aborted) return fail(timer?.aborted ? "timeout" : "aborted");
    let child: ChildProcess;
    try {
      child = spawn(command, [...args], { cwd: options.cwd, env: options.env ?? process.env, detached: group, stdio: group ? "ignore" : "pipe" });
    } catch (error) { return fail("start", null, error); }
    const stop = () => {
      stopped = timer?.aborted ? "timeout" : "aborted";
      if (group && child.pid) { try { process.kill(-child.pid, "SIGKILL"); } catch { /* already exited */ } }
      else child.kill();
    };
    const done = () => abort?.removeEventListener("abort", stop);
    abort?.addEventListener("abort", stop, { once: true });
    const chunks: Buffer[] = [];
    let size = 0, overflow = false;
    child.stdout?.on("data", (chunk: Buffer) => {
      const remaining = limit - size;
      if (chunk.length > remaining) overflow = true;
      if (remaining > 0) { const kept = chunk.subarray(0, remaining); chunks.push(kept); size += kept.length; }
      if (overflow && !truncate) child.kill();
    });
    child.stderr?.on("data", (chunk: Buffer) => { if (stderr.length < STDERR) stderr = (stderr + chunk.toString()).slice(0, STDERR); });
    child.stdin?.on("error", () => {});
    child.stdin?.end(options.input);
    child.on("error", error => { done(); fail(stopped ?? "start", null, error); });
    // After cancellation, settle on exit: descendants may still hold the output pipes.
    child.on("exit", code => { if (stopped) { done(); fail(stopped, code); } });
    child.on("close", code => {
      done();
      if (stopped) fail(stopped, code);
      else if (overflow && !truncate) fail("limit", code);
      else if (code === null || !okCodes.includes(code)) fail("exit", code);
      else resolve({ stdout: Buffer.concat(chunks), code, truncated: overflow });
    });
  });
}

/** Interruption cancels and kills the child. */
export const run = (options: RunOptions): Effect.Effect<RunResult, SubprocessError> => Effect.tryPromise({
  try: signal => runAsync(options, signal),
  catch: error => error instanceof SubprocessError ? error
    : new SubprocessError({ reason: "start", command: options.command, code: null, stderr: "", limit: 0, cause: error }),
});
