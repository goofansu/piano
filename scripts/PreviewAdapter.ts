import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  readdir,
  readFile,
  readlink,
  realpath,
  rename,
  stat,
  unlink,
} from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { createServer, type Server } from "node:net";
import { isAbsolute, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { isDeepStrictEqual } from "node:util";

export interface PreviewRequest {
  action: "start" | "status" | "stop";
  workspace: string;
  command?: string[];
  env?: Record<string, string>;
  readyPath?: string;
  timeoutSeconds?: number;
  instanceId?: string;
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
interface Intent {
  serviceId: string;
  instanceId: string;
  unit: string;
  workspace: string;
  spec: LaunchSpec;
  port: number;
  createdAt: number;
  invocation?: string;
}
type UnitState = Record<string, string>;
type Run = (args: string[], timeout?: number) => Promise<string>;

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
const code = (error: unknown) => (error as NodeJS.ErrnoException).code;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const unsupported =
  "Managed previews unsupported: require Linux and an unprivileged account with a lingering systemd user manager. No detached fallback.";

/** Bounded tails, bounded execution, and no caller credentials, even for supervisor clients. */
const run: Run = (args, timeout = 5000) =>
  new Promise((resolve, reject) => {
    const child = spawn(args[0], args.slice(1), {
      env: {
        PATH: "/usr/bin:/bin",
        XDG_RUNTIME_DIR: `/run/user/${process.getuid?.()}`,
        DBUS_SESSION_BUS_ADDRESS: `unix:path=/run/user/${process.getuid?.()}/bus`,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
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
      else if (status !== 0) reject(new Error(`${args[0]} failed: ${stderr.toString()}`));
      else resolve(stdout.toString());
    });
  });

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

/** Linux abstract sockets are atomic kernel locks, released on exit/SIGKILL, with no stale file
 * or PID-reuse/reaper race. Nothing connects to this socket. All helpers share one state root. */
async function lock(root: string) {
  const address = `\0piano-preview-${process.getuid?.()}-${hash(root)}`;
  const deadline = performance.now() + 65000;
  for (;;) {
    const server = createServer((socket) => socket.destroy());
    try {
      await listen(server, { path: address });
      return server;
    } catch (error) {
      if (code(error) !== "EADDRINUSE") throw error;
      if (performance.now() >= deadline)
        throw new Error(
          "Preview operation busy. Re-observe status before retrying; no launch attempted.",
        );
      await delay(100);
    }
  }
}

async function ownedBinding(record: Intent, state: UnitState) {
  const group = state.ControlGroup;
  if (!group || state.ActiveState !== "active") return false;
  const inodes = new Set<string>();
  for (const table of ["tcp", "tcp6"]) {
    for (const row of (await readFile(`/proc/net/${table}`, "utf8")).trim().split("\n").slice(1)) {
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

function httpStatus(port: number, path: string): Promise<number> {
  return new Promise((resolve, reject) => {
    // Absolute wall deadline, not a socket inactivity timeout (a slow responder must not extend it).
    const request = httpRequest(
      { hostname: "127.0.0.1", port, path, method: "GET", agent: false },
      (response) => {
        resolve(response.statusCode ?? 0);
        response.destroy();
      },
    );
    const timer = setTimeout(() => request.destroy(new Error("readiness timed out")), 1000);
    request.on("error", reject);
    request.on("close", () => clearTimeout(timer));
    request.end();
  });
}

async function choosePort(config: PreviewConfig, root: string) {
  const reserved = new Set([7070, 8000, 8001, ...(config.reservedPorts ?? [])]);
  for (const file of (await readdir(root)).filter((name) => name.endsWith(".json"))) {
    reserved.add((JSON.parse(await readFile(join(root, file), "utf8")) as Intent).port);
  }
  const ports = config.ports ?? Array.from({ length: 7000 }, (_, i) => 3000 + i);
  if (!ports.length || ports.some((p) => !Number.isInteger(p) || p < 3000 || p > 9999)) {
    throw new Error("ports must be integers in exe.dev's supported range 3000–9999");
  }
  for (const port of ports) {
    if (reserved.has(port)) continue;
    const ipv4 = createServer();
    const ipv6 = createServer();
    try {
      await listen(ipv4, { host: "0.0.0.0", port });
      await listen(ipv6, { host: "::", port, ipv6Only: true });
      return port;
    } catch {
      /* A busy or unavailable address is not a candidate. */
    } finally {
      await close(ipv4);
      await close(ipv6);
    }
  }
  throw new Error(
    "No free supported preview port; check configured ports/reservations. No listener was stopped.",
  );
}

function launchSpec(request: PreviewRequest, config: PreviewConfig): LaunchSpec {
  const origin = config.origin ?? "";
  if (!/^https:\/\/[a-zA-Z0-9-]+\.exe\.xyz$/.test(origin))
    throw new Error(
      "Configure origin as https://<private-vm>.exe.xyz (no port/path). Never infer it from headers.",
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
  if (!isAbsolute(command[0])) throw new Error("command[0] must be an absolute executable path");
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
  if (typeof readyPath !== "string" || !readyPath.startsWith("/") || /[\r\n]/.test(readyPath))
    throw new Error("readyPath must be an HTTP path");
  return { command, env, readyPath, origin, path: config.path ?? "/usr/local/bin:/usr/bin:/bin" };
}

/** The only substituted boundary is the host: supervisor commands and platform facts.
 * Filesystem, locking, allocation, reconciliation and listener checks remain real in contract tests. */
export class PreviewAdapter {
  private readonly run: Run;
  private readonly platform: string;
  private readonly uid: number;
  private readonly callerGroup: () => Promise<string>;
  constructor(
    host: { run?: Run; platform?: string; uid?: number; callerGroup?: () => Promise<string> } = {},
  ) {
    this.run = host.run ?? run;
    this.platform = host.platform ?? process.platform;
    this.uid = host.uid ?? process.getuid?.() ?? -1;
    this.callerGroup =
      host.callerGroup ??
      (async () => (await readFile("/proc/self/cgroup", "utf8")).trim().split("::").at(-1)!);
  }

  private async supervisor() {
    if (this.platform !== "linux" || this.uid <= 0) throw new Error(unsupported);
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

  private async unitState(record: Intent): Promise<UnitState> {
    const output = await this.run([
      "systemctl",
      "--user",
      "show",
      record.unit,
      "-p",
      "LoadState,ActiveState,SubState,InvocationID,ControlGroup,Result,MainPID",
    ]);
    return Object.fromEntries(
      output
        .split("\n")
        .filter((line) => line.includes("="))
        .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
    );
  }

  private redact(text: string, record: Intent) {
    for (const value of Object.values(record.spec.env).sort((a, b) => b.length - a.length))
      if (value) text = text.replaceAll(value, "[redacted]");
    return text.slice(-6000);
  }

  private async logs(record: Intent) {
    try {
      return this.redact(
        await this.run([
          "journalctl",
          "--user",
          "-u",
          record.unit,
          "-n",
          "30",
          "--no-pager",
          "-o",
          "cat",
        ]),
        record,
      );
    } catch (error) {
      return this.redact(message(error), record);
    }
  }

  private async observe(record: Intent, path: string) {
    const state = await this.unitState(record);
    const invocation = state.InvocationID;
    if (record.invocation && invocation && invocation !== record.invocation)
      throw new Error("Supervisor invocation changed unexpectedly; refusing to adopt or stop it.");
    if (invocation && !record.invocation) {
      record.invocation = invocation;
      await save(path, record);
    }
    let ready = false;
    let detail =
      "No owned loopback listener at the selected port. Inspect logs; stop this instance before retrying.";
    if (await ownedBinding(record, state)) {
      try {
        const status = await httpStatus(record.port, record.spec.readyPath);
        const after = await this.unitState(record);
        ready =
          status >= 200 &&
          status < 400 &&
          after.InvocationID === state.InvocationID &&
          (await ownedBinding(record, after));
        detail = `Local GET ${record.spec.readyPath}: HTTP ${status}`;
      } catch (error) {
        detail = `Local readiness: ${message(error)}`;
      }
    }
    return {
      ...record,
      spec: { ...record.spec, env: Object.keys(record.spec.env) },
      state,
      ready,
      detail,
      binding: ready ? "127.0.0.1" : null,
      url: ready ? `${record.spec.origin}:${record.port}/` : null,
      externalAccess: "unverified",
      observedAt: Date.now() / 1000,
      logs: await this.logs(record),
    };
  }

  async request(request: PreviewRequest, stateRoot: string, config: PreviewConfig) {
    // Unsupported hosts fail before Linux locking or any launch intent, without affecting Piano.
    await this.supervisor();
    await mkdir(stateRoot, { recursive: true, mode: 0o700 });
    const root = await realpath(stateRoot);
    const mutex = await lock(root);
    try {
      return await this.handle(request, root, config);
    } finally {
      await close(mutex);
    }
  }

  private async handle(request: PreviewRequest, root: string, config: PreviewConfig) {
    const workspace = await realpath(request.workspace);
    if (!(await stat(workspace)).isDirectory()) throw new Error("workspace must be a directory");
    const serviceId = `piano-preview-${hash(workspace).slice(0, 24)}`;
    const path = join(root, `${serviceId}.json`);
    let record: Intent | undefined;
    try {
      record = JSON.parse(await readFile(path, "utf8"));
    } catch (error) {
      if (code(error) !== "ENOENT") throw error;
    }
    if (request.action === "status")
      return record ? this.observe(record, path) : { serviceId, workspace, status: "absent" };
    if (request.action === "stop") {
      if (!request.instanceId)
        throw new Error("stop requires the exact instanceId returned by start/status");
      if (!record || request.instanceId !== record.instanceId)
        return { serviceId, status: "not-current", stopped: false };
      await this.observe(record, path);
      await this.run(["systemctl", "--user", "stop", record.unit], 15000);
      const state = await this.unitState(record);
      if (!["inactive", "failed"].includes(state.ActiveState))
        throw new Error(
          "Stop has not completed; retain identity and re-observe before another launch.",
        );
      if (state.ActiveState === "failed")
        await this.run(["systemctl", "--user", "reset-failed", record.unit]);
      await unlink(path);
      return { serviceId, instanceId: record.instanceId, status: "stopped", stopped: true };
    }
    if (request.action !== "start") throw new Error("action must be start, status or stop");
    const spec = launchSpec(request, config);
    if (record) {
      if (!isDeepStrictEqual(record.spec, spec))
        throw new Error(
          `Launch spec changed. Explicitly stop instance ${record.instanceId} before replacement.`,
        );
      return { ...(await this.observe(record, path)), reused: true };
    }
    const timeout = request.timeoutSeconds ?? 15;
    if (typeof timeout !== "number" || !Number.isFinite(timeout) || timeout < 1 || timeout > 30)
      throw new Error("timeoutSeconds must be between 1 and 30");
    const port = await choosePort(config, root);
    const instanceId = randomUUID().replaceAll("-", "");
    record = {
      serviceId,
      instanceId,
      unit: `${serviceId}-${instanceId}.service`,
      workspace,
      spec,
      port,
      createdAt: Date.now() / 1000,
    };
    await save(path, record); // Durable intent BEFORE submission; never blindly replay it.
    const command = spec.command.map((arg) => arg.replaceAll("{port}", String(port)));
    try {
      await this.run([
        "systemd-run",
        "--user",
        `--unit=${record.unit}`,
        "--service-type=exec",
        "--remain-after-exit",
        "--expand-environment=no",
        `--working-directory=${workspace}`,
        "--property=Restart=no",
        "--property=KillMode=control-group",
        "--property=TimeoutStopSec=5s",
        "--property=NoNewPrivileges=yes",
        "--property=StandardOutput=journal",
        "--property=StandardError=journal",
        "--property=LogRateLimitIntervalSec=10s",
        "--property=LogRateLimitBurst=100",
        "--",
        "/usr/bin/env",
        "-i",
        `PATH=${spec.path}`,
        `PORT=${port}`,
        ...Object.entries(spec.env)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, value]) => `${key}=${value}`),
        ...command,
      ]);
    } catch (error) {
      return {
        ...(await this.observe(record, path)),
        launchError: this.redact(message(error), record),
        reused: false,
      };
    }
    const deadline = performance.now() + timeout * 1000;
    for (;;) {
      const result = await this.observe(record, path);
      if (
        result.ready ||
        ["failed", "inactive"].includes(result.state.ActiveState) ||
        performance.now() >= deadline
      )
        return { ...result, reused: false };
      await delay(100);
    }
  }
}
