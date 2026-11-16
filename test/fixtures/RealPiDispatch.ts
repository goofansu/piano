import assert from "node:assert/strict";
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  type ClientMessage,
  decodeServerMessage,
  encodeClientMessage,
  type ServerMessage,
} from "../../shared/wire.ts";
import { freePort } from "./ports.ts";
import { seedRegistry } from "./registry.ts";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const installedCli = join(ROOT, "node_modules/@earendil-works/pi-coding-agent/dist/cli.js");

export interface ModelRequest {
  readonly role: "parent" | "child";
  readonly tools: ReadonlyArray<string>;
  readonly userText: string;
  readonly toolResults: ReadonlyArray<string>;
  readonly sawParentSecret: boolean;
  readonly answered: string;
}

export interface PiSpawn {
  readonly pid: number;
  readonly ppid: number;
  readonly cwd: string;
  readonly args: ReadonlyArray<string>;
  readonly sessionId: string | null;
  readonly extensions: ReadonlyArray<string>;
  readonly endpoint: { readonly wsUrl: string | null; readonly origin: string | null };
}

export interface WireClient {
  readonly send: (message: ClientMessage) => void;
  readonly next: (
    match: (message: ServerMessage) => boolean,
    label: string,
    timeoutMs?: number,
  ) => Promise<ServerMessage>;
  readonly received: () => ReadonlyArray<ServerMessage>;
  readonly close: () => void;
}

export interface RealPiDispatchFixture {
  readonly root: string;
  readonly parentRepo: string;
  readonly database: string;
  readonly agentDir: string;
  readonly sessionDir: string;
  readonly backend: {
    readonly pid: number;
    readonly port: number;
    readonly url: string;
    readonly origin: string;
  };
  readonly model: string;
  readonly parentSecret: string;
  readonly parentPrompt: string;
  readonly brief: string;
  readonly answer: string;
  readonly report: string;
  readonly connect: () => Promise<WireClient>;
  readonly requests: () => ReadonlyArray<ModelRequest>;
  readonly spawns: () => ReadonlyArray<PiSpawn>;
  readonly handle: () => Record<string, unknown> | null;
  readonly gate: {
    readonly releaseChild: () => void;
    readonly childRunning: Promise<void>;
  };
  readonly logs: () => string;
  readonly retain: (directory: string) => void;
  readonly close: () => Promise<void>;
}

