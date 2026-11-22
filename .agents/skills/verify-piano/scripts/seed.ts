#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { seedRegistry } from "../../../../test/shared/registry.ts";

const help = `Usage: node seed.ts <database> <repo> <pi-session-dir>
Seed launch.sh's empty scratch database with the throwaway repo, two projects and two saved sessions
with Pi history. "Plan the verification" includes one successful write of src/answer.ts.
Run by launch.sh before the backend starts.`;
if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(help);
  process.exit(0);
}
const [database, repo, sessionDir] = process.argv.slice(2);
if (!database || !repo || !sessionDir) throw new Error(help);

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
const sessions = [
  {
    sessionId: "verify-plan",
    title: "Plan the verification",
    cwd: repo,
    projectId: "verify",
    createdAt: ago(120),
    updatedAt: ago(60),
    pullRequest: { url: "https://github.com/goofansu/piano/pull/222", source: "manual" },
  },
  { sessionId: "verify-loose", title: "Loose session", cwd: repo, createdAt: ago(30), updatedAt: ago(20) },
];

seedRegistry(database, {
  folders: [repo],
  projects: [
    { id: "verify", name: "Verify Project" },
    { id: "empty", name: "Empty Project" },
  ],
  sessions,
} as never);

const usage = {
  input: 1200,
  output: 300,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 1500,
  cost: { input: 0.0018, output: 0.0045, cacheRead: 0, cacheWrite: 0, total: 0.0063 },
};
const assistant = (content: unknown[], extra: object = {}) => ({
  role: "assistant",
  content,
  api: "fake",
  provider: "fake",
  model: "alpha",
  usage,
  stopReason: "stop",
  timestamp: Date.now(),
  ...extra,
});
const noUsage = { ...usage, input: 0, output: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const wrote = [
  assistant([{ type: "toolCall", id: "w1", name: "write", arguments: { path: "src/answer.ts", content: "export const answer = 4;\n" } }], { usage: noUsage, stopReason: "toolUse" }),
  { role: "toolResult", toolCallId: "w1", toolName: "write", content: [{ type: "text", text: "Wrote src/answer.ts" }], isError: false, timestamp: Date.now() },
];
for (const { sessionId, cwd, title } of sessions) {
  const timestamp = new Date().toISOString();
  const messages = [
    { role: "user", content: `What is 2 + 2? (${title})`, timestamp: Date.now() },
    ...(sessionId === "verify-plan" ? wrote : []),
    assistant([{ type: "text", text: "Answer 4." }]),
  ];
  const entries = [
    { type: "session", version: 3, id: sessionId, cwd, timestamp },
    ...messages.map((message, i) => ({ type: "message", id: `m${i}`, parentId: i ? `m${i - 1}` : null, timestamp, message })),
  ];
  writeFileSync(join(sessionDir, `${sessionId}.jsonl`), `${entries.map((e) => JSON.stringify(e)).join("\n")}\n`);
}
console.log(`seeded ${sessions.length} sessions into ${database}`);
