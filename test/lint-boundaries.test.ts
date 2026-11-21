import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";

const ROOT = resolve(import.meta.dirname, "..");

test("oxlint enforces layer edges, including types, aliases and a shared bridge", () => {
  const root = mkdtempSync(join(tmpdir(), "piano-layers-"));
  const put = (path: string, content: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  };
  try {
    for (const file of [
      ".oxlintrc.json",
      "scripts/lint-boundaries.mjs",
      "tsconfig.json",
      "web/tsconfig.app.json",
      "web/src/components/ui/.oxlintrc.json",
    ]) {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      copyFileSync(join(ROOT, file), join(root, file));
    }
    const config = JSON.parse(readFileSync(join(root, "web/tsconfig.app.json"), "utf8"));
    config.compilerOptions.paths["@backend/*"] = ["../server/*"];
    put("web/tsconfig.app.json", JSON.stringify(config));
    symlinkSync(join(ROOT, "node_modules"), join(root, "node_modules"), "dir");
    put("server/Thing.ts", "export type Thing = string;\n");
    put("shared/Thing.ts", "export type Thing = string;\n");
    put("web/src/Thing.ts", "export type Thing = string;\n");
    const lint = (files: string[]) =>
      spawnSync(
        join(ROOT, "node_modules/.bin/oxlint"),
        ["--deny-warnings", "--config", join(root, ".oxlintrc.json"), ...files],
        { cwd: root, encoding: "utf8" },
      );
    const cases: [string, string, boolean][] = [
      ["web/src/check.ts", 'export type { Thing } from "@backend/Thing";', false],
      ["server/check.ts", 'export type { Thing } from "@shared/Thing";', true],
      [
        "server/shared/check.ts",
        'export type { Thing } from "../features/sessions/Thing.ts";',
        false,
      ],
      ["server/shared/check.ts", 'export type { Thing } from "../app/Thing.ts";', false],
      [
        "server/features/sessions/check.ts",
        'export type { Thing } from "../../shared/Thing.ts";',
        true,
      ],
      ["web/src/shared/check.ts", 'export type { Thing } from "@/features/sessions/Thing";', false],
      ["web/src/shared/check.ts", 'export type { Thing } from "@/app/Thing";', false],
      [
        "web/src/shared/check.ts",
        'export type { Thing } from "@shared/features/sessions/Thing";',
        true,
      ],
      ["server/check.ts", "export const load = (path: string) => import(path);", false],
      [
        "web/src/hooks/use-mobile.ts",
        'export type { Thing } from "../../../server/Thing.ts";',
        false,
      ],
      [
        "web/src/components/ui/check.ts",
        'export type { Thing } from "../../../../server/Thing.ts";',
        false,
      ],
      ["web/src/check.ts", 'export type { Thing } from "@shared/Thing";', true],
      ["server/check.ts", 'export type { Thing } from "../shared/Thing.ts";', true],
      ["server/check.ts", 'export type { Thing } from "../scripts/Thing.ts";', true],
      [
        "shared/check.ts",
        'export { Schema } from "effect"; export { str } from "@earendil-works/pi-schema"; export { z } from "zod";',
        true,
      ],
      ["web/src/check.ts", 'export type { Thing } from "../../server/Thing.ts";', false],
      [
        "web/src/check.ts",
        'import type { Thing } from "../../server/Thing.ts"; export type T = Thing;',
        false,
      ],
      ["web/src/check.ts", 'export type T = import("../../server/Thing.ts").Thing;', false],
      ["web/src/check.ts", 'export const load = () => import("../../server/Thing.ts");', false],
      ["web/src/check.ts", "export const load = () => import(`../../server/Thing.ts`);", false],
      ["web/src/check.ts", "export const load = (path: string) => import(path);", false],
      ["web/src/check.ts", 'export * from "@/../../server/Thing";', false],
      ["web/src/check.ts", 'export * from "../../scripts/bridge.ts";', false],
      ["server/check.ts", 'export * from "../web/src/Thing.ts";', false],
      ["shared/check.ts", 'export * from "../server/Thing.ts";', false],
      ["shared/check.ts", 'export type { Thing } from "../web/src/Thing.ts";', false],
      ["shared/check.ts", 'export * from "../scripts/bridge.ts";', false],
      ["shared/check.ts", 'export * from "node:fs";', false],
      ["shared/check.ts", 'export * from "fs/promises";', false],
      ["shared/check.ts", 'export * from "@effect/platform-node";', false],
      ["shared/check.ts", 'export * from "@earendil-works/pi-coding-agent";', false],
      ["shared/check.ts", 'export const load = () => require("node:fs");', false],
    ];
    for (const [file, source, allowed] of cases) {
      put(file, source);
      const result = lint([file]);
      const output = result.stdout + result.stderr;
      assert.equal(result.status, allowed ? 0 : 1, `${file}: ${source}\n${output}`);
      if (!allowed) assert.match(output, /piano\(layer-imports\)/, output);
      rmSync(join(root, file));
    }
    symlinkSync(join(root, "server/Thing.ts"), join(root, "web/src/$&bridge.ts"));
    put("web/src/check.ts", 'export type { Thing } from "@/$&bridge";');
    const dollar = lint(["web/src/check.ts"]);
    assert.equal(dollar.status, 1, dollar.stdout + dollar.stderr);
    assert.match(dollar.stdout, /server\/Thing.ts/);

    put("web/src/check.ts", 'export * from "@shared/bridge";');
    put("shared/bridge.ts", 'export * from "../server/Thing.ts";');
    const bridge = lint(["web/src/check.ts", "shared/bridge.ts"]);
    assert.equal(bridge.status, 1);
    assert.match(bridge.stdout, /shared\/bridge.ts/);
    rmSync(join(root, "shared/bridge.ts"));
    symlinkSync(join(root, "server/Thing.ts"), join(root, "shared/bridge.ts"));
    const symlink = lint(["web/src/check.ts"]);
    assert.equal(symlink.status, 1);
    assert.match(symlink.stdout, /server\/Thing.ts/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("oxlint rejects regex literals that CodeQL reads as an HTML tag filter", () => {
  const root = mkdtempSync(join(tmpdir(), "piano-tag-regex-"));
  try {
    const cases: [string, boolean][] = [
      ["export const a = /<SCRIPT>/;", false],
      ["export const a = /<\\/script>/i;", false],
      ["export const a = /<!--/;", false],
      ['export const a = (s: string) => s.includes("<script>");', true],
      ["export const a = /<div[^>]*>/;", true],
    ];
    for (const [source, passes] of cases) {
      writeFileSync(join(root, "check.ts"), `${source}\n`);
      const result = spawnSync(
        join(ROOT, "node_modules/.bin/oxlint"),
        ["--deny-warnings", "--config", join(ROOT, ".oxlintrc.json"), join(root, "check.ts")],
        { cwd: ROOT, encoding: "utf8" },
      );
      assert.equal(result.status === 0, passes, `${source}\n${result.stdout}${result.stderr}`);
      if (!passes) assert.match(result.stdout, /no-html-tag-regex/);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
