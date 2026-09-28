/**
 * Piano server: HTTP (serves the UI) + WebSocket (projects, threads, runners).
 *
 * A ThreadHost is a running `pi --mode rpc` child for one thread. Hosts
 * outlive browser clients, so a thread keeps working after the tab closes;
 * any client can re-attach and gets a full sync. Idle hosts with no clients
 * are released after PIANO_IDLE_MINUTES (state lives in the session file).
 */
import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket, WebSocketServer } from "ws";
import { CONFIG_PATH, readConfig, writeConfig } from "./config.ts";
import { loadModelCatalog, type ModelCatalog } from "./models.ts";
import { agentDir, expandHome } from "./pi-env.ts";
import { RpcRunner, type RunnerEvent, type ThreadSpec, type UiRequest, type UiResponse } from "./runner.ts";
import { listThreads, peekSession, type ThreadInfo } from "./threads.ts";
import type { RenderMsg } from "./wire.ts";
import { createWorktree, listWorktrees } from "./worktrees.ts";

const PORT = Number(process.env.PORT ?? 7070);
const HOST = process.env.HOST ?? "127.0.0.1";
const IDLE_MS = Number(process.env.PIANO_IDLE_MINUTES ?? 30) * 60_000;
const INDEX_HTML = fileURLToPath(new URL("../public/index.html", import.meta.url));

// ── Thread hosts ─────────────────────────────────────────────────────────────

interface Client {
  ws: WebSocket;
  host: ThreadHost | null;
  selected: { cwd: string; sessionId: string | null } | null;
}

class ThreadHost {
  readonly key: string;
  readonly spec: ThreadSpec;
  readonly runner: RpcRunner;
  readonly clients = new Set<Client>();
  readonly pendingUi = new Map<string, UiRequest>();
  streaming = false;
  idleSince = Date.now();
  private unsubscribe: (() => void) | undefined;

  constructor(spec: ThreadSpec, runner: RpcRunner) {
    this.key = hostKey(spec.cwd, spec.sessionId);
    this.spec = spec;
    this.runner = runner;
  }

  static async create(spec: ThreadSpec): Promise<ThreadHost> {
    const runner = new RpcRunner(spec);
    await runner.start();
    const host = new ThreadHost(spec, runner);
    host.unsubscribe = runner.onEvent((event) => host.onEvent(event));
    return host;
  }

  private onEvent(event: RunnerEvent): void {
    if (event.type === "agent_start" && !this.streaming) {
      this.streaming = true;
      broadcastHosts();
    } else if (event.type === "agent_end" && this.streaming) {
      this.streaming = false;
      this.idleSince = Date.now();
      broadcastHosts();
    } else if (event.type === "ui_request" && event.request.method !== "notify") {
      this.pendingUi.set(event.request.id, event.request);
    }
    for (const c of this.clients) send(c.ws, event);
  }

  respondUi(response: UiResponse): void {
    this.pendingUi.delete(response.id);
    this.runner.respondUi(response);
  }

  async dispose(): Promise<void> {
    this.unsubscribe?.();
    await this.runner.stop().catch(() => undefined);
  }
}

const hosts = new Map<string, ThreadHost>();
const clients = new Set<Client>();
let catalog: ModelCatalog | undefined;
let catalogLoading: Promise<ModelCatalog> | undefined;

function hostKey(cwd: string, sessionId: string): string {
  return `${cwd}::${sessionId}`;
}

async function refreshCatalog(): Promise<ModelCatalog> {
  if (!catalogLoading) {
    catalogLoading = loadModelCatalog()
      .then((c) => {
        catalog = c;
        if (c.error) console.error("[piano] model catalog:", c.error);
        else console.log(`[piano] ${c.models.length} models available, default ${c.defaultModel ?? "(none)"}`);
        for (const client of clients) send(client.ws, { type: "models", catalog: c });
        return c;
      })
      .finally(() => {
        catalogLoading = undefined;
      });
  }
  return catalogLoading;
}

// ── Views ────────────────────────────────────────────────────────────────────

interface ThreadView extends ThreadInfo {
  hosted?: boolean;
  streaming?: boolean;
}

