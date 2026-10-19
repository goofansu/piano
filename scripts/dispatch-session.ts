#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import {
  closeSync,
  openSync,
  readFileSync,
  realpathSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  dispatchConfiguration,
  nodeSocketEnvironment,
} from "../extensions/piano-sessions/NodeSocket.ts";
import { startSession } from "../extensions/piano-sessions/SessionDispatch.ts";
import { gitEnvironment } from "../server/GitEnvironment.ts";
import { decodeServerMessage, encodeClientMessage, type ThinkingLevel } from "../shared/wire.ts";
import type { SocketEnvironment } from "../web/src/lib/ws.ts";

const usage = `Usage: node scripts/dispatch-session.ts <prompt-file> <cwd> [out-file] [options]
       node scripts/dispatch-session.ts --register-only <cwd> [options]

Options:
  --ws-url URL          Override PIANO_SESSION_WS_URL (loopback ws[s]://host:port/ws)
  --origin ORIGIN       Override PIANO_SESSION_ORIGIN (allowed HTTP(S) origin, no trailing /)
  --model provider/id   New session model; omitted uses Piano's default
  --thinkingLevel LEVEL  off, minimal, low, medium, high, xhigh, max; omitted uses Piano's default
  --help               Show this help

Prints start JSON to stdout, and optionally saves it exclusively to out-file.
Exit codes: 0 result reported (inspect creation/submission), 1 unexpected failure,
2 invalid input/configuration, 3 output already exists, 4 worktree registration failed.
Never automatically retry an uncertain dispatch; inspect Piano first.`;

class CliError extends Error {
  readonly exitCode: number;
  constructor(exitCode: number, message: string) {
    super(message);
    this.exitCode = exitCode;
  }
}

/** Git owns checkout identity; realpath handles macOS /tmp and /var aliases too. */
function mainFolderOf(cwd: string): string | null {
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", cwd, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...gitEnvironment(), LC_ALL: "C" },
    });
  let gitDir: string;
  try {
    gitDir = git("rev-parse", "--absolute-git-dir").replace(/\n$/, "");
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & { stderr?: string };
    if (failure.code === "ENOENT") throw new CliError(2, "git must be installed and on PATH");
    if (failure.stderr?.includes("fatal: not a git repository")) return null;
    throw new CliError(4, `Cannot inspect Git checkout: ${failure.message}`);
  }
  // Ask Git for the main checkout instead of assuming its metadata lives at <root>/.git.
  const commonDir = git("rev-parse", "--git-common-dir").replace(/\n$/, "");
  if (realpathSync(gitDir) === realpathSync(resolve(cwd, commonDir))) return null;
  const root = realpathSync(git("rev-parse", "--show-toplevel").replace(/\n$/, ""));
  if (root !== cwd) throw new CliError(4, `Use the linked worktree root as cwd: ${root}`);
  const first = git("worktree", "list", "--porcelain", "-z").split("\0\0")[0];
  const path = first?.split("\0")[0];
  if (!path?.startsWith("worktree ") || first.split("\0").includes("bare"))
    throw new CliError(4, "Linked worktree has no main checkout to register under");
  return realpathSync(path.slice("worktree ".length));
}

/** One request, no retry: an uncertain registration must never fall through to creation. */
function registerWorktree(
  environment: SocketEnvironment,
  folder: string,
  path: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const requestId = environment.nonce();
    let done = false;
    const finish = (error?: Error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket.close();
      if (error) reject(error);
      else resolve();
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const socket = environment.open(environment.url(), {
      open: () =>
        socket.send(encodeClientMessage({ _tag: "add_worktree", requestId, folder, path })),
      error: () => finish(new Error("add_worktree socket error")),
      close: () => finish(new Error("add_worktree socket closed before a reply")),
      message: (data) => {
        if (done) return;
        try {
          const message = decodeServerMessage(data);
          socket.send(encodeClientMessage({ _tag: "ack", deliveryId: message.deliveryId }));
          if (message._tag !== "worktree_result" || message.requestId !== requestId) return;
          if (message.result.status === "ready") {
            if (
              realpathSync(message.result.folder) !== folder ||
              realpathSync(message.result.path) !== path
            )
              throw new Error("add_worktree returned a different folder or worktree");
            finish();
          } else finish(new Error(`add_worktree refused: ${message.result.detail}`));
        } catch (error) {
          finish(error instanceof Error ? error : new Error(String(error)));
        }
      },
    });
    timer = setTimeout(() => finish(new Error("add_worktree timed out")), 30_000);
  });
}

