/** Real Pi, scripted loopback model: no credentials, remote requests or paid model calls. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defaultPiCli } from "../../server/PiCli.ts";

export async function askUserFixture() {
  const scratch = fileURLToPath(new URL("../../.scratch/", import.meta.url));
  mkdirSync(scratch, { recursive: true });
  const root = mkdtempSync(join(scratch, "ask-user-"));
  const agentDir = join(root, "agent");
  const sessionDir = join(root, "sessions");
  mkdirSync(agentDir);
  mkdirSync(sessionDir);
  const requests: Array<{ prompt: string; tools: string[]; results: string[] }> = [];
  const endpoint = createServer(async (request, response) => {
    let input = "";
    for await (const part of request) input += part;
    const body = JSON.parse(input) as {
      tools?: Array<{ function: { name: string } }>;
      messages: Array<{ role: string; content: string | Array<{ text?: string }> }>;
    };
    const text = (content: (typeof body.messages)[number]["content"]) =>
      typeof content === "string" ? content : content?.map((part) => part.text ?? "").join("");
    const userIndex = body.messages.findLastIndex((message) => message.role === "user");
    const prompt = text(body.messages[userIndex]?.content) ?? "";
    const results = body.messages
      .slice(userIndex + 1)
      .filter((message) => message.role === "tool")
      .map((message) => text(message.content));
    requests.push({ prompt, tools: body.tools?.map((tool) => tool.function.name) ?? [], results });
    if (!/^ASK_(CHOICE|TEXT|CANCEL|STOP)$/.test(prompt)) {
      response.writeHead(400);
      response.end("Only ASK_* fixture prompts are permitted");
      return;
    }
    const delta = results.length
      ? { role: "assistant", content: `ANSWER_RECEIVED: ${results.at(-1)}` }
      : {
          role: "assistant",
          tool_calls: [
            {
              index: 0,
              id: `call_${prompt}`,
              type: "function",
              function: {
                name: "ask_user",
                arguments: JSON.stringify({
                  question: prompt === "ASK_CHOICE" ? "Which database?" : "What should change?",
                  ...(prompt === "ASK_CHOICE" ? { options: ["PostgreSQL", "SQLite"] } : {}),
                }),
              },
            },
          ],
        };
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.end(
      `data: ${JSON.stringify({
        id: "ask-user",
        object: "chat.completion.chunk",
        created: 0,
        model: "local",
        choices: [{ index: 0, delta, finish_reason: results.length ? "stop" : "tool_calls" }],
      })}\n\ndata: [DONE]\n\n`,
    );
  });
  await new Promise<void>((resolve) => endpoint.listen(0, "127.0.0.1", resolve));
  writeFileSync(
    join(agentDir, "models.json"),
    JSON.stringify({
      providers: {
        "piano-ask-test": {
          baseUrl: `http://127.0.0.1:${(endpoint.address() as { port: number }).port}/v1`,
          api: "openai-completions",
          apiKey: "scratch-not-a-credential",
          models: [
            {
              id: "local",
              reasoning: false,
              input: ["text"],
              contextWindow: 200000,
              maxTokens: 512,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            },
          ],
        },
      },
    }),
  );
  writeFileSync(
    join(agentDir, "settings.json"),
    JSON.stringify({
      defaultProvider: "piano-ask-test",
      defaultModel: "local",
      cacheWarming: "off",
    }),
  );
  const shim = join(root, "pi-cli.mjs");
  writeFileSync(
    shim,
    `for(const key of Object.keys(process.env))if(key!=="PATH")delete process.env[key];
process.env.HOME=${JSON.stringify(root)};
process.env.PI_CODING_AGENT_DIR=${JSON.stringify(agentDir)};
process.env.PI_CODING_AGENT_SESSION_DIR=${JSON.stringify(sessionDir)};
process.env.PI_OFFLINE="1";
await import(${JSON.stringify(new URL("../../node_modules/@earendil-works/pi-coding-agent/dist/cli.js", import.meta.url).href)});`,
  );
  const cli = {
    ...defaultPiCli(),
    cli: shim,
    extraArgs: [
      "--tools",
      "ask_user",
      "--no-extensions",
      "--no-skills",
      "--no-prompt-templates",
      "--no-context-files",
      "--no-approve",
      "--offline",
    ],
  };
  return {
    root,
    agentDir,
    sessionDir,
    requests,
    cli,
    close: async () => {
      endpoint.closeAllConnections();
      await new Promise<void>((resolve) => endpoint.close(() => resolve()));
      rmSync(root, { recursive: true, force: true });
    },
  };
}