export interface RealPiDispatchOptions {
  readonly prefix?: string;
  readonly holdChild?: boolean;
  readonly browserOrigin?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

type ToolSchema = {
  properties?: Record<string, { type?: string }>;
  required?: string[];
};
type DeclaredTool = { function?: { name?: string; parameters?: ToolSchema } };

const chunk = (model: string, delta: unknown, finish: string | null) =>
  `data: ${JSON.stringify({
    id: "dispatch",
    object: "chat.completion.chunk",
    created: 0,
    model,
    choices: [{ index: 0, delta, finish_reason: finish }],
  })}\n\n`;

const textOf = (content: unknown): string =>
  typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content
          .map((block) => (isRecord(block) && typeof block.text === "string" ? block.text : ""))
          .join("")
      : "";

export async function startRealPiDispatch(
  options: RealPiDispatchOptions = {},
): Promise<RealPiDispatchFixture> {
  const root = realpathSync(
    mkdtempSync(join(realpathSync(tmpdir()), options.prefix ?? "piano-dispatch-")),
  );
  const home = join(root, "home");
  const agentDir = join(root, "agent");
  const sessionDir = join(root, "sessions");
  const parentRepo = join(root, "parent");
  const database = join(root, "piano.db");
  const audit = join(root, "pi-spawns.jsonl");
  for (const directory of [home, agentDir, sessionDir, parentRepo]) mkdirSync(directory);
  writeFileSync(audit, "");

  const nonce = randomUUID().slice(0, 8);
  const parentSecret = `PARENT-SECRET-${nonce}`;
  const brief = `BRIEF-${nonce}: reply with exactly ECHO-${nonce} and nothing else. token: unshown`;
  const answer = `ECHO-${nonce}`;
  const report = `PARENT_REPORT: ${answer}`;
  const parentPrompt = `${parentSecret}. Dispatch this work in a new session and wait for its answer.`;
  const startTool = "piano_start_session";
  const waitTool = "piano_wait_sessions";
  const model = "piano-dispatch/override";

  const git = (...args: string[]) =>
    execFileSync(
      "git",
      ["-C", parentRepo, "-c", "user.name=t", "-c", "user.email=t@test.invalid", ...args],
      {
        stdio: "pipe",
        env: {
          PATH: process.env.PATH ?? "",
          GIT_CONFIG_GLOBAL: "/dev/null",
          GIT_CONFIG_NOSYSTEM: "1",
        },
      },
    );
  git("init", "-q", "-b", "main");
  writeFileSync(join(parentRepo, "README.md"), "dispatch fixture\n");
  git("add", ".");
  git("commit", "-qm", "initial");
  seedRegistry(database, { folders: [parentRepo] });

  const requests: ModelRequest[] = [];
  let handle: Record<string, unknown> | null = null;
  let releaseChild = () => {};
  const childHeld = new Promise<void>((resolve) => {
    releaseChild = resolve;
  });
  let observeChild = () => {};
  const childRunning = new Promise<void>((resolve) => {
    observeChild = resolve;
  });

  const respond = (response: ServerResponse, requested: string, delta: unknown, finish: string) => {
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.write(chunk(requested, delta, null));
    response.write(chunk(requested, {}, finish));
    response.write("data: [DONE]\n\n");
    response.end();
  };
  const refuse = (response: ServerResponse, why: string) => {
    response.writeHead(400, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: { message: `Dispatch fixture refused: ${why}` } }));
    return why;
  };

  const script = async (request: IncomingMessage, response: ServerResponse) => {
    let input = "";
    for await (const part of request) input += part;
    const body = JSON.parse(input) as {
      model: string;
      tools?: DeclaredTool[];
      messages: Array<{ role: string; content: unknown }>;
    };
    const declared = body.tools ?? [];
    const tools = declared.map((tool) => tool.function?.name ?? "").filter(Boolean);
    const userTexts = body.messages.filter((m) => m.role === "user").map((m) => textOf(m.content));
    const toolResults = body.messages
      .filter((m) => m.role === "tool")
      .map((m) => textOf(m.content));
    const role = userTexts.some((text) => text.includes(brief)) ? "child" : "parent";
    const sawParentSecret = input.includes(parentSecret);
    const record = (answered: string) =>
      requests.push({
        role,
        tools,
        userText: userTexts.at(-1) ?? "",
        toolResults,
        sawParentSecret,
        answered,
      });

    if (role === "child") {
      observeChild();
      if (options.holdChild) await childHeld;
      const continuing = userTexts.at(-1) === "CONTINUE_CHILD";
      respond(
        response,
        body.model,
        { role: "assistant", content: continuing ? "CHILD_CONTINUED" : answer },
        "stop",
      );
      return record(continuing ? "child-continued" : "child-answer");
    }
    if (!userTexts.some((text) => text.includes(parentSecret)))
      return record(refuse(response, "a request belonging to neither the parent nor the child"));

    const callStart = (args: Record<string, unknown>, id: string) =>
      respond(
        response,
        body.model,
        {
          role: "assistant",
          tool_calls: [
            {
              index: 0,
              id,
              type: "function",
              function: { name: startTool, arguments: JSON.stringify(args) },
            },
          ],
        },
        "tool_calls",
      );

    if (toolResults.length === 0) {
      const schema = declared.find((tool) => tool.function?.name === startTool)?.function
        ?.parameters;
      if (!schema) return record(refuse(response, `${startTool} was not declared to the model`));
      callStart(
        { prompt: brief, model: "missing/nonexistent", thinkingLevel: "high" },
        "call_start_stale",
      );
      return record(`${startTool} stale call`);
    }

    if (toolResults.length === 1) {
      if (
        !["- model: unknown field", "- thinkingLevel: unknown field"].every((line) =>
          toolResults[0].includes(line),
        )
      )
        return record(refuse(response, `${startTool} accepted or misreported removed options`));
      callStart({ prompt: brief }, "call_start");
      return record(`${startTool} call`);
    }

    if (toolResults.length === 2) {
      const started: unknown = JSON.parse(toolResults[1]);
      handle = isRecord(started) && isRecord(started.handle) ? started.handle : null;
      if (!handle)
        return record(refuse(response, `no session handle in the visible text of ${startTool}`));
      const schema = declared.find((tool) => tool.function?.name === waitTool)?.function
        ?.parameters;
      if (!schema) return record(refuse(response, `${waitTool} was not declared to the model`));
      respond(
        response,
        body.model,
        {
          role: "assistant",
          tool_calls: [
            {
              index: 0,
              id: "call_wait",
              type: "function",
              function: {
                name: waitTool,
                arguments: JSON.stringify({
                  sessions: [handle],
                }),
              },
            },
          ],
        },
        "tool_calls",
      );
      return record(`${waitTool} call`);
    }

    const seen = toolResults.at(-1)?.includes(answer) ?? false;
    respond(
      response,
      body.model,
      { role: "assistant", content: seen ? report : "PARENT_REPORT: ANSWER_MISSING" },
      "stop",
    );
    return record(seen ? "report" : "report-without-answer");
  };

  const modelServer: Server = createServer((request, response) => {
    script(request, response).catch((error) => {
      if (!response.headersSent) refuse(response, String(error));
      else response.end();
    });
  });
  await new Promise<void>((resolve) => modelServer.listen(0, "127.0.0.1", resolve));
  const modelPort = (modelServer.address() as { port: number }).port;

  const json = (path: string, data: unknown) =>
    writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
  json(join(agentDir, "models.json"), {
    providers: {
      "piano-dispatch": {
        baseUrl: `http://127.0.0.1:${modelPort}/v1`,
        api: "openai-completions",
        apiKey: "scratch-not-a-credential",
        models: ["local", "override"].map((id) => ({
          id,
          name: "Dispatch fixture",
          reasoning: true,
          input: ["text"],
          contextWindow: 200000,
          maxTokens: 256,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        })),
      },
    },
  });
  json(join(agentDir, "settings.json"), {
    defaultProvider: "piano-dispatch",
    defaultModel: "local",
    defaultThinkingLevel: "low",
    cacheWarming: "off",
    defaultProjectTrust: "ask",
  });

  const shim = join(root, "pi-cli.mjs");
  writeFileSync(
    shim,
    `import { appendFileSync } from 'node:fs';
import { sep } from 'node:path';
const root=${JSON.stringify(root)};
if(process.cwd()!==root&&!process.cwd().startsWith(root+sep))throw new Error('Refusing a non-fixture cwd');
appendFileSync(${JSON.stringify(audit)}, JSON.stringify({
  pid: process.pid,
  ppid: process.ppid,
  cwd: process.cwd(),
  args: process.argv.slice(2),
  wsUrl: process.env.PIANO_SESSION_WS_URL ?? null,
  origin: process.env.PIANO_SESSION_ORIGIN ?? null,
}) + '\\n');
// Keep only PATH and the launch endpoint: this Pi has no credentials and no other configuration.
const keep=new Set(['PATH','PIANO_SESSION_WS_URL','PIANO_SESSION_ORIGIN']);
for(const key of Object.keys(process.env))if(!keep.has(key))delete process.env[key];
process.env.HOME=${JSON.stringify(home)};
process.env.PI_CODING_AGENT_DIR=${JSON.stringify(agentDir)};
process.env.PI_CODING_AGENT_SESSION_DIR=${JSON.stringify(sessionDir)};
process.env.PI_OFFLINE="1";
process.env.PI_SKIP_VERSION_CHECK="1";
process.env.PI_TELEMETRY="0";
await import(${JSON.stringify(pathToFileURL(installedCli).href)});
`,
  );

  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const origin = options.browserOrigin ?? url;
  let log = "";
  const backend: ChildProcess = spawn(process.execPath, [join(ROOT, "server/main.ts")], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      PATH: process.env.PATH ?? "",
      TMPDIR: process.env.TMPDIR ?? "",
      HOME: home,
      HOST: "127.0.0.1",
      PORT: String(port),
      PIANO_ALLOWED_ORIGINS: origin,
      PIANO_DB_PATH: database,
      PIANO_PI_CLI: shim,
      PIANO_PI_ARGS:
        "--offline --no-builtin-tools --no-skills --no-prompt-templates --no-context-files",
      PI_CODING_AGENT_DIR: agentDir,
      PI_CODING_AGENT_SESSION_DIR: sessionDir,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
    },
  });
  backend.stdout?.on("data", (data) => (log += data));
  backend.stderr?.on("data", (data) => (log += data));

  const clients: WireClient[] = [];
  const records = (): PiSpawn[] =>
    readFileSync(audit, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { args: string[] } & Record<string, unknown>)
      .map((entry) => ({
        pid: entry.pid as number,
        ppid: entry.ppid as number,
        cwd: entry.cwd as string,
        args: entry.args,
        sessionId: entry.args[entry.args.indexOf("--session-id") + 1] ?? null,
        extensions: entry.args.flatMap((value, index) =>
          value === "--extension" ? [entry.args[index + 1]] : [],
        ),
        endpoint: {
          wsUrl: (entry.wsUrl as string) ?? null,
          origin: (entry.origin as string) ?? null,
        },
      }))
      .map((spawned) => ({
        ...spawned,
        sessionId: spawned.args.includes("--session-id") ? spawned.sessionId : null,
      }));

  const fail = async (detail: string): Promise<never> => {
    await close();
    throw new Error(detail);
  };

  const close = async () => {
    for (const client of clients) client.close();
    if (backend.exitCode === null) {
      const exited = new Promise<void>((resolve) => backend.once("exit", () => resolve()));
      const force = setTimeout(() => backend.kill("SIGKILL"), 10_000);
      backend.kill("SIGTERM");
      try {
        await exited;
      } finally {
        clearTimeout(force);
      }
    }
    releaseChild();
    modelServer.closeAllConnections();
    await new Promise<void>((resolve) => modelServer.close(() => resolve()));
    const alive = records()
      .map((spawned) => spawned.pid)
      .filter((pid) => {
        try {
          process.kill(pid, 0);
          return true;
        } catch {
          return false;
        }
      });
    const leaked = alive.length ? `fixture Pi children still running: ${alive.join(", ")}` : "";
    rmSync(root, { recursive: true, force: true });
    assert.equal(leaked, "", leaked);
  };

  for (let attempt = 0; ; attempt++) {
    if (backend.exitCode !== null) await fail(`scratch Piano exited:\n${log}`);
    try {
      if ((await fetch(`${url}/api/folders`)).ok) break;
    } catch {}
    if (attempt >= 300) await fail(`scratch Piano did not start:\n${log}`);
    await delay(100);
  }

  const connect = async (): Promise<WireClient> => {
    const socket = new (WebSocket as unknown as {
      new (url: string, options: { headers: Record<string, string> }): WebSocket;
    })(`ws://127.0.0.1:${port}/ws`, { headers: { Origin: origin } });
    const received: ServerMessage[] = [];
    const waiters = new Set<{
      match: (m: ServerMessage) => boolean;
      resolve: (m: ServerMessage) => void;
      reject: (error: Error) => void;
      label: string;
      timer: ReturnType<typeof setTimeout> | undefined;
    }>();
    socket.onmessage = (event) => {
      const message = decodeServerMessage(String(event.data));
      received.push(message);
      socket.send(encodeClientMessage({ _tag: "ack", deliveryId: message.deliveryId }));
      for (const waiter of [...waiters]) {
        if (waiter.match(message)) {
          waiters.delete(waiter);
          clearTimeout(waiter.timer);
          waiter.resolve(message);
          continue;
        }
        if (message._tag === "error" || message._tag === "selection_rejected") {
          waiters.delete(waiter);
          clearTimeout(waiter.timer);
          waiter.reject(
            new Error(`${waiter.label} failed: ${message.message}\nBackend log:\n${log}`),
          );
        }
      }
    };
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        socket.close();
        reject(new Error("scratch WebSocket did not open"));
      }, 10_000);
      socket.onopen = () => {
        clearTimeout(timeout);
        resolve();
      };
      socket.onerror = () => {
        clearTimeout(timeout);
        reject(new Error("scratch Piano refused the WebSocket"));
      };
    });
    const client: WireClient = {
      send: (message) => socket.send(encodeClientMessage(message)),
      received: () => received,
      next: (match, label, timeoutMs = 60_000) =>
        new Promise((resolve, reject) => {
          const found = received.find(match);
          if (found) return resolve(found);
          const waiter = {
            match,
            resolve,
            reject,
            label,
            timer: undefined as ReturnType<typeof setTimeout> | undefined,
          };
          waiters.add(waiter);
          waiter.timer = setTimeout(() => {
            if (!waiters.delete(waiter)) return;
            reject(
              new Error(
                `${label} did not arrive in ${timeoutMs}ms. Server messages: ${received
                  .map((message) => message._tag)
                  .join(", ")}\nBackend log:\n${log}`,
              ),
            );
          }, timeoutMs).unref();
        }),
      close: () => {
        for (const waiter of waiters) {
          clearTimeout(waiter.timer);
          waiter.reject(new Error("scratch observation closed"));
        }
        waiters.clear();
        socket.close();
      },
    };
    clients.push(client);
    return client;
  };

  const observations = () => ({
    requests,
    spawns: records(),
    handle,
    markers: { parentSecret, brief, answer, report },
  });

  return {
    root,
    parentRepo,
    database,
    agentDir,
    sessionDir,
    backend: { pid: backend.pid as number, port, url, origin },
    model,
    parentSecret,
    parentPrompt,
    brief,
    answer,
    report,
    connect,
    requests: () => requests,
    spawns: records,
    handle: () => handle,
    gate: { releaseChild: () => releaseChild(), childRunning },
    logs: () => log,
    retain: (directory) => {
      mkdirSync(directory, { recursive: true });
      json(join(directory, "dispatch-observations.json"), observations());
      json(join(directory, "dispatch-environment.json"), {
        root,
        parentRepo,
        agentDir,
        sessionDir,
        database,
        installedCli,
        backend: { pid: backend.pid, port, origin },
        modelEndpoint: `http://127.0.0.1:${modelPort}/v1`,
        credentials: "none; the loopback endpoint takes a dummy key",
      });
      writeFileSync(join(directory, "backend.log"), log);
      copyFileSync(shim, join(directory, "pi-cli.mjs.txt"));
    },
    close,
  };
}