function argumentsFromCommandLine() {
  try {
    return parseArgs({
      allowPositionals: true,
      options: {
        help: { type: "boolean" },
        "register-only": { type: "boolean" },
        "ws-url": { type: "string" },
        origin: { type: "string" },
        model: { type: "string" },
        thinkingLevel: { type: "string" },
      },
    });
  } catch (error) {
    throw new CliError(2, `${(error as Error).message}\n${usage}`);
  }
}

async function main() {
  const { values, positionals } = argumentsFromCommandLine();
  if (values.help) {
    console.log(usage);
    return;
  }
  const registerOnly = values["register-only"];
  if (registerOnly ? positionals.length !== 1 : positionals.length < 2 || positionals.length > 3)
    throw new CliError(2, usage);
  if (registerOnly && (values.model !== undefined || values.thinkingLevel !== undefined))
    throw new CliError(2, "--model and --thinkingLevel require a session dispatch");
  const model = values.model;
  if (model !== undefined && !/^[^/\s]+\/\S+$/.test(model))
    throw new CliError(2, "--model must be provider/id");
  const thinkingLevel = values.thinkingLevel as ThinkingLevel | undefined;
  if (
    thinkingLevel !== undefined &&
    !["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(thinkingLevel)
  )
    throw new CliError(
      2,
      "Invalid --thinkingLevel; choose off, minimal, low, medium, high, xhigh or max",
    );
  const config = dispatchConfiguration({
    ...process.env,
    PIANO_SESSION_WS_URL: values["ws-url"] ?? process.env.PIANO_SESSION_WS_URL,
    PIANO_SESSION_ORIGIN: values.origin ?? process.env.PIANO_SESSION_ORIGIN,
  });
  if (!config)
    throw new CliError(
      2,
      "Set --ws-url / PIANO_SESSION_WS_URL to a loopback ws[s]://host:port/ws URL and --origin / PIANO_SESSION_ORIGIN to an allowed HTTP(S) origin (no path or trailing slash).",
    );
  let cwd: string;
  let prompt = "";
  try {
    cwd = realpathSync(positionals[registerOnly ? 0 : 1]);
    if (!statSync(cwd).isDirectory()) throw new Error("cwd must be a directory");
    if (!registerOnly) {
      prompt = readFileSync(positionals[0], "utf8");
      if (!prompt.trim()) throw new Error("prompt file must not be empty");
    }
  } catch (error) {
    throw new CliError(2, (error as Error).message);
  }
  const outFile = registerOnly ? undefined : positionals[2];
  let output: number | undefined;
  if (outFile !== undefined) {
    try {
      // Reserve before any network side effect, including concurrent invocations.
      output = openSync(outFile, "wx", 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST")
        throw new CliError(
          3,
          `Refusing: ${outFile} exists; inspect it and Piano before dispatching again`,
        );
      throw new CliError(2, `Cannot open output file: ${(error as Error).message}`);
    }
  }
  let dispatched = false;
  try {
    const folder = mainFolderOf(cwd);
    const environment = nodeSocketEnvironment(config);
    if (folder) {
      try {
        await registerWorktree(environment, folder, cwd);
      } catch (error) {
        throw new CliError(
          4,
          `Refusing to create a session: ${(error as Error).message} (folder ${folder}, worktree ${cwd})`,
        );
      }
    }
    if (registerOnly) {
      console.log(JSON.stringify({ registered: folder !== null, cwd, folder }, null, 2));
      return;
    }
    dispatched = true;
    const result = await startSession({ prompt, cwd, model, thinkingLevel }, environment);
    const link = result.handle
      ? new URL(`/s/${encodeURIComponent(result.handle.sessionId)}`, config.origin).href
      : null;
    const json = JSON.stringify(
      {
        ...result,
        link,
        worktreeOf: folder,
        model: model ?? null,
        thinkingLevel: thinkingLevel ?? null,
      },
      null,
      2,
    );
    if (output !== undefined) writeFileSync(output, `${json}\n`);
    console.log(json);
  } finally {
    if (output !== undefined) {
      closeSync(output);
      // Once creation was attempted, even an empty file is a guard against blind retry.
      if (!dispatched) unlinkSync(outFile!);
    }
  }
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = error instanceof CliError ? error.exitCode : 1;
}