interface WorktreeView {
  branch: string;
  path: string;
  main: boolean;
  threads: ThreadView[];
}

interface ProjectView {
  path: string;
  name: string;
  worktrees: WorktreeView[];
}

function hostInfo(cwd: string, sessionId: string): Pick<ThreadView, "hosted" | "streaming"> {
  const host = hosts.get(hostKey(cwd, sessionId));
  return host ? { hosted: true, streaming: host.streaming } : {};
}

async function buildProjects(): Promise<ProjectView[]> {
  const { projects } = readConfig();
  return Promise.all(
    projects.map(async (path) => {
      const worktrees = await listWorktrees(path);
      const views = await Promise.all(
        worktrees.map(async (wt) => {
          const threads: ThreadView[] = (await listThreads(wt.path).catch(() => [])).map((t) => ({
            ...t,
            ...hostInfo(wt.path, t.sessionId),
          }));
          // Hosted threads that have not written a session file yet.
          for (const host of hosts.values()) {
            if (host.spec.cwd !== wt.path) continue;
            if (threads.some((t) => t.sessionId === host.spec.sessionId)) continue;
            threads.unshift({
              sessionId: host.spec.sessionId,
              path: "",
              name: host.spec.name,
              firstMessage: "",
              created: new Date().toISOString(),
              modified: new Date().toISOString(),
              messageCount: 0,
              hosted: true,
              streaming: host.streaming,
            });
          }
          return { ...wt, threads };
        }),
      );
      return { path, name: path.split("/").filter(Boolean).pop() ?? path, worktrees: views };
    }),
  );
}

// ── Messaging helpers ────────────────────────────────────────────────────────

function send(ws: WebSocket, msg: object): void {
  if (ws.readyState !== WebSocket.OPEN) return;
  try {
    ws.send(JSON.stringify(msg));
  } catch {
    /* ignore */
  }
}

function sendError(client: Client, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  console.error("[piano]", message);
  send(client.ws, { type: "error", message });
}

async function broadcastProjects(): Promise<void> {
  const projects = await buildProjects();
  for (const c of clients) send(c.ws, { type: "projects", projects });
}

function broadcastHosts(): void {
  const list = [...hosts.values()].map((h) => ({
    cwd: h.spec.cwd,
    sessionId: h.spec.sessionId,
    streaming: h.streaming,
  }));
  for (const c of clients) send(c.ws, { type: "hosts", hosts: list });
}

async function sendSync(client: Client): Promise<void> {
  const sel = client.selected;
  if (!sel) return;
  const host = client.host;
  if (host) {
    const [messages, state] = await Promise.all([host.runner.getMessages(), host.runner.getState()]);
    send(client.ws, {
      type: "sync",
      thread: { cwd: sel.cwd, sessionId: sel.sessionId },
      hosted: true,
      messages,
      pendingUi: [...host.pendingUi.values()],
      state: { ...state, isStreaming: state.isStreaming || host.streaming, cwd: sel.cwd },
    });
    return;
  }
  let messages: RenderMsg[] = [];
  let sessionName: string | undefined;
  let model: string | undefined;
  let sessionFile: string | undefined;
  if (sel.sessionId) {
    const threads = await listThreads(sel.cwd).catch(() => []);
    sessionFile = threads.find((t) => t.sessionId === sel.sessionId)?.path;
    if (sessionFile) {
      const peek = peekSession(sessionFile);
      messages = peek.messages;
      sessionName = peek.sessionName;
      model = peek.model;
    }
  }
  send(client.ws, {
    type: "sync",
    thread: { cwd: sel.cwd, sessionId: sel.sessionId },
    hosted: false,
    messages,
    pendingUi: [],
    state: { isStreaming: false, model, sessionName, sessionFile, cwd: sel.cwd },
  });
}

function detach(client: Client): void {
  const host = client.host;
  if (host) {
    host.clients.delete(client);
    if (host.clients.size === 0) host.idleSince = Date.now();
  }
  client.host = null;
}

function attach(client: Client, host: ThreadHost): void {
  detach(client);
  client.host = host;
  host.clients.add(client);
}

