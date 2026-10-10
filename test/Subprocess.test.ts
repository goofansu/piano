import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect } from "effect";
import { run, SubprocessError } from "../server/Subprocess.ts";

const node = (script: string, options: Partial<Parameters<typeof run>[0]> = {}) =>
  Effect.runPromise(run({ command: process.execPath, args: ["-e", script], ...options }).pipe(Effect.result));
const failed = (result: Awaited<ReturnType<typeof node>>) => {
  assert.equal(result._tag, "Failure");
  if (result._tag !== "Failure") throw new Error("expected failure");
  assert.ok(result.failure instanceof SubprocessError);
  return result.failure;
};

test("oversized output fails closed unless the caller asks for a truncated head", async () => {
  const script = "process.stdout.write('x'.repeat(100000))";
  assert.equal(failed(await node(script, { limit: 1000 })).reason, "limit");
  const head = await node(script, { limit: 1000, truncate: true });
  assert.equal(head._tag, "Success");
  if (head._tag === "Success") { assert.equal(head.success.stdout.length, 1000); assert.equal(head.success.truncated, true); }
});

test("only accepted exit codes succeed; a rejected exit reports stderr", async () => {
  const script = "process.stderr.write('fatal: nope\\n'); process.exit(1)";
  const rejected = failed(await node(script));
  assert.equal(rejected.reason, "exit"); assert.equal(rejected.code, 1); assert.equal(rejected.message, "fatal: nope");
  const accepted = await node(script, { okCodes: [0, 1] });
  assert.equal(accepted._tag === "Success" && accepted.success.code, 1);
});

test("a child waiting on input sees closed stdin, and a hung child is killed at its timeout", async () => {
  const echoed = await node("process.stdin.pipe(process.stdout)", { input: "approve?" });
  assert.equal(echoed._tag === "Success" && echoed.success.stdout.toString(), "approve?");
  const started = Date.now();
  assert.equal(failed(await node("setInterval(() => {}, 1000)", { timeout: 200 })).reason, "timeout");
  assert.ok(Date.now() - started < 5000);
});
