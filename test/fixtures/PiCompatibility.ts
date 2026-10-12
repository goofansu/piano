/** Isolated real-Pi resources shared by the Phase 0 checkpoint and browser journey.
 * No production config loader: these are fixture inputs that the normal CLI loads itself.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { PiCliConfig } from "../../server/PiCli.ts";

const installedCli = fileURLToPath(
  new URL("../../node_modules/@earendil-works/pi-coding-agent/dist/cli.js", import.meta.url),
);
const fixturePath = (name: string) => fileURLToPath(new URL(name, import.meta.url));
export const sentinelTool = "mcp__piano_sentinel__identity";

export async function createPiCompatibilityFixture() {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "piano-phase0-"));
  const agentDir = join(root, "agent");
  const sessionDir = join(root, "sessions");
  const eventsFile = join(root, "pi-events.jsonl");
  const mcpFile = join(root, "mcp-events.jsonl");
  const requests: Array<{ model: string; input: string; aborted: boolean }> = [];
  let signalAbort: () => void = () => {};
  const aborted = new Promise<void>((resolve) => {
    signalAbort = resolve;
  });
  mkdirSync(join(agentDir, "extensions"), { recursive: true });
  mkdirSync(sessionDir);
  writeFileSync(eventsFile, "");
  writeFileSync(mcpFile, "");
  copyFileSync(fixturePath("Phase0Extension.ts"), join(agentDir, "extensions", "checkpoint.ts"));
  const json = (path: string, data: unknown) =>
    writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
  // This is a synthetic local protocol endpoint, not an LLM. Any unexpected prompt fails closed.
  const endpoint = createServer(async (request, response) => {
    let input = "";
    for await (const chunk of request) input += chunk;
    const body = JSON.parse(input) as {
      model: string;
      messages: Array<{ role: string; content: string | Array<{ type: string; text?: string }> }>;
    };
    const user = body.messages.filter((message) => message.role === "user").at(-1)?.content;
    const text =
      typeof user === "string"
        ? user
        : user
            ?.filter((block) => block.type === "text")
            .map((block) => block.text)
            .join("");
    const observation = { model: body.model, input: text ?? "", aborted: false };
    requests.push(observation); // Retain only fixture input, never the system prompt or request headers.
    if (text !== "PHASE0_WAIT") {
      response.writeHead(400, { "content-type": "application/json" });
      response.end(
        JSON.stringify({ error: { message: "Only PHASE0_WAIT is allowed by the fixture" } }),
      );
      return;
    }
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.write(
      `data: ${JSON.stringify({ id: "phase0", object: "chat.completion.chunk", created: 0, model: body.model, choices: [{ index: 0, delta: { role: "assistant", content: "PHASE0_WAITING" }, finish_reason: null }] })}\n\n`,
    );
    response.on("close", () => {
      observation.aborted = true;
      signalAbort();
    });
    // Stay pending until Pi's native abort closes this response.
  });
  await new Promise<void>((resolve) => endpoint.listen(0, "127.0.0.1", resolve));
  const port = (endpoint.address() as { port: number }).port;
  json(join(agentDir, "models.json"), {
    providers: {
      "piano-phase0": {
        baseUrl: `http://127.0.0.1:${port}/v1`,
        api: "openai-completions",
        apiKey: "scratch-not-a-credential",
        models: ["global", "project", "plain"].map((id) => ({
          id,
          name: `Phase 0 ${id}`,
          reasoning: id !== "plain",
          input: ["text"],
          contextWindow: 200000,
          maxTokens: 128,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        })),
      },
    },
  });
  json(join(agentDir, "settings.json"), {
    defaultProvider: "piano-phase0",
    defaultModel: "global",
    defaultThinkingLevel: "low",
    cacheWarming: "off",
    defaultProjectTrust: "ask",
  });
  const configureSentinel = (mode: "enabled" | "disabled" | "broken") =>
    json(join(agentDir, "mcp.json"), {
      mcpServers: {
        "piano-sentinel": {
          command: process.execPath,
          args: [
            fixturePath("phase0-mcp.mjs"),
            mcpFile,
            ...(mode === "broken" ? ["--broken"] : []),
          ],
          enabled: mode !== "disabled",
          exposure: "direct",
          timeout: 3,
        },
      },
    });
  configureSentinel("enabled");
  const shim = join(root, "pi-cli.mjs");
  writeFileSync(
    shim,
    `import { sep } from 'node:path';
const root=${JSON.stringify(root)};
if(process.cwd()!==root&&!process.cwd().startsWith(root+sep))throw new Error('Refusing a non-fixture cwd');
for(const key of Object.keys(process.env))if(key!=="PATH")delete process.env[key];
process.env.HOME=root;
process.env.PI_CODING_AGENT_DIR=${JSON.stringify(agentDir)};
process.env.PI_CODING_AGENT_SESSION_DIR=${JSON.stringify(sessionDir)};
process.env.PI_OFFLINE="1";
process.env.PI_SKIP_VERSION_CHECK="1";
process.env.PI_TELEMETRY="0";
process.env.PIANO_PHASE0_LOG=${JSON.stringify(eventsFile)};
await import(${JSON.stringify(pathToFileURL(installedCli).href)});
`,
  );
  const cli = (
    trust: "approved" | "untrusted" = "approved",
    startup = false,
    keepAlive = false,
  ): PiCliConfig => ({
    node: process.execPath,
    cli: shim,
    // No extension/resource-disabling flags. --approve is scratch-only, never a production default.
    extraArgs: [
      "--offline",
      ...(trust === "approved" ? ["--approve"] : []),
      ...(startup ? ["--phase0-startup-dialog"] : []),
      ...(keepAlive ? ["--phase0-startup-keepalive"] : []),
    ],
  });
  const project = (name: string, disableSentinel = true, startupDialog = false) => {
    const cwd = join(root, name);
    mkdirSync(join(cwd, ".pi", "extensions"), { recursive: true });
    assert.equal(spawnSync("git", ["init", "--quiet", cwd]).status, 0);
    json(join(cwd, ".pi", "settings.json"), {
      defaultModel: "project",
      defaultThinkingLevel: "high",
    });
    copyFileSync(
      fixturePath("Phase0ProjectExtension.ts"),
      join(cwd, ".pi", "extensions", "marker.ts"),
    );
    if (startupDialog)
      copyFileSync(
        fixturePath("Phase0StartupExtension.ts"),
        join(cwd, ".pi", "extensions", "startup.ts"),
      );
    if (disableSentinel)
      json(join(cwd, ".pi", "mcp.json"), { mcpServers: { "piano-sentinel": { enabled: false } } });
    return cwd;
  };
  const records = (file: string): Array<Record<string, unknown>> =>
    existsSync(file)
      ? readFileSync(file, "utf8")
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line))
      : [];
  const observe = () => ({ pi: records(eventsFile), mcp: records(mcpFile), requests });
  const retain = (directory: string) => {
    mkdirSync(directory, { recursive: true });
    json(join(directory, "fixture-observations.json"), observe());
    json(join(directory, "fixture-environment.json"), {
      root,
      agentDir,
      sessionDir,
      installedCli,
      shim,
      node: process.execPath,
      port,
      cliArgs: cli().extraArgs,
      credentials: "removed from child environment; only a dummy local endpoint key",
      builtInMcp: "normal CLI discovery enabled",
    });
    copyFileSync(shim, join(directory, "pi-cli.mjs.txt"));
  };
  const close = async () => {
    endpoint.closeAllConnections();
    await new Promise<void>((resolve) => endpoint.close(() => resolve()));
    const pids = [
      ...new Set(
        [...records(eventsFile), ...records(mcpFile)].map((record) => record.pid as number),
      ),
    ];
    const alive = pids.filter((pid) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    });
    // Never kill a recorded PID after ownership ended: report leaks instead.
    assert.deepEqual(alive, [], "fixture Pi/MCP children must have exited before removing storage");
    rmSync(root, { recursive: true, force: true });
  };
  return {
    root,
    agentDir,
    sessionDir,
    installedCli,
    cli,
    project,
    configureSentinel,
    observe,
    aborted,
    retain,
    close,
  };
}