// ── Folder picker ────────────────────────────────────────────────────────────

interface DirEntry {
  name: string;
  path: string;
  git: boolean;
}

/** List subdirectories for the folder picker. Hidden folders are skipped. */
function listDirectory(raw: string): { path: string; parent: string | null; entries: DirEntry[] } {
  const path = resolve(expandHome(raw || "~"));
  if (!existsSync(path) || !statSync(path).isDirectory()) throw new Error(`Not a directory: ${path}`);
  const entries: DirEntry[] = [];
  for (const name of readdirSync(path)) {
    if (name.startsWith(".")) continue;
    const full = join(path, name);
    try {
      if (!statSync(full).isDirectory()) continue;
    } catch {
      continue;
    }
    entries.push({ name, path: full, git: existsSync(join(full, ".git")) });
  }
  entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  const parent = dirname(path);
  return { path, parent: parent === path ? null : parent, entries };
}

// ── Client commands ──────────────────────────────────────────────────────────

interface StartOpts {
  model?: string;
  name?: string;
}

type Cmd =
  | { type: "projects" }
  | { type: "models" }
  | { type: "add_project"; path: string }
  | { type: "remove_project"; path: string }
  | { type: "create_worktree"; project: string; branch: string; hooks?: boolean }
  | { type: "select"; cwd: string; sessionId: string | null }
  | ({ type: "start" } & StartOpts)
  | { type: "prompt"; text: string; start?: StartOpts }
  | { type: "set_model"; model: string }
  | { type: "ui_response"; id: string; value?: string; confirmed?: boolean; cancelled?: boolean }
  | { type: "stop" }
  | { type: "release" };

async function startHost(client: Client, opts: StartOpts): Promise<ThreadHost> {
  const sel = client.selected;
  if (!sel) throw new Error("Select a thread first");
  if (!sel.sessionId) sel.sessionId = randomUUID();

  const key = hostKey(sel.cwd, sel.sessionId);
  let host = hosts.get(key);
  if (!host) {
    const spec: ThreadSpec = {
      cwd: sel.cwd,
      sessionId: sel.sessionId,
      model: opts.model?.trim() || undefined,
      name: opts.name?.trim() || undefined,
    };
    host = await ThreadHost.create(spec);
    hosts.set(key, host);
    console.log(`[piano] started ${spec.sessionId.slice(0, 8)} in ${spec.cwd}${spec.model ? ` (${spec.model})` : ""}`);
  }
  attach(client, host);
  broadcastHosts();
  void broadcastProjects();
  return host;
}

async function releaseHost(host: ThreadHost): Promise<void> {
  hosts.delete(host.key);
  await host.dispose();
  const affected = [...host.clients];
  for (const c of affected) c.host = null;
  host.clients.clear();
  console.log(`[piano] released ${host.spec.sessionId.slice(0, 8)}`);
  broadcastHosts();
  void broadcastProjects();
  for (const c of affected) await sendSync(c);
}

