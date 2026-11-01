import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  access,
  mkdir,
  open,
  readdir,
  readFile,
  readlink,
  realpath,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { createConnection, createServer, type Server } from "node:net";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { outcomeFailed, outcomePath, readOutcome } from "./PreviewOutcome.ts";
import {
  LOCK_WAIT_MS,
  READY_INTERVAL_MS,
  READY_REQUEST_TIMEOUT_MS,
  START_TIMEOUT_SECONDS,
  WARMUP_SECONDS,
} from "./PreviewReadiness.ts";

export interface PreviewRequest {
  action: "start" | "status" | "stop";
  workspace: string;
  command?: string[];
  env?: Record<string, string>;
  readyPath?: string;
  timeoutSeconds?: number;
  instanceId?: string;
  /** The exact current instanceId to stop and launch again, with this request's launch. */
  replace?: string;
}
export interface PreviewConfig {
  origin?: string;
  ports?: number[];
  reservedPorts?: number[];
  path?: string;
}
interface LaunchSpec {
  command: string[];
  env: Record<string, string>;
  readyPath: string;
  origin: string;
  path: string;
}
/** Trusted by the session broker, never taken from tool arguments. Not a reusable PID. */
export interface PreviewOwnerIdentity {
  generation: string;
  sessionId: string;
  workspace: string;
  endpoint: string;
}
interface Intent {
  owner?: PreviewOwnerIdentity;
  serviceId: string;
  instanceId: string;
  unit: string;
  workspace: string;
  spec: LaunchSpec;
  port: number;
  createdAt: number;
  invocation?: string;
  /** Retained for launchd's asynchronous bootout confirmation; never used to signal a PID. */
  processGroup?: number;
  /** When readiness was first observed: an app that answered once is no longer warming up. */
  readyAt?: number;
}
/** The app's lifecycle in the same words on every supervisor. */
export type PreviewState = "starting" | "running" | "exited" | "failed" | "stopping" | "not-loaded";
interface UnitState {
  state: PreviewState;
  /** Identifies one run of the unit; a different value means someone else restarted it. */
  invocation?: string;
  /** The supervisor's own fields, for diagnosis only. */
  raw: Record<string, string>;
}
/** Runs a supervisor client. Rejects with `status` set to the exit code when it fails. */
type Run = (args: string[], timeout?: number) => Promise<string>;

