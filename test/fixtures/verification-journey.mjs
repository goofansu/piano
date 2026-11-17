import assert from "node:assert/strict";
import { run } from "../browser/harness.mjs";

const mode = process.argv[3];
assert.ok(
  ["setup", "failure", "cancel", "worktree"].includes(mode),
  "choose setup, failure, cancel or worktree",
);
await run(
  `verification-${mode}`,
  () => {
    if (mode === "setup") throw new Error("intentional setup failure");
    return {};
  },
  async (page) => {
    await page.open("/");
    await page.capture("before-interruption");
    if (mode === "failure") assert.fail("intentional journey failure");
    process.kill(process.pid, "SIGTERM");
    await page.see("deliberately absent text");
  },
  { requiresWorktrunk: mode === "worktree" },
);
