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
  for (const file of ["verify.mjs", "verification-evidence.mjs", "test-changes.mjs"])
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
  const changes = (env: Record<string, string> = {}) =>
    spawnSync(process.execPath, [join(root, "scripts/test-changes.mjs")], {
      cwd: root,
      encoding: "utf8",
      timeout: 30000,
      env: { ...process.env, GITHUB_STEP_SUMMARY: "", ...env },
    });
  return { temp, root, configure, run, record, changes };
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
    const unavailable = f.changes();
    assert.equal(unavailable.status, 1);
    assert.match(unavailable.stdout, /Test lines since origin\/main: unavailable/);
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
    mkdirSync(join(f.root, "features/demo/test"), { recursive: true });
    writeFileSync(join(f.root, "features/demo/test/new.test.ts"), "x\ny\nz\n");
    const result = f.run("changed");
    const { added, removed, files } = f.record("changed").testLines;
    assert.deepEqual({ added, removed, files }, { added: 7, removed: 1, files: 3 });
    assert.match(result.stdout, /Test lines since origin\/main: \+7 −1/);
  } finally {
    rmSync(f.temp, { recursive: true, force: true });
  }
});

test("baseline flags added skips and net-removed assertions in tests, and not moved ones", () => {
  const f = fixture();
  const lines = (...text: string[]) => `${text.join("\n")}\n`;
  const commit = (message: string) => {
    for (const args of [
      ["add", "."],
      ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", message],
    ])
      execFileSync("git", args, { cwd: f.root });
  };
  try {
    f.configure("node -e \"console.log('linted')\"");
    mkdirSync(join(f.root, "features/math/test"), { recursive: true });
    writeFileSync(
      join(f.root, "features/math/test/add.test.ts"),
      lines(
        'test("adds", () => {',
        "  assert.equal(add(1, 2), 3);",
        "  assert.equal(add(0, 0), 0);",
        "});",
      ),
    );
    commit("main");
    execFileSync("git", ["update-ref", "refs/remotes/origin/main", "HEAD"], { cwd: f.root });

    writeFileSync(
      join(f.root, "features/math/test/add.test.ts"),
      lines(
        'test("adds", () => {',
        "  assert.equal(add(1, 2), 3);",
        "});",
        'test("sums", () => {',
        "  assert.equal(sum([0, 0]), 0);",
        "});",
      ),
    );
    const moved = f.run("moved");
    assert.match(moved.stdout, /0 skip\/only\/todo added; assertion lines \+1 −1\./);
    assert.doesNotMatch(moved.stdout, /REVIEW:/);

    writeFileSync(
      join(f.root, "features/math/test/add.test.ts"),
      lines(
        'test("works only: when ready", () => {',
        "  // assert.equal(add(1, 2), 3);",
        '  const message = "assert.equal(a, b)";',
        "});",
        "test(",
        '  "adds negatives",',
        "  { skip: true },",
        "  () => {},",
        ");",
        'test("parent", async (t) => {',
        '  await t.test("child", { timeout: 10, only: true }, () => {});',
        "});",
      ),
    );
    mkdirSync(join(f.root, "test"));
    writeFileSync(join(f.root, "test/new.test.ts"), lines('test.todo("subtracts");'));
    const weakened = f.run("weakened");
    assert.match(weakened.stdout, /3 skip\/only\/todo added; assertion lines \+0 −2\./);
    for (const skip of [
      "features/math/test/add.test.ts: { skip: true },",
      'features/math/test/add.test.ts: await t.test("child", { timeout: 10, only: true }, () => {});',
      'test/new.test.ts: test.todo("subtracts");',
    ])
      assert.ok(weakened.stdout.includes(`  ${skip}\n`), skip);
    assert.match(weakened.stdout, /REVIEW: justify each skip and removed assertion/);

    const summary = join(f.temp, "summary.md");
    const changes = f.changes({ GITHUB_STEP_SUMMARY: summary });
    assert.equal(changes.status, 0, changes.stderr);
    const report = changes.stdout.trim();
    assert.ok(weakened.stdout.includes(report), "test-changes prints the report verify prints");
    assert.equal(readFileSync(summary, "utf8"), `### Test changes\n\n\`\`\`\n${report}\n\`\`\`\n`);
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
