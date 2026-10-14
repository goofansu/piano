// Pi owns queue identity and metadata. Keep this patch pinned until upstream exposes them.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const installed = JSON.parse(
  readFileSync(new URL("../node_modules/@earendil-works/pi-coding-agent/package.json", import.meta.url), "utf8"),
);
if (installed.version !== "1.2.0") {
  throw new Error(`Pi queue patch requires 1.2.0, found ${installed.version}. Review the patch before upgrading.`);
}
const patch = "patches/@earendil-works+pi-coding-agent+1.2.0.patch";
const apply = (...args) => spawnSync("git", ["apply", ...args, patch], { cwd: root, encoding: "utf8" });
const existing = apply("--reverse", "--check");
if (existing.error) throw existing.error;
if (existing.status !== 0) {
  const result = apply();
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Cannot apply Pi queue patch:\n${result.stderr}`);
}
console.log("Pi 1.2.0 queue metadata patch applied.");
