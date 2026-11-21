import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";

test("repository paths and module names are distinct on case-insensitive filesystems", () => {
  const paths = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    {
      cwd: new URL("../", import.meta.url),
      encoding: "utf8",
    },
  );
  const entries = new Map<string, string>();
  const modules = new Map<string, string>();
  function register(names: Map<string, string>, name: string, path: string) {
    const key = name.normalize("NFD").toLowerCase();
    const previous = names.get(key);
    assert.ok(previous === undefined || previous === path, `${previous} conflicts with ${path}`);
    names.set(key, path);
  }
  for (const path of paths.split("\0").filter(Boolean)) {
    let prefix = "";
    for (const segment of path.split("/")) {
      prefix = prefix ? `${prefix}/${segment}` : segment;
      register(entries, prefix, prefix);
    }
    const stem = path.replace(/\.(?:[cm]?[jt]s|[jt]sx)$/i, "");
    if (stem !== path) register(modules, stem, path);
  }
});
