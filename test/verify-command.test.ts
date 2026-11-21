import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

const ROOT = resolve(import.meta.dirname, "..");
function fixture() {
  const temp = mkdtempSync(join(tmpdir(), "piano-verify-"));
  const root = join(temp, "checkout");
  mkdirSync(join(root, "scripts"), { recursive: true });
  mkdirSync(join(root, "node_modules"));
  mkdirSync(join(root, ".scratch"));
  for (const file of ["verify.mjs", "verification-evidence.mjs"])
    copyFileSync(join(ROOT, "scripts", file), join(root, "scripts", file));
  writeFileSync(join(root, ".gitignore"), "node_modules/\n.scratch/\n");
  const configure = (lint: string) =>
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({
        scripts: {
          typecheck: "node -e \"console.log('typechecked')\"",
          lint,
          test: "node -e \"console.log('tested')\"",
        },
      }),
    );
  configure("node -e \"console.error('intentional failure'); process.exit(1)\"");
  for (const args of [
    ["init", "-q"],
    ["add", "."],
    ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "base"],
  ])
    execFileSync("git", args, { cwd: root });
  const run = (name: string) =>
    spawnSync(process.execPath, [join(root, "scripts/verify.mjs"), join(temp, name)], {
      cwd: root,
      encoding: "utf8",
      timeout: 30000,
    });
  const record = (name: string) => JSON.parse(readFileSync(join(temp, name, "run.json"), "utf8"));
  return { temp, root, configure, run, record };
}

test("baseline retains exact checks and diagnostics; failed and blocked are not passes", () => {
  const f = fixture();
  try {
    assert.equal(f.run("failed").status, 1);
    const failed = f.record("failed");
    assert.equal(failed.outcome, "failed");
    assert.deepEqual(
      failed.checks.map((c: { outcome: string }) => c.outcome),
      ["passed", "failed", "passed"],
    );
    assert.deepEqual(failed.checks[1].command, ["npm", "run", "lint"]);
    assert.match(readFileSync(failed.checks[1].log, "utf8"), /intentional failure/);
    f.configure("node -e \"console.log('linted')\"");
    assert.equal(f.run("passed").status, 0);
    assert.equal(f.record("passed").outcome, "passed");
    writeFileSync(
      join(f.root, "mutate.cjs"),
      'require("node:fs").writeFileSync("input.ts", "changed during check");',
    );
    f.configure("node mutate.cjs");
    assert.equal(f.run("unstable").status, 1);
    assert.equal(f.record("unstable").outcome, "unstable");
    assert.ok(
      f.record("unstable").checks.every((c: { outcome: string }) => c.outcome === "passed"),
    );
    rmSync(join(f.root, "node_modules"), { recursive: true });
    assert.equal(f.run("blocked").status, 1);
    assert.equal(f.record("blocked").outcome, "blocked");
    assert.ok(
      f.record("blocked").checks.every((c: { outcome: string }) => c.outcome === "not-run"),
    );
  } finally {
    rmSync(f.temp, { recursive: true, force: true });
  }
});

test("baseline reports changes in feature and shared tests since origin/main, uncommitted and new files included", () => {
  const f = fixture();
  try {
    f.configure("node -e \"console.log('linted')\"");
    f.run("no-base");
    assert.match(f.record("no-base").testLines.unavailable, /origin\/main/);
    mkdirSync(join(f.root, "test"));
    writeFileSync(join(f.root, "test/kept.test.ts"), "one\ntwo\nthree\n");
    writeFileSync(join(f.root, "source.ts"), "outside test\n");
    for (const args of [
      ["add", "."],
      ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "main"],
      ["update-ref", "refs/remotes/origin/main", "HEAD"],
    ])
      execFileSync("git", args, { cwd: f.root });
    writeFileSync(join(f.root, "test/kept.test.ts"), "one\nthree\nfour\nfive\n");
    writeFileSync(join(f.root, "test/committed.test.ts"), "a\nb\n");
    writeFileSync(join(f.root, "source.ts"), "outside test\nmore\n");
    for (const args of [
      ["add", "test/committed.test.ts"],
      ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "branch"],
    ])
      execFileSync("git", args, { cwd: f.root });
    mkdirSync(join(f.root, "features/demo/tests"), { recursive: true });
    writeFileSync(join(f.root, "features/demo/tests/new.test.ts"), "x\ny\nz\n");
    const result = f.run("changed");
    const { added, removed, files } = f.record("changed").testLines;
    assert.deepEqual({ added, removed, files }, { added: 7, removed: 1, files: 3 });
    assert.match(result.stdout, /Test lines since origin\/main: \+7 −1/);
  } finally {
    rmSync(f.temp, { recursive: true, force: true });
  }
});

test("cancelled baseline retains diagnostics and never runs remaining gates", async () => {
  const f = fixture();
  let child;
  try {
    writeFileSync(
      join(f.root, "hold.cjs"),
      'require("node:fs").writeFileSync(".scratch/ready", String(process.pid)); console.log("waiting"); setInterval(() => {}, 1000);',
    );
    f.configure("node hold.cjs");
    child = spawn(
      process.execPath,
      [join(f.root, "scripts/verify.mjs"), join(f.temp, "cancelled")],
      { cwd: f.root, stdio: "ignore" },
    );
    const closed = new Promise((done) => child!.once("close", done));
    const lintLog = join(f.temp, "cancelled", "2-lint.log");
    for (let attempt = 0; ; attempt++) {
      if (
        existsSync(join(f.root, ".scratch/ready")) &&
        existsSync(lintLog) &&
        readFileSync(lintLog, "utf8").includes("waiting")
      )
        break;
      assert.ok(attempt < 200, "baseline retained the lint diagnostic");
      await delay(50);
    }
    assert.equal(f.record("cancelled").outcome, "running", "incomplete checks cannot be passes");
    child.kill("SIGTERM");
    assert.equal(await closed, 143);
    const heldPid = readFileSync(join(f.root, ".scratch/ready"), "utf8");
    const state = spawnSync("ps", ["-p", heldPid, "-o", "stat="], {
      encoding: "utf8",
    }).stdout.trim();
    assert.ok(
      !state || state.startsWith("Z"),
      `cancelled check is still running: ${heldPid} ${state}`,
    );
    const record = f.record("cancelled");
    assert.equal(record.outcome, "cancelled");
    assert.deepEqual(
      record.checks.map((c: { outcome: string }) => c.outcome),
      ["passed", "cancelled", "not-run"],
    );
    assert.match(readFileSync(record.checks[1].log, "utf8"), /waiting/);
  } finally {
    child?.kill("SIGKILL");
    rmSync(f.temp, { recursive: true, force: true });
  }
});
