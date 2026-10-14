import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";

test("Pi queue patch installs from clean package files, is idempotent, and refuses drift", () => {
  const root = mkdtempSync(join(tmpdir(), "piano-pi-patch-"));
  const pkg = "node_modules/@earendil-works/pi-coding-agent";
  const patch = "patches/@earendil-works+pi-coding-agent+1.2.0.patch";
  const installer = "scripts/apply-pi-patch.mjs";
  const files = [
    `${pkg}/dist/core/agent-session.js`,
    `${pkg}/dist/core/agent-session.d.ts`,
    `${pkg}/dist/modes/rpc/rpc-mode.js`,
    `${pkg}/dist/modes/rpc/rpc-types.d.ts`,
  ];
  const install = () => spawnSync(process.execPath, [installer], { cwd: root, encoding: "utf8" });
  const git = (...args: string[]) =>
    spawnSync("git", ["apply", ...args, patch], { cwd: root, encoding: "utf8" });
  try {
    for (const file of [...files, `${pkg}/package.json`, patch, installer]) {
      const target = join(root, file);
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(file, target);
    }
    // Start from the pristine upstream package, independent of install-script execution locally.
    if (git("--reverse", "--check").status === 0) assert.equal(git("--reverse").status, 0);
    const pristine = files.map((file) => readFileSync(join(root, file), "utf8"));
    const first = install();
    assert.equal(first.status, 0, first.stderr);
    const patched = files.map((file) => readFileSync(join(root, file), "utf8"));
    assert.notDeepEqual(patched, pristine);
    assert.equal(install().status, 0, "reinstall is safe");
    assert.deepEqual(
      files.map((file) => readFileSync(join(root, file), "utf8")),
      patched,
    );
    assert.equal(git("--reverse").status, 0);
    writeFileSync(join(root, files[0]), "unexpected upstream source\n");
    assert.notEqual(
      install().status,
      0,
      "an incompatible patch fails installation, not silently unpatched runtime",
    );
    writeFileSync(join(root, `${pkg}/package.json`), JSON.stringify({ version: "1.2.1" }));
    const upgraded = install();
    assert.notEqual(upgraded.status, 0);
    assert.match(upgraded.stderr, /requires 1\.2\.0/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
