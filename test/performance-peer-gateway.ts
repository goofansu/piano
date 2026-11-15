// Opt-in, serial loopback workload; not a CI timing gate. Output stays outside Git.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { gatewayFixture, identity, registry } from "./fixtures/peer-gateway.ts";

const output = resolve(process.argv[2]);
mkdirSync(output, { recursive: true });
const samples = Number(process.env.PIANO_BENCH_SAMPLES ?? 100);
const profile = process.env.PIANO_BENCH_PROFILE === "1";

test("peer gateway warm attachment", { timeout: 180_000 }, async (t) => {
  const start = performance.now();
  const f = await gatewayFixture(t, {
    peers: [{ id: "eng-1" }, { id: "eng-2" }],
    nodeArgs: profile
      ? ["--cpu-prof", "--heap-prof", `--cpu-prof-dir=${output}`, `--heap-prof-dir=${output}`]
      : [],
  });
  const startupMs = performance.now() - start;
  // Linux process counters are raw: CPU ticks, current RSS, and high-water RSS.
  const resource = () => ({
    stat: readFileSync(`/proc/${f.pid}/stat`, "utf8"),
    status: readFileSync(`/proc/${f.pid}/status`, "utf8"),
  });
  const rows: object[] = [];
  const attach = async (peerId: string, count: number, iteration: number, warmup: boolean) => {
    const begin = performance.now();
    const client = await f.open({}, true, peerId);
    const attached = performance.now();
    const peer = f.peers.find((p) => p.config.id === peerId)!;
    assert.equal(client.messages[1], peer.state.sent.at(-1));
    client.send({ _tag: "select", ...identity, selectionId: "bench" });
    await peer.until(() => client.messages.some((raw) => JSON.parse(raw)._tag === "selected"));
    const selected = performance.now();
    client.ws.close();
    await client.closed;
    if (!warmup)
      rows.push({
        peerId,
        count,
        iteration,
        attachmentMs: attached - begin,
        selectMs: selected - attached,
      });
  };
  const batches = [];
  for (const count of [10, 2000]) {
    for (const peer of f.peers)
      peer.state.initial = {
        ...registry,
        sessionReferences: Array.from({ length: count }, (_, n) => ({
          ...registry.sessionReferences[0],
          sessionId: `session-${n}`,
        })),
      };
    for (const concurrent of [false, true]) {
      const operation = async (n: number, warmup: boolean) => {
        await Promise.all(
          (concurrent ? ["eng-1", "eng-2"] : ["eng-1"]).map((id) => attach(id, count, n, warmup)),
        );
        // Do not let the fixture's audit arrays become the measured retention.
        for (const p of f.peers) {
          p.state.sent.length = 0;
          p.state.received.length = 0;
          p.state.requests.length = 0;
        }
      };
      for (let n = 0; n < 20; n++) await operation(n, true);
      const before = resource();
      const rowStart = rows.length;
      for (let n = 0; n < samples; n++) await operation(n, false);
      batches.push({ count, concurrent, before, after: resource(), rows: rows.slice(rowStart) });
    }
  }
  writeFileSync(
    `${output}/samples.json`,
    JSON.stringify(
      {
        revision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
        diff: execFileSync("git", ["diff"], { encoding: "utf8" }),
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        startupMs,
        samples,
        profile,
        batches,
      },
      null,
      2,
    ),
  );
  writeFileSync(`${output}/backend.log`, f.logs());
});
