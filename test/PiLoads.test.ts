import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadedBeforePiano } from "../server/PiLoads.ts";

test("a package manager that hangs never stalls Piano, and fails the answer instead", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "piano-pi-loads-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const agentDir = join(root, "agent");
  const piano = join(root, "piano", "skills");
  mkdirSync(piano, { recursive: true });
  mkdirSync(join(agentDir, "skills", "theirs"), { recursive: true });
  writeFileSync(
    join(agentDir, "skills", "theirs", "SKILL.md"),
    "---\nname: theirs\ndescription: Pi's own.\n---\n\nGo.\n",
  );
  // Pi asks the package manager, synchronously, where global packages live for an `npm:` package
  // not in its own folder. This one takes two seconds to answer.
  const slow = join(root, "slow-npm.mjs");
  writeFileSync(slow, "Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2000);\n");
  const settings = join(agentDir, "settings.json");
  writeFileSync(
    settings,
    JSON.stringify({ npmCommand: [process.execPath, slow], packages: ["npm:not-installed"] }),
  );

  let ticks = 0;
  const ticking = setInterval(() => ticks++, 20);
  t.after(() => clearInterval(ticking));
  const started = Date.now();
  await assert.rejects(loadedBeforePiano("skill", agentDir, piano, 500), /did not answer in time/);
  assert.ok(Date.now() - started < 1500, "the answer fails at its deadline");
  assert.ok(ticks >= 10, `Piano's event loop kept running (${ticks} ticks)`);

  // The next answer comes from a new worker.
  writeFileSync(settings, JSON.stringify({}));
  const found = await loadedBeforePiano("skill", agentDir, piano);
  assert.equal(found.get("theirs"), join(agentDir, "skills", "theirs", "SKILL.md"));
});