async function handle(client: Client, cmd: Cmd): Promise<void> {
  switch (cmd.type) {
    case "projects":
      send(client.ws, { type: "projects", projects: await buildProjects() });
      return;

    case "models":
      send(client.ws, { type: "models", catalog: await refreshCatalog() });
      return;

    case "add_project": {
      const path = resolve(expandHome(String(cmd.path ?? "")));
      if (!existsSync(path) || !statSync(path).isDirectory()) throw new Error(`Not a directory: ${path}`);
      const config = readConfig();
      if (!config.projects.includes(path)) {
        config.projects.push(path);
        writeConfig(config);
      }
      await broadcastProjects();
      return;
    }

    case "remove_project": {
      const config = readConfig();
      config.projects = config.projects.filter((p) => p !== cmd.path);
      writeConfig(config);
      await broadcastProjects();
      return;
    }

    case "create_worktree": {
      const branch = String(cmd.branch ?? "").trim();
      if (!branch) throw new Error("Branch name is required");
      const wt = await createWorktree(cmd.project, branch, { hooks: !!cmd.hooks });
      send(client.ws, { type: "toast", message: `Worktree ${wt.branch} at ${wt.path}` });
      await broadcastProjects();
      return;
    }

    case "select": {
      detach(client);
      client.selected = { cwd: String(cmd.cwd), sessionId: cmd.sessionId ? String(cmd.sessionId) : null };
      const host = client.selected.sessionId
        ? hosts.get(hostKey(client.selected.cwd, client.selected.sessionId))
        : undefined;
      if (host) attach(client, host);
      await sendSync(client);
      return;
    }

    case "start":
      await startHost(client, cmd);
      await sendSync(client);
      return;

    case "prompt": {
      const text = String(cmd.text ?? "").trim();
      if (!text) return;
      let host = client.host;
      if (!host) {
        host = await startHost(client, cmd.start ?? {});
        await sendSync(client);
      }
      await host.runner.prompt(text);
      return;
    }

    case "set_model": {
      const host = client.host;
      if (!host) throw new Error("Start the thread before changing its model");
      await host.runner.setModel(String(cmd.model));
      for (const c of host.clients) await sendSync(c);
      return;
    }

    case "ui_response": {
      const host = client.host;
      if (!host) throw new Error("No running thread for this dialog");
      host.respondUi({ id: String(cmd.id), value: cmd.value, confirmed: cmd.confirmed, cancelled: cmd.cancelled });
      for (const c of host.clients) send(c.ws, { type: "ui_resolved", id: cmd.id });
      return;
    }

    case "stop":
      if (!client.host) return;
      await client.host.runner.abort();
      return;

    case "release":
      if (client.host) await releaseHost(client.host);
      return;

    default:
      throw new Error(`Unknown command: ${(cmd as { type?: string }).type}`);
  }
}

// ── HTTP + WS ────────────────────────────────────────────────────────────────

const httpServer = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname === "/" || url.pathname === "/index.html") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    res.end(readFileSync(INDEX_HTML));
    return;
  }
  if (url.pathname === "/api/ls") {
    try {
      const listing = listDirectory(url.searchParams.get("path") ?? "~");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ...listing, home: homedir() }));
    } catch (err) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
    }
    return;
  }
  if (url.pathname === "/api/projects") {
    void buildProjects().then((projects) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ projects }, null, 2));
    });
    return;
  }
  if (url.pathname === "/api/models") {
    void (catalog ? Promise.resolve(catalog) : refreshCatalog()).then((c) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(c, null, 2));
    });
    return;
  }
  res.writeHead(404);
  res.end("not found");
});

const wss = new WebSocketServer({ server: httpServer, path: "/ws" });
wss.on("connection", (ws) => {
  const client: Client = { ws, host: null, selected: null };
  clients.add(client);
  void handle(client, { type: "projects" }).catch((err) => sendError(client, err));
  if (catalog) send(ws, { type: "models", catalog });
  else void refreshCatalog();
  broadcastHosts();

  ws.on("message", (data) => {
    let cmd: Cmd;
    try {
      cmd = JSON.parse(data.toString()) as Cmd;
    } catch {
      return;
    }
    handle(client, cmd).catch((err) => sendError(client, err));
  });
  ws.on("close", () => {
    detach(client);
    clients.delete(client);
  });
});

setInterval(() => {
  if (!(IDLE_MS > 0)) return;
  const now = Date.now();
  for (const host of hosts.values()) {
    if (host.clients.size > 0 || host.streaming || host.pendingUi.size > 0) continue;
    if (now - host.idleSince < IDLE_MS) continue;
    console.log(`[piano] idle for ${Math.round((now - host.idleSince) / 60_000)} min, releasing ${host.spec.sessionId.slice(0, 8)}`);
    void releaseHost(host);
  }
}, 60_000).unref();

httpServer.listen(PORT, HOST, () => {
  console.log(`[piano] http://${HOST}:${PORT}`);
  console.log(`[piano] config ${CONFIG_PATH}; pi agent dir ${agentDir()}`);
  void refreshCatalog();
});

async function shutdown(): Promise<void> {
  console.log("[piano] shutting down runners…");
  await Promise.all([...hosts.values()].map((h) => h.dispose()));
  process.exit(0);
}
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
