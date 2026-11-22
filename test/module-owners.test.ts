import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";

const ROOT = resolve(import.meta.dirname, "..");

test("a shared module that only one feature uses, directly or through shared modules, is reported", (t) => {
  const root = mkdtempSync(join(tmpdir(), "piano-owners-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (path: string, content: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  };
  for (const file of ["scripts/module-owners.mjs", "tsconfig.json", "web/tsconfig.app.json"]) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    copyFileSync(join(ROOT, file), join(root, file));
  }
  const run = () => {
    const result = spawnSync(process.execPath, ["scripts/module-owners.mjs"], {
      cwd: root,
      encoding: "utf8",
    });
    return { status: result.status, reported: result.stderr.trim().split("\n").filter(Boolean) };
  };
  put("shared/direct.ts", "export const direct = 1;\n");
  put("shared/inner.ts", "export const inner = 1;\n");
  put("shared/outer.ts", 'export { inner } from "./inner.ts";\n');
  put("web/src/shared/lib/common.ts", "export const common = 1;\n");
  put(
    "features/sessions/server/Uses.ts",
    'export { direct } from "../../../shared/direct.ts";\nexport { inner } from "../../../shared/outer.ts";\n',
  );
  put("features/sessions/web/Uses.ts", 'export { common } from "@/shared/lib/common";\n');
  put("features/navigation/web/Uses.ts", 'export { common } from "@/shared/lib/common";\n');

  const owned = run();
  assert.equal(owned.status, 1);
  assert.deepEqual(owned.reported.toSorted(), [
    "shared/direct.ts is used only by features/sessions; move it into that feature",
    "shared/inner.ts is used only by features/sessions; move it into that feature",
    "shared/outer.ts is used only by features/sessions; move it into that feature",
  ]);

  put("server/app/Uses.ts", 'export { direct } from "../../shared/direct.ts";\n');
  put("features/projects/server/Uses.ts", 'export { inner } from "../../../shared/outer.ts";\n');
  assert.deepEqual(run(), { status: 0, reported: [] });
});
