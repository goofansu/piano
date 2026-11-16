import { type ChildProcess, spawn } from "node:child_process";
import { Context, Data, Effect } from "effect";
import { childEnvironment } from "./ChildEnvironment.ts";

export const GitCommand = Context.Reference<string>("piano/GitCommand", {
  defaultValue: () => "git",
});
export const GhCommand = Context.Reference<string>("piano/GhCommand", {
  defaultValue: () => process.env.PIANO_GH_CLI || "gh",
});

export interface RunOptions {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly input?: Buffer | string;
  readonly limit?: number;
  readonly truncate?: boolean;
  readonly okCodes?: readonly number[];
  readonly timeout?: number;
  readonly group?: boolean;
}
export interface RunResult {
  readonly stdout: Buffer;
  readonly code: number;
  readonly truncated: boolean;
}

export class SubprocessError extends Data.TaggedError("SubprocessError")<{
  readonly reason: "start" | "exit" | "limit" | "timeout" | "aborted";
  readonly command: string;
  readonly code: number | null;
  readonly stderr: string;
  readonly limit: number;
  readonly cause?: unknown;
}> {
  override get message() {
    switch (this.reason) {
      case "start":
        return this.cause instanceof Error
          ? this.cause.message
          : `Could not start ${this.command}.`;
      case "exit":
        return this.stderr.trim() || `exit ${this.code}`;
      case "limit":
        return `Output exceeds ${this.limit} bytes.`;
      case "timeout":
        return `${this.command} timed out.`;
      default:
        return "The operation was aborted";
    }
  }
}

const STDERR = 16 * 1024;
const TERMINATION_GRACE = 250;
const KILL_WAIT = 250;

export function runAsync(options: RunOptions, signal?: AbortSignal): Promise<RunResult> {
  const {
    command,
    args,
    limit = 8 * 1024 * 1024,
    truncate = false,
    okCodes = [0],
    timeout,
    group = false,
  } = options;
  return new Promise((resolve, reject) => {
    let stderr = "",
      stopped: "timeout" | "aborted" | "limit" | undefined;
    let settled = false,
      exited = false,
      escalated = false;
    let exitCode: number | null = null;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    let escalation: ReturnType<typeof setTimeout> | undefined;
    let killWait: ReturnType<typeof setTimeout> | undefined;
    const fail = (reason: SubprocessError["reason"], code: number | null = null, cause?: unknown) =>
      reject(
        new SubprocessError({
          reason,
          command,
          code,
          stderr,
          limit,
          ...(cause === undefined ? {} : { cause }),
        }),
      );
    if (signal?.aborted) return fail("aborted");
    let child: ChildProcess;
    try {
      child = spawn(command, [...args], {
        cwd: options.cwd,
        env: options.env ?? childEnvironment(),
        detached: group,
        stdio: group ? "ignore" : "pipe",
      });
    } catch (error) {
      return fail("start", null, error);
    }
    const send = (signal: NodeJS.Signals) => {
      try {
        if (group && child.pid) process.kill(-child.pid, signal);
        else if (!exited) child.kill(signal);
      } catch {}
    };
    const done = () => {
      settled = true;
      clearTimeout(deadline);
      clearTimeout(escalation);
      clearTimeout(killWait);
      signal?.removeEventListener("abort", abort);
      child.stdin?.destroy();
      child.stdout?.destroy();
      child.stderr?.destroy();
    };
    const finishStopped = () => {
      if (settled || !stopped) return;
      done();
      fail(stopped, exitCode);
    };
    const stop = (reason: NonNullable<typeof stopped>) => {
      if (settled || stopped) return;
      stopped = reason;
      clearTimeout(deadline);
      send("SIGTERM");
      escalation = setTimeout(() => {
        escalated = true;
        send("SIGKILL");
        if (exited) finishStopped();
        else
          killWait = setTimeout(() => {
            child.unref();
            finishStopped();
          }, KILL_WAIT);
      }, TERMINATION_GRACE);
      if (exited && !group) finishStopped();
    };
    const abort = () => stop("aborted");
    signal?.addEventListener("abort", abort, { once: true });
    if (timeout !== undefined) deadline = setTimeout(() => stop("timeout"), timeout);
    const chunks: Buffer[] = [];
    let size = 0,
      overflow = false;
    child.stdout?.on("data", (chunk: Buffer) => {
      const remaining = limit - size;
      if (chunk.length > remaining) overflow = true;
      if (remaining > 0) {
        const kept = chunk.subarray(0, remaining);
        chunks.push(kept);
        size += kept.length;
      }
      if (overflow && !truncate) stop("limit");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderr.length < STDERR) stderr = (stderr + chunk.toString()).slice(0, STDERR);
    });
    child.stdin?.on("error", () => {});
    child.stdin?.end(options.input);
    child.on("error", (error) => {
      if (settled || stopped) return;
      done();
      fail("start", null, error);
    });
    child.on("exit", (code) => {
      exited = true;
      exitCode = code;
      if (stopped && (!group || escalated)) finishStopped();
    });
    child.on("close", (code) => {
      if (settled || stopped) return;
      done();
      if (code === null || !okCodes.includes(code)) fail("exit", code);
      else resolve({ stdout: Buffer.concat(chunks), code, truncated: overflow });
    });
  });
}

export const run = (options: RunOptions): Effect.Effect<RunResult, SubprocessError> =>
  Effect.tryPromise({
    try: (signal) => runAsync(options, signal),
    catch: (error) =>
      error instanceof SubprocessError
        ? error
        : new SubprocessError({
            reason: "start",
            command: options.command,
            code: null,
            stderr: "",
            limit: 0,
            cause: error,
          }),
  });
