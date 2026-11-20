import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

test("browser preflight blocks a journey whose prerequisites are missing", () => {
  const evidence = mkdtempSync(join(tmpdir(), "piano-harness-prerequisites-"));
  try {
    const path = join(evidence, "empty-path");
    mkdirSync(path);
    const result = spawnSync(
      process.execPath,
      ["test/fixtures/verification-journey.mjs", evidence, "cancel"],
      {
        cwd: resolve(import.meta.dirname, ".."),
        env: { ...process.env, PATH: path },
        encoding: "utf8",
        timeout: 30000,
      },
    );
    assert.equal(result.status, 1, result.stderr);
    const record = JSON.parse(readFileSync(join(evidence, "run.json"), "utf8"));
    assert.equal(record.outcome, "blocked");
    assert.match(record.error, /Missing prerequisites: git, agent-browser;/);
    assert.ok(record.environment.tools.npm.unavailable, "direct Node journeys do not need npm");
    assert.equal(record.cleanup.outcome, "passed");
    assert.equal(existsSync(record.scratch), false);
    assert.deepEqual(record.pids, []);
  } finally {
    rmSync(evidence, { recursive: true, force: true });
  }
});

test("browser setup failure replaces old pass evidence and tears down its scratch root", () => {
  const evidence = mkdtempSync(join(tmpdir(), "piano-harness-evidence-"));
  try {
    writeFileSync(join(evidence, "run.json"), JSON.stringify({ outcome: "passed" }));
    const result = spawnSync(
      process.execPath,
      ["test/fixtures/verification-journey.mjs", evidence, "setup"],
      { cwd: resolve(import.meta.dirname, ".."), encoding: "utf8", timeout: 30000 },
    );
    assert.equal(result.status, 1, result.stderr);
    const record = JSON.parse(readFileSync(join(evidence, "run.json"), "utf8"));
    assert.equal(record.outcome, "error");
    assert.match(record.error, /intentional setup failure/);
    assert.ok(record.scratch);
    assert.equal(existsSync(record.scratch), false);
    assert.equal(record.cleanup.outcome, "passed");
    assert.deepEqual(record.pids, []);
    assert.ok(record.finishedAt);
  } finally {
    rmSync(evidence, { recursive: true, force: true });
  }
});