/** What differs between hosts: launching, observing, owning a listener, stopping and logs. */
interface Supervisor {
  /** Throws unless this host can own an app outside the caller's termination scope. */
  check(): Promise<void>;
  unit(serviceId: string, instanceId: string): string;
  submit(record: Intent, argv: string[], root: string): Promise<void>;
  state(record: Intent): Promise<UnitState>;
  /** Every listener on the record's port is loopback and belongs to this unit's processes. */
  ownsListener(record: Intent, state: UnitState): Promise<boolean>;
  /** Returns once the unit's processes are gone; throws if that cannot be established. */
  stop(record: Intent, state: UnitState, root: string): Promise<void>;
  /** Removes anything the supervisor kept for the record, once it no longer runs. */
  forget(record: Intent, root: string): Promise<void>;
  logs(record: Intent, root: string): Promise<string>;
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** An intent as callers see it: the owner without its endpoint, env names without values. */
const publicIntent = (record: Intent) => ({
  ...record,
  owner: record.owner
    ? {
        sessionId: record.owner.sessionId,
        generation: record.owner.generation,
        workspace: record.owner.workspace,
      }
    : undefined,
  spec: { ...record.spec, env: Object.keys(record.spec.env) },
});

/**
 * An app observation: the public intent with its state, readiness and where opening it works.
 * Every observation, including a launch's first `starting` progress, is built here, so a
 * consumer reading one (PreviewProjection) never sees two shapes. A loopback origin is opened on
 * this host, exactly where readiness was observed.
 */
const observation = <
  Rest extends {
    state: string;
    ready: boolean;
    warming: boolean;
    url: string | null;
    detail: string;
  },
>(
  record: Intent,
  rest: Rest,
) => ({
  ...publicIntent(record),
  ...rest,
  externalAccess: loopbackOrigin.test(record.spec.origin)
    ? ("same-host" as const)
    : ("unverified" as const),
  observedAt: Date.now() / 1000,
});

/** A start that failed after saving its launch intent: `instance` may be running, or not. */
export class PreviewStartError extends Error {
  readonly instance: ReturnType<typeof publicIntent>;
  constructor(cause: unknown, record: Intent) {
    super(message(cause), { cause });
    this.instance = publicIntent(record);
  }
}
const code = (error: unknown) => (error as NodeJS.ErrnoException).code;
const exitStatus = (error: unknown) => (error as { status?: number }).status;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
/** Longer than any bounded submission, so an orphaned submission has finished or failed. */
const SUBMISSION_GRACE_SECONDS = 120;
const unsupported =
  "Managed previews unsupported: require Linux with a lingering systemd user manager, or macOS with a logged-in user session (launchd). No detached fallback.";

/** Bounded tails, bounded execution, and no caller credentials, even for supervisor clients. */
function hostRun(platform: string): Run {
  const env =
    platform === "darwin"
      ? { PATH: "/usr/bin:/bin:/usr/sbin:/sbin" }
      : {
          PATH: "/usr/bin:/bin",
          XDG_RUNTIME_DIR: `/run/user/${process.getuid?.()}`,
          DBUS_SESSION_BUS_ADDRESS: `unix:path=/run/user/${process.getuid?.()}/bus`,
        };
  return (args, timeout = 5000) =>
    new Promise((resolve, reject) => {
      const child = spawn(args[0], args.slice(1), { env, stdio: ["ignore", "pipe", "pipe"] });
      let stdout = Buffer.alloc(0);
      let stderr = Buffer.alloc(0);
      let expired = false;
      const timer = setTimeout(() => {
        expired = true;
        child.kill("SIGKILL");
      }, timeout);
      child.stdout.on("data", (data: Buffer) => {
        stdout = Buffer.concat([stdout, data]).subarray(-16000);
      });
      child.stderr.on("data", (data: Buffer) => {
        stderr = Buffer.concat([stderr, data]).subarray(-2000);
      });
      child.on("error", (error) => {
        clearTimeout(timer);
        reject(new Error(`${args[0]} unavailable: ${message(error).slice(-2000)}`));
      });
      child.on("close", (status) => {
        clearTimeout(timer);
        if (expired) reject(new Error(`${args[0]} timed out; read status before another start.`));
        else if (status !== 0)
          reject(Object.assign(new Error(`${args[0]} failed: ${stderr.toString()}`), { status }));
        else resolve(stdout.toString());
      });
    });
}

async function save(path: string, record: Intent) {
  const temporary = `${path}.tmp`;
  const file = await open(temporary, "w", 0o600);
  try {
    await file.writeFile(JSON.stringify(record));
    await file.sync();
  } finally {
    await file.close();
  }
  await rename(temporary, path);
  const directory = await open(join(path, ".."), "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

async function listen(server: Server, options: Parameters<Server["listen"]>[0]) {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
}
async function close(server: Server) {
  if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
}

/** The account-wide lock stayed held past its wait: nothing was observed or attempted. */
export class PreviewBusyError extends Error {
  constructor() {
    super("Preview operation busy. Re-observe status before retrying; no launch attempted.");
  }
}

/** An exclusive SQLite transaction is a kernel file lock on Linux and macOS alike: released on
 * exit or SIGKILL, with no stale file or PID-reuse race. All helpers share one state root. */
async function lock(root: string, wait: number) {
  const deadline = performance.now() + wait;
  const database = new DatabaseSync(join(root, "lock.sqlite"));
  for (;;) {
    try {
      database.exec("BEGIN EXCLUSIVE");
      return database;
    } catch (error) {
      if (!/database is locked/.test(message(error)) || performance.now() >= deadline) {
        database.close();
        if (!/database is locked/.test(message(error))) throw error;
        throw new PreviewBusyError();
      }
      await delay(100);
    }
  }
}
function unlock(database: DatabaseSync) {
  try {
    database.exec("ROLLBACK");
  } finally {
    database.close();
  }
}

/** Sends the Host a browser sends through the preview URL, so a framework's host check is seen. */
function httpStatus(
  port: number,
  path: string,
  host: string,
  timeout = READY_REQUEST_TIMEOUT_MS,
): Promise<number> {
  return new Promise((resolve, reject) => {
    // Absolute wall deadline, not a socket inactivity timeout (a slow responder must not extend it).
    const request = httpRequest(
      { hostname: "127.0.0.1", port, path, method: "GET", agent: false, headers: { host } },
      (response) => {
        resolve(response.statusCode ?? 0);
        response.destroy();
      },
    );
    const timer = setTimeout(
      () => request.destroy(new Error(`no answer within ${Math.ceil(timeout / 1000)}s`)),
      timeout,
    );
    request.on("error", reject);
    request.on("close", () => clearTimeout(timer));
    request.end();
  });
}

/** Only kernel refusal/absence proves the old generation endpoint is gone. A timeout or any
 * other observation failure is unknown, so another session must still report a conflict. */
function ownerGone(endpoint: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection(endpoint);
    const done = (gone: boolean) => {
      socket.destroy();
      resolve(gone);
    };
    socket.setTimeout(1000, () => done(false));
    socket.on("connect", () => done(false));
    socket.on("error", (error) => done(["ENOENT", "ECONNREFUSED"].includes(code(error) ?? "")));
  });
}

const loopbackOrigin = /^http:\/\/(localhost|127\.0\.0\.1)$/;
const exeDevOrigin = /^https:\/\/[a-zA-Z0-9-]+\.exe\.xyz$/;

/** Probes each address alone. macOS lets a wildcard bind share a port that another process holds
 * on 127.0.0.1, so the app's own loopback address is probed as well as the wildcards. */
async function free(port: number) {
  const probes: Parameters<Server["listen"]>[0][] = [
    { host: "127.0.0.1", port },
    { host: "0.0.0.0", port },
    { host: "::", port, ipv6Only: true },
  ];
  for (const probe of probes) {
    const server = createServer();
    try {
      await listen(server, probe);
    } catch (error) {
      // A host without IPv6 cannot conflict on it; only a busy address disqualifies the port.
      const ipv6Missing = ["EAFNOSUPPORT", "EADDRNOTAVAIL"].includes(code(error) ?? "");
      if (!(probe.host === "::" && ipv6Missing)) return false;
    } finally {
      await close(server);
    }
  }
  return true;
}

async function choosePort(config: PreviewConfig, root: string, origin: string) {
  // Piano's own defaults: backend 7070, Vite 5173, exe.dev units 8000/8001.
  const reserved = new Set([5173, 7070, 8000, 8001, ...(config.reservedPorts ?? [])]);
  for (const file of (await readdir(root)).filter((name) => name.endsWith(".json"))) {
    reserved.add((JSON.parse(await readFile(join(root, file), "utf8")) as Intent).port);
  }
  const ports = config.ports ?? Array.from({ length: 7000 }, (_, i) => 3000 + i);
  // exe.dev's proxy serves 3000–9999; a loopback origin needs only an unprivileged port.
  const [low, high] = loopbackOrigin.test(origin) ? [1024, 65535] : [3000, 9999];
  if (!ports.length || ports.some((p) => !Number.isInteger(p) || p < low || p > high)) {
    throw new Error(`ports must be integers in the origin's supported range ${low}–${high}`);
  }
  for (const port of ports) if (!reserved.has(port) && (await free(port))) return port;
  throw new Error(
    "No free supported preview port; check configured ports/reservations. No listener was stopped.",
  );
}

async function runnableFile(path: string) {
  try {
    await access(path, constants.X_OK);
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

/** A bare name resolves against the app's own PATH, so the saved launch names an absolute file. */
async function executable(name: string, path: string) {
  if (name.includes("/")) {
    if (!isAbsolute(name)) throw new Error("command[0] must be a bare name or an absolute path");
    return name;
  }
  for (const directory of path.split(":").filter(isAbsolute)) {
    const candidate = join(directory, name);
    if (await runnableFile(candidate)) return candidate;
  }
  throw new Error(`command[0] "${name}" is not an executable on the app's PATH (${path})`);
}

/** A launch Piano is about to submit must name a runnable file, checked before anything stops.
 * Reuse skips this: a running app keeps its launch even if the file has since changed. */
async function checkRunnable(command: string[]) {
  if (!(await runnableFile(command[0])))
    throw new Error(
      `command[0] "${command[0]}" is not an executable file. No running preview was stopped.`,
    );
}

async function launchSpec(
  request: PreviewRequest,
  config: PreviewConfig,
  platform: string,
): Promise<LaunchSpec> {
  // A local Mac serves its previews on localhost; a remote host needs its explicit exe.dev origin.
  const origin = config.origin ?? (platform === "darwin" ? "http://localhost" : "");
  if (!loopbackOrigin.test(origin) && !exeDevOrigin.test(origin))
    throw new Error(
      "Configure origin as https://<private-vm>.exe.xyz or http://localhost (no port/path). Never infer it from headers.",
    );
  const command = request.command;
  if (
    !Array.isArray(command) ||
    !command.length ||
    command.some((arg) => typeof arg !== "string" || !arg || arg.includes("\0"))
  )
    throw new Error(
      "command must be a nonempty argv array; use {port} and strict binding, not shell backgrounding",
    );
  // `env` would read a first argument containing "=" as an assignment, not the executable.
  if (command[0].includes("=")) throw new Error("command[0] must not contain '='");
  const env = request.env ?? {};
  if (
    typeof env !== "object" ||
    Array.isArray(env) ||
    Object.entries(env).some(
      ([key, value]) =>
        !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || typeof value !== "string" || value.includes("\0"),
    )
  )
    throw new Error("env must contain explicit string environment values");
  if (Object.hasOwn(env, "PORT"))
    throw new Error("PORT is allocated by Piano; use {port} in argv or the injected PORT");
  const readyPath = request.readyPath ?? "/";
  // Node's HTTP client rejects a path outside \x21–\xff, which could never become ready.
  if (typeof readyPath !== "string" || !readyPath.startsWith("/") || /[^\x21-\xff]/.test(readyPath))
    throw new Error("readyPath must be an HTTP path");
  const path = config.path ?? "/usr/local/bin:/usr/bin:/bin";
  return {
    command: [await executable(command[0], path), ...command.slice(1)],
    env,
    readyPath,
    origin,
    path,
  };
}

/** Admission catches identifiable unsupported launches, not what arbitrary scripts do. The
 * agent must inspect the checkout's real app entry point; this is not an execution sandbox. */
async function admitLaunch(command: string[], workspace: string) {
  const refuse = (reason: string): never => {
    throw new Error(
      `Unsupported preview launch: ${reason}. Run the inspected app in this checkout; use file preview or artifact delivery for generated HTML/reports.`,
    );
  };
  const generic = /^(?:http-server|serve|static-server|live-server)(?:@[^/]+)?$/;
  const frameworks = ["vite", "next", "astro"];
  const program = basename(command[0]);
  let tool = program;
  let args = command.slice(1);
  // Recognize direct package invocations only; do not interpret scripts or shell programs.
  if (program === "npx") {
    args = args.filter((arg) => !["--yes", "-y", "--no-install", "--"].includes(arg));
    tool = args.shift() ?? "";
  } else if (
    ["npm", "pnpm", "yarn", "bun"].includes(program) &&
    ["exec", "dlx", "x"].includes(args[0])
  ) {
    args = args.slice(1).filter((arg) => !["--yes", "-y", "--"].includes(arg));
    tool = args.shift() ?? "";
  } else if (program === "node" && args[0]?.includes("node_modules/")) {
    const packageName = args[0].match(/(?:^|\/)node_modules\/([^/]+)\//)?.[1];
    if (packageName && (generic.test(packageName) || frameworks.includes(packageName))) {
      tool = packageName;
      args = args.slice(1);
    }
  }
  const python = /^python(?:\d+(?:\.\d+)*)?$/.test(program);
  const pythonArgs = python ? command.slice(1) : [];
  while (/^-(?:u|B|E|I|s|S|O|OO)$/.test(pythonArgs[0] ?? "")) pythonArgs.shift();
  const module = pythonArgs[0] === "-m" ? pythonArgs[1] : pythonArgs[0]?.match(/^-m(.+)$/)?.[1];
  if (
    generic.test(tool) ||
    (python && /^(?:http\.server|SimpleHTTPServer|CGIHTTPServer)$/.test(module ?? ""))
  )
    refuse("generic static file servers are not checkout app previews");

  const checkout = await realpath(workspace);
  const within = (path: string) => {
    const child = relative(checkout, path);
    return child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child);
  };
  const checkRoot = async (value: string) => {
    // Resolve existing ancestors too: a missing child beneath an outward symlink is outside.
    // Canonical comparison also accepts symlinked checkout spellings (e.g. /var on macOS).
    // Keep the spelling unnormalized: the kernel follows `link/..` through the link, so
    // collapsing it lexically (as `resolve` does) would check a different file than runs.
    let ancestor = isAbsolute(value) ? value : `${checkout}${sep}${value}`;
    for (;;) {
      try {
        if (!within(await realpath(ancestor)))
          refuse("an explicit launch root resolves outside this checkout");
        break;
      } catch (error) {
        if (code(error) !== "ENOENT") throw error;
        // `missing/..` has no destination until `missing` exists; refuse rather than guess.
        if (basename(ancestor) === "..")
          refuse("an explicit launch root climbs out of a missing directory");
        if (resolve(ancestor) === checkout) throw error;
        ancestor = dirname(ancestor);
      }
    }
  };
  const rootFlags = new Set([
    "--cwd",
    "--prefix",
    "--dir",
    "--directory",
    "--root",
    "--app-dir",
    "--app",
    "--chdir",
    "-C",
  ]);
  for (let i = 1; i < command.length; i++) {
    const [flag, ...value] = command[i].split("=");
    if (rootFlags.has(flag)) {
      const root = value.length ? value.join("=") : command[++i];
      if (!root || root.startsWith("-")) refuse(`missing path for ${flag}`);
      await checkRoot(root);
    }
  }
  // Unambiguous positional roots in common dev CLIs; options and opaque wrappers stay opaque.
  if (frameworks.includes(tool.replace(/@[^/]+$/, ""))) {
    const root = ["dev", "start", "preview", "serve"].includes(args[0]) ? args[1] : args[0];
    if (root && !root.startsWith("-")) await checkRoot(root);
  }
  // An explicitly named application file must belong to this checkout. Installed executables
  // still resolve on PATH; this does not restrict a language or inspect imported application code.
  const entry = python
    ? pythonArgs[0]
    : program === "node" && tool === program
      ? command[1]
      : undefined;
  if (entry && /\.(?:[cm]?js|tsx?|py)$/.test(entry)) await checkRoot(entry);
}

/** The app as `env -i` launches it: only PATH, PORT and the explicitly requested environment. */
function appArgv(record: Intent) {
  return [
    "/usr/bin/env",
    "-i",
    `PATH=${record.spec.path}`,
    `PORT=${record.port}`,
    ...Object.entries(record.spec.env)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`),
    ...record.spec.command.map((arg) => arg.replaceAll("{port}", String(record.port))),
  ];
}

/** Linux: a transient unit of the lingering user manager, outside Piano's service cgroup. */
class Systemd implements Supervisor {
  private readonly run: Run;
  private readonly uid: number;
  private readonly callerGroup: () => Promise<string>;
  constructor(run: Run, uid: number, callerGroup: () => Promise<string>) {
    this.run = run;
    this.uid = uid;
    this.callerGroup = callerGroup;
  }

  async check() {
    let group: string;
    try {
      group = (
        await this.run(["systemctl", "--user", "show", "-p", "ControlGroup", "--value"])
      ).trim();
    } catch (error) {
      throw new Error(`${unsupported} ${message(error).slice(-2000)}`);
    }
    const caller = await this.callerGroup();
    if (!group.startsWith("/user.slice/") || caller === group || group.startsWith(`${caller}/`))
      throw new Error("Cannot establish a user supervisor outside the caller's termination scope.");
    if (
      (
        await this.run(["loginctl", "show-user", String(this.uid), "-p", "Linger", "--value"])
      ).trim() !== "yes"
    )
      throw new Error(
        "User manager is not lingering. Ask the host administrator; no detached fallback.",
      );
  }

  unit(serviceId: string, instanceId: string) {
    return `${serviceId}-${instanceId}.service`;
  }

  async submit(record: Intent, argv: string[]) {
    await this.run([
      "systemd-run",
      "--user",
      `--unit=${record.unit}`,
      "--service-type=exec",
      ...(record.owner ? [] : ["--remain-after-exit"]),
      "--expand-environment=no",
      `--working-directory=${record.workspace}`,
      "--property=Restart=no",
      "--property=KillMode=control-group",
      "--property=TimeoutStopSec=5s",
      "--property=NoNewPrivileges=yes",
      "--property=StandardOutput=journal",
      "--property=StandardError=journal",
      "--property=LogRateLimitIntervalSec=10s",
      "--property=LogRateLimitBurst=100",
      "--",
      ...argv,
    ]);
  }

  async state(record: Intent): Promise<UnitState> {
    const output = await this.run([
      "systemctl",
      "--user",
      "show",
      record.unit,
      "-p",
      "LoadState,ActiveState,SubState,InvocationID,ControlGroup,Result,MainPID",
    ]);
    const raw: Record<string, string> = Object.fromEntries(
      output
        .split("\n")
        .filter((line) => line.includes("="))
        .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
    );
    const active = raw.ActiveState;
    if (
      !raw.LoadState ||
      !["active", "activating", "deactivating", "failed", "inactive", "reloading"].includes(active)
    )
      throw new Error(
        "Supervisor state is incomplete or unknown; retain ownership and retry observation.",
      );
    const state: PreviewState =
      raw.LoadState === "not-found"
        ? "not-loaded"
        : active === "active"
          ? raw.SubState === "exited"
            ? "exited"
            : "running"
          : active === "activating" || active === "reloading"
            ? "starting"
            : active === "deactivating"
              ? "stopping"
              : active === "failed"
                ? "failed"
                : "exited";
    return { state, invocation: raw.InvocationID || undefined, raw };
  }

  async ownsListener(record: Intent, state: UnitState) {
    const group = state.raw.ControlGroup;
    if (!group || state.state !== "running") return false;
    const inodes = new Set<string>();
    for (const table of ["tcp", "tcp6"]) {
      let rows: string[];
      try {
        rows = (await readFile(`/proc/net/${table}`, "utf8")).trim().split("\n").slice(1);
      } catch (error) {
        // A kernel booted without IPv6 has no tcp6 table, hence no IPv6 listener to check.
        if (table === "tcp6" && code(error) === "ENOENT") continue;
        throw error;
      }
      for (const row of rows) {
        const fields = row.trim().split(/\s+/);
        const [address, port] = fields[1].split(":");
        if (fields[3] !== "0A" || Number.parseInt(port, 16) !== record.port) continue;
        if (address !== (table === "tcp" ? "0100007F" : "00000000000000000000000001000000"))
          return false;
        inodes.add(fields[9]);
      }
    }
    if (!inodes.size) return false;
    const owned = new Set<string>();
    for (const pid of (await readdir("/proc")).filter((name) => /^\d+$/.test(name))) {
      try {
        const cgroup = (await readFile(`/proc/${pid}/cgroup`, "utf8")).trim().split("::").at(-1)!;
        if (cgroup !== group && !cgroup.startsWith(`${group}/`)) continue;
        for (const fd of await readdir(`/proc/${pid}/fd`)) {
          try {
            const target = await readlink(`/proc/${pid}/fd/${fd}`);
            if (target.startsWith("socket:[")) owned.add(target.slice(8, -1));
          } catch {
            /* The process may close an FD while observed. */
          }
        }
      } catch {
        /* Processes can exit or be inaccessible. Fail closed on ownership. */
      }
    }
    return [...inodes].every((inode) => owned.has(inode));
  }

  async stop(record: Intent) {
    // KillMode=control-group: stop returns once every process in the unit's cgroup is gone.
    await this.run(["systemctl", "--user", "stop", record.unit], 15000);
    const after = await this.state(record);
    if (!["exited", "failed", "not-loaded"].includes(after.state))
      throw new Error(
        "Stop has not completed; retain identity and re-observe before another launch.",
      );
    if (after.state === "failed")
      await this.run(["systemctl", "--user", "reset-failed", record.unit]);
  }

  async forget() {}

  async logs(record: Intent) {
    return this.run([
      "journalctl",
      "--user",
      "-u",
      record.unit,
      "-n",
      "30",
      "--no-pager",
      "-o",
      "cat",
    ]);
  }
}

const plistString = (value: string) =>
  `<string>${value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</string>`;

/** macOS: a job of the user's launchd GUI domain. Its parent is launchd, not Piano, and it leads
 * its own process group, which `bootout` signals as a whole. Not loaded again at login. */
class Launchd implements Supervisor {
  private readonly run: Run;
  private readonly uid: number;
  /** Whether any process of the group remains; injectable because tests own no real job. */
  private readonly groupAlive: (group: number) => boolean;
  constructor(run: Run, uid: number, groupAlive: (group: number) => boolean) {
    this.run = run;
    this.uid = uid;
    this.groupAlive = groupAlive;
  }

  private get domain() {
    return `gui/${this.uid}`;
  }
  private files(record: Intent, root: string) {
    const directory = join(root, "launchd");
    return {
      directory,
      plist: join(directory, `${record.unit}.plist`),
      log: join(directory, `${record.unit}.log`),
    };
  }

  async check() {
    try {
      await this.run(["/bin/launchctl", "print", this.domain]);
    } catch (error) {
      throw new Error(`${unsupported} ${message(error).slice(-2000)}`);
    }
  }

  unit(serviceId: string, instanceId: string) {
    return `${serviceId}-${instanceId}`;
  }

  async submit(record: Intent, argv: string[], root: string) {
    const { directory, plist, log } = this.files(record, root);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(
      plist,
      `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key>${plistString(record.unit)}
<key>ProgramArguments</key><array>${argv.map(plistString).join("")}</array>
<key>WorkingDirectory</key>${plistString(record.workspace)}
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><false/>
<key>ExitTimeOut</key><integer>5</integer>
<key>StandardOutPath</key>${plistString(log)}
<key>StandardErrorPath</key>${plistString(log)}
</dict></plist>
`,
      { mode: 0o600 },
    );
    await this.run(["/bin/launchctl", "bootstrap", this.domain, plist]);
  }

  async state(record: Intent): Promise<UnitState> {
    let output: string;
    try {
      output = await this.run(["/bin/launchctl", "print", `${this.domain}/${record.unit}`]);
    } catch (error) {
      // 113: "Could not find service" in this domain.
      if (exitStatus(error) === 113) return { state: "not-loaded", raw: {} };
      throw error;
    }
    // Only the job's own top-level fields; nested sections are indented further.
    const raw: Record<string, string> = Object.fromEntries(
      [...output.matchAll(/^\t([a-z ]+) = (.*)$/gm)].map((match) => [match[1], match[2]]),
    );
    if (!raw.state)
      throw new Error("Supervisor state is incomplete; retain ownership and retry observation.");
    const runs = Number(raw.runs ?? 0);
    const exit = raw["last exit code"];
    const state: PreviewState =
      raw.state === "running"
        ? "running"
        : raw["last terminating signal"]
          ? "failed"
          : exit === "0"
            ? "exited"
            : runs === 0 || exit === undefined || exit.startsWith("(never")
              ? "starting"
              : "failed";
    return { state, invocation: runs > 0 ? `run-${runs}` : undefined, raw };
  }

  async ownsListener(record: Intent, state: UnitState) {
    const leader = Number(state.raw.pid);
    if (state.state !== "running" || !Number.isInteger(leader) || leader <= 1) return false;
    let output: string;
    try {
      // -b skips stat/readlink of every mount (a slow network mount stalls lsof past the run
      // timeout); -w drops the warnings that causes. Socket listings need neither.
      output = await this.run([
        "/usr/sbin/lsof",
        "-b",
        "-w",
        "-nP",
        `-iTCP:${record.port}`,
        "-sTCP:LISTEN",
        "-Fpn",
      ]);
    } catch (error) {
      if (exitStatus(error) === 1) return false; // No listener at all.
      throw error;
    }
    const pids = new Set<string>();
    let pid = "";
    for (const line of output.split("\n")) {
      if (line.startsWith("p")) pid = line.slice(1);
      if (!line.startsWith("n")) continue;
      if (![`127.0.0.1:${record.port}`, `[::1]:${record.port}`].includes(line.slice(1)))
        return false;
      pids.add(pid);
    }
    if (!pids.size) return false;
    // Every listening process must be in the job's process group, which launchd made it lead.
    let groups: string;
    try {
      groups = await this.run(["/bin/ps", "-o", "pid=,pgid=", "-p", [...pids].join(",")]);
    } catch {
      return false; // A listener exited while observed. Fail closed on ownership.
    }
    const rows = groups
      .trim()
      .split("\n")
      .map((row) => row.trim().split(/\s+/));
    return rows.length === pids.size && rows.every(([, group]) => Number(group) === leader);
  }

  async stop(record: Intent, state: UnitState, root: string) {
    try {
      await this.run(["/bin/launchctl", "bootout", `${this.domain}/${record.unit}`], 15000);
    } catch (error) {
      // 3: "No such process": the job left the domain on its own.
      if (exitStatus(error) !== 3) throw error;
    }
    // bootout returns at once; launchd sends TERM, then KILL after ExitTimeOut (5s).
    const leader = Number(state.raw.pid ?? record.processGroup);
    if (Number.isInteger(leader) && leader > 1) {
      const deadline = performance.now() + 10000;
      while (this.groupAlive(leader)) {
        if (performance.now() >= deadline)
          throw new Error(
            "Stop has not completed; retain identity and re-observe before another launch.",
          );
        await delay(100);
      }
    }
    if ((await this.state(record)).state !== "not-loaded")
      throw new Error(
        "Stop has not completed; retain identity and re-observe before another launch.",
      );
    await this.forget(record, root);
  }

  async forget(record: Intent, root: string) {
    const { plist, log } = this.files(record, root);
    await rm(plist, { force: true });
    await rm(log, { force: true });
  }

  async logs(record: Intent, root: string) {
    // The app's own log file is unbounded; read only its last 64 KiB, then the last 30 lines.
    let file: Awaited<ReturnType<typeof open>>;
    try {
      file = await open(this.files(record, root).log, "r");
    } catch (error) {
      if (code(error) === "ENOENT") return "";
      throw error;
    }
    try {
      const { size } = await file.stat();
      const length = Math.min(size, 65536);
      const buffer = Buffer.alloc(length);
      await file.read(buffer, 0, length, size - length);
      return buffer.toString("utf8").split("\n").slice(-31).join("\n");
    } finally {
      await file.close();
    }
  }
}

function processGroupAlive(group: number) {
  try {
    process.kill(-group, 0);
    return true;
  } catch (error) {
    return code(error) === "EPERM";
  }
}

/** The only substituted boundary is the host: supervisor commands and platform facts.
 * Filesystem, locking, allocation, reconciliation and Linux listener checks stay real in tests. */
export class PreviewAdapter {
  private readonly platform: string;
  private readonly uid: number;
  private readonly supervisor: Supervisor | undefined;
  private readonly lockWait: number;
  constructor(
    host: {
      run?: Run;
      platform?: string;
      uid?: number;
      callerGroup?: () => Promise<string>;
      groupAlive?: (group: number) => boolean;
      /** How long to wait for the account-wide lock; tests shorten it. */
      lockWait?: number;
    } = {},
  ) {
    this.platform = host.platform ?? process.platform;
    this.lockWait = host.lockWait ?? LOCK_WAIT_MS;
    this.uid = host.uid ?? process.getuid?.() ?? -1;
    const run = host.run ?? hostRun(this.platform);
    if (this.platform === "linux")
      this.supervisor = new Systemd(
        run,
        this.uid,
        host.callerGroup ??
          (async () => (await readFile("/proc/self/cgroup", "utf8")).trim().split("::").at(-1)!),
      );
    else if (this.platform === "darwin")
      this.supervisor = new Launchd(run, this.uid, host.groupAlive ?? processGroupAlive);
  }

  private redact(text: string, record: Intent) {
    for (const value of Object.values(record.spec.env).sort((a, b) => b.length - a.length))
      if (value) text = text.replaceAll(value, "[redacted]");
    return text.slice(-6000);
  }

  private async logs(supervisor: Supervisor, record: Intent, root: string) {
    try {
      return this.redact(await supervisor.logs(record, root), record);
    } catch (error) {
      return this.redact(message(error), record);
    }
  }

  /** The unit's state, refusing a supervisor invocation other than the one this intent adopted. */
  private async current(supervisor: Supervisor, record: Intent, path: string) {
    const state = await supervisor.state(record);
    const invocation = state.invocation;
    if (record.invocation && invocation && invocation !== record.invocation)
      throw new Error("Supervisor invocation changed unexpectedly; refusing to adopt or stop it.");
    const group = this.platform === "darwin" ? Number(state.raw.pid) : undefined;
    if ((invocation && !record.invocation) || (group && !record.processGroup)) {
      record.invocation ??= invocation;
      if (group && group > 1) record.processGroup ??= group;
      await save(path, record);
    }
    return state;
  }

  private async observe(
    supervisor: Supervisor,
    record: Intent,
    path: string,
    root: string,
    withLogs = true,
    /** Caps this observation's readiness request, e.g. at a start's remaining wait. */
    requestTimeout = READY_REQUEST_TIMEOUT_MS,
  ) {
    const state = await this.current(supervisor, record, path);
    // Only reconcile after native termination, never while the supervisor is still cleaning
    // descendants. In particular launchd's group SIGKILL is not the application's exit cause.
    const termination =
      record.owner && ["exited", "failed", "not-loaded"].includes(state.state)
        ? await readOutcome(
            outcomePath(path, record.instanceId),
            record.instanceId,
            record.owner.generation,
          )
        : undefined;
    const terminalState = termination
      ? outcomeFailed(termination)
        ? "failed"
        : this.platform === "linux" && state.state === "failed"
          ? "failed" // Do not hide native cleanup failures (e.g. a cgroup stop timeout).
          : "exited"
      : state.state;
    const loopback = loopbackOrigin.test(record.spec.origin);
    let ready = false;
    let detail =
      "No owned loopback listener at the selected port. Inspect logs; stop this instance before retrying.";
    const listening = await supervisor.ownsListener(record, state);
    if (listening) {
      try {
        const hostname = new URL(record.spec.origin).hostname;
        const host = `${hostname}:${record.port}`;
        const status = await httpStatus(record.port, record.spec.readyPath, host, requestTimeout);
        const after = await supervisor.state(record);
        ready =
          status >= 200 &&
          status < 400 &&
          after.invocation === state.invocation &&
          (await supervisor.ownsListener(record, after));
        detail = `Local GET ${record.spec.readyPath} with Host ${host}: HTTP ${status}`;
        if ((status === 403 || status === 421) && !loopback)
          detail += `. The app may reject the preview hostname; allow ${hostname} in its host check (Vite: env __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS).`;
      } catch (error) {
        detail = `Local GET ${record.spec.readyPath}: ${message(error)}`;
      }
    }
    if (ready && !record.readyAt) {
      record.readyAt = Date.now() / 1000;
      await save(path, record);
    }
    // Running, never answered yet, and young: a cold start, not a failure.
    const warming =
      !ready &&
      !record.readyAt &&
      ["starting", "running"].includes(terminalState) &&
      Date.now() / 1000 < record.createdAt + WARMUP_SECONDS;
    if (warming && !listening) detail = `Not listening on port ${record.port} yet.`;
    if (warming)
      detail = `Warming up; Piano keeps checking until ${new Date((record.createdAt + WARMUP_SECONDS) * 1000).toISOString()}. ${detail}`;
    return observation(record, {
      state: terminalState,
      termination,
      supervisor: state.raw,
      ready,
      warming,
      detail,
      binding: ready ? "127.0.0.1" : null,
      url: ready ? `${record.spec.origin}:${record.port}/` : null,
      logs: withLogs ? await this.logs(supervisor, record, root) : "",
    });
  }

  /** `progress` hears what a start has already changed before it returns: the replaced instance
   * once its stop is confirmed, then the new launch intent as starting, never yet ready. */
  async request(
    request: PreviewRequest,
    stateRoot: string,
    config: PreviewConfig,
    owner?: PreviewOwnerIdentity,
    progress?: (result: unknown) => void,
    /** False for a status read that only needs the app's state, not its recent output. */
    logs = true,
  ) {
    // Unsupported hosts fail before locking or any launch intent, without affecting Piano.
    const supervisor = this.supervisor;
    if (!supervisor || this.uid <= 0) throw new Error(unsupported);
    await supervisor.check();
    await mkdir(stateRoot, { recursive: true, mode: 0o700 });
    const root = await realpath(stateRoot);
    let mutex: DatabaseSync | undefined = await lock(root, this.lockWait);
    // A start releases the lock while it waits between readiness checks, so its wait never
    // holds up another workspace's operations, nor its lock wait depend on a start's budget.
    const pause = async (ms: number) => {
      if (mutex) unlock(mutex);
      mutex = undefined;
      await delay(ms);
      mutex = await lock(root, this.lockWait);
    };
    try {
      return await this.handle(supervisor, request, root, config, owner, progress, logs, pause);
    } finally {
      if (mutex) unlock(mutex);
    }
  }

  /** Serializes owner retirement with every launch/replace, using retained canonical identity.
   * On idle, errors mean active/unknown, never proof of absence. Explicit cleanup throws. */
  async retire(owner: PreviewOwnerIdentity, stateRoot: string, idle = false): Promise<boolean> {
    let mutex: DatabaseSync | undefined;
    try {
      await mkdir(stateRoot, { recursive: true, mode: 0o700 });
      const root = await realpath(stateRoot);
      // Idle asks while holding its session's ownership: a busy lock is not idle, and the next
      // sweep asks again. Explicit cleanup waits its turn.
      mutex = await lock(root, idle ? 0 : this.lockWait);
      const serviceId = `piano-preview-${hash(owner.workspace).slice(0, 24)}`;
      const path = join(root, `${serviceId}.json`);
      let record: Intent;
      try {
        record = JSON.parse(await readFile(path, "utf8"));
      } catch (error) {
        if (code(error) === "ENOENT") return true;
        throw error;
      }
      if (record.owner?.generation !== owner.generation) return true;
      const supervisor = this.supervisor;
      if (!supervisor) throw new Error(unsupported);
      await supervisor.check();
      if (idle) {
        const state = await this.current(supervisor, record, path);
        if (!["exited", "failed", "not-loaded"].includes(state.state)) return false;
      }
      await this.stop(supervisor, record, path, root, serviceId);
      return true;
    } catch (error) {
      if (idle) return false;
      throw error;
    } finally {
      if (mutex) unlock(mutex);
    }
  }

  /** Stops exactly this record's unit, or clears the record when the unit is gone. */
  private async stop(
    supervisor: Supervisor,
    record: Intent,
    path: string,
    root: string,
    serviceId: string,
  ) {
    const before = await this.current(supervisor, record, path);
    if (before.state === "not-loaded") {
      // Gone after reboot, logout or a failed submission: nothing to stop. An intent never seen
      // running may still have an orphaned submission in flight, so it waits out a grace period.
      const terminated = record.owner
        ? await readOutcome(
            outcomePath(path, record.instanceId),
            record.instanceId,
            record.owner.generation,
          )
        : undefined;
      if (
        !record.invocation &&
        !terminated &&
        Date.now() / 1000 - record.createdAt < SUBMISSION_GRACE_SECONDS
      )
        throw new Error(
          `Unit not loaded yet; its submission may still be in flight. Re-observe after ${SUBMISSION_GRACE_SECONDS} seconds.`,
        );
      if (record.processGroup) await supervisor.stop(record, before, root);
      else await supervisor.forget(record, root);
      await rm(outcomePath(path, record.instanceId), { force: true });
      await unlink(path);
      return {
        serviceId,
        instanceId: record.instanceId,
        status: "cleared",
        stopped: false,
        cleared: true,
        detail: "Unit no longer loaded; nothing was running. Saved launch cleared.",
      };
    }
    await supervisor.stop(record, before, root);
    await rm(outcomePath(path, record.instanceId), { force: true });
    await unlink(path);
    return { serviceId, instanceId: record.instanceId, status: "stopped", stopped: true };
  }

  private async handle(
    supervisor: Supervisor,
    request: PreviewRequest,
    root: string,
    config: PreviewConfig,
    owner?: PreviewOwnerIdentity,
    progress: (result: unknown) => void = () => {},
    logs = true,
    /** Waits between readiness checks without the account-wide lock, then holds it again. */
    pause: (ms: number) => Promise<void> = delay,
  ) {
    // Retained canonical identity also works after the checkout is removed.
    const workspace =
      owner?.workspace ??
      (await realpath(request.workspace).catch((error) => {
        // Recovery of a legacy intent may need its saved canonical path after checkout removal.
        if (code(error) === "ENOENT" && request.action !== "start" && isAbsolute(request.workspace))
          return request.workspace;
        throw error;
      }));
    const serviceId = `piano-preview-${hash(workspace).slice(0, 24)}`;
    const path = join(root, `${serviceId}.json`);
    let record: Intent | undefined;
    try {
      record = JSON.parse(await readFile(path, "utf8"));
    } catch (error) {
      if (code(error) !== "ENOENT") throw error;
    }
    if (request.action === "status")
      return record
        ? this.observe(supervisor, record, path, root, logs)
        : { serviceId, workspace, status: "absent" };
    if (record && record.owner?.generation !== owner?.generation) {
      // A restart may clear a *confirmed dead* generation, never adopt its app. Legacy records
      // have no owner and always require an explicit stop with the pre-upgrade helper.
      if (owner && request.action === "start" && record.owner) {
        const state = await this.current(supervisor, record, path);
        if (
          ["exited", "failed", "not-loaded"].includes(state.state) &&
          (await ownerGone(record.owner.endpoint))
        ) {
          await this.stop(supervisor, record, path, root, serviceId);
          record = undefined;
        }
      }
      if (record)
        throw new Error(
          record.owner
            ? `Preview ownership conflict: session ${record.owner.sessionId}, generation ${record.owner.generation} owns this workspace. Ownership cannot transfer. Stop through that owner if still live, or wait for owner-death cleanup and retry after confirmed exit.`
            : "Legacy independent preview: stop this exact instance with scripts/preview.ts before upgrading/retrying. It cannot be adopted or automatically terminated.",
        );
    }
    if (request.action === "stop") {
      if (!request.instanceId)
        throw new Error("stop requires the exact instanceId returned by start/status");
      if (!record || request.instanceId !== record.instanceId)
        return { serviceId, status: "not-current", stopped: false };
      return this.stop(supervisor, record, path, root, serviceId);
    }
    if (request.action !== "start") throw new Error("action must be start, status or stop");
    if (!owner)
      throw new Error(
        "Start requires a live Piano session owner. Use piano_preview in that session.",
      );
    if (!(await stat(workspace)).isDirectory()) throw new Error("workspace must be a directory");
    // Without a command, a start means "the launch this workspace already has".
    const requested =
      record && request.command === undefined
        ? {
            ...request,
            command: record.spec.command,
            env: request.env ?? record.spec.env,
            readyPath: request.readyPath ?? record.spec.readyPath,
          }
        : request;
    if (request.replace !== undefined) {
      if (!record || request.replace !== record.instanceId)
        return { serviceId, status: "not-current", replaced: false };
    } else if (record) {
      // Reuse never depends on the caller restating the launch exactly; a difference is reported.
      const result = await this.observe(supervisor, record, path, root);
      if (isDeepStrictEqual(record.spec, await launchSpec(requested, config, this.platform)))
        return { ...result, reused: true };
      return {
        ...result,
        reused: true,
        specChanged: true,
        detail: `${result.detail} Kept the running launch, which differs from this request. To switch, start again with replace: "${record.instanceId}".`,
      };
    }
    const spec = await launchSpec(requested, config, this.platform);
    await admitLaunch(spec.command, workspace);
    await checkRunnable(spec.command);
    const timeout = request.timeoutSeconds ?? START_TIMEOUT_SECONDS.default;
    if (
      typeof timeout !== "number" ||
      !Number.isFinite(timeout) ||
      timeout < START_TIMEOUT_SECONDS.min ||
      timeout > START_TIMEOUT_SECONDS.max
    )
      throw new Error(
        `timeoutSeconds must be between ${START_TIMEOUT_SECONDS.min} and ${START_TIMEOUT_SECONDS.max}`,
      );
    let replaced: string | undefined;
    if (record) {
      const stopped = await this.stop(supervisor, record, path, root, serviceId);
      replaced = stopped.instanceId;
      // The old app is gone now, not when the replacement's readiness wait ends: its URL may
      // soon reach the replacement on the same port.
      progress(stopped);
    }
    const port = await choosePort(config, root, spec.origin);
    const instanceId = randomUUID().replaceAll("-", "");
    record = {
      owner,
      serviceId,
      instanceId,
      unit: supervisor.unit(serviceId, instanceId),
      workspace,
      spec,
      port,
      createdAt: Date.now() / 1000,
    };
    await save(path, record); // Durable intent BEFORE submission; never blindly replay it.
    progress(
      observation(record, {
        state: "starting",
        ready: false,
        warming: true,
        url: null,
        detail: "Launching; waiting for its readiness check.",
      }),
    );
    try {
      try {
        await supervisor.submit(
          record,
          [
            process.execPath,
            fileURLToPath(new URL("./preview-runner.ts", import.meta.url)),
            owner.endpoint,
            owner.generation,
            record.instanceId,
            outcomePath(path, record.instanceId),
            ...appArgv(record),
          ],
          root,
        );
      } catch (error) {
        return {
          ...(await this.observe(supervisor, record, path, root)),
          launchError: this.redact(message(error), record),
          reused: false,
          ...(replaced && { replaced }),
        };
      }
      const deadline = performance.now() + timeout * 1000;
      for (;;) {
        const probed = performance.now();
        // Logs are read once, for the observation returned, not on every poll. One slow request
        // never stretches the start's own deadline.
        const remaining = Math.max(1000, deadline - probed);
        const result = await this.observe(
          supervisor,
          record,
          path,
          root,
          false,
          Math.min(READY_REQUEST_TIMEOUT_MS, remaining),
        );
        if (
          result.ready ||
          ["exited", "failed", "not-loaded"].includes(result.state) ||
          performance.now() >= deadline
        )
          return {
            ...result,
            ...(result.warming && {
              detail: `Running, not ready after ${timeout}s: still warming up, not a failed start. The app keeps running; do not replace or restart it. Read status for readiness; the preview link appears once it answers. ${result.detail}`,
            }),
            logs: await this.logs(supervisor, record, root),
            reused: false,
            ...(replaced && { replaced }),
          };
        await pause(Math.max(0, READY_INTERVAL_MS - (performance.now() - probed)));
        // Unlocked, the record may have changed: another observer saved what it saw, or a
        // reopened generation cleared this launch after its owner ended.
        const saved: Intent | undefined = await readFile(path, "utf8").then(
          (text) => JSON.parse(text),
          (error) => {
            if (code(error) === "ENOENT") return undefined;
            throw error;
          },
        );
        if (!saved || saved.instanceId !== record.instanceId)
          throw new Error(
            "This launch was stopped or replaced while it waited for readiness; read status.",
          );
        record = saved;
      }
    } catch (error) {
      throw new PreviewStartError(error, record);
    }
  }
}
