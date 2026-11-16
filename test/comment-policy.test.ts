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

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "piano-comments-"));
  const put = (path: string, source: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), source);
  };
  for (const file of [
    ".oxlintrc.json",
    "scripts/lint-boundaries.mjs",
    "scripts/comment-policy.mjs",
    "scripts/stylelint-comments.mjs",
    "tsconfig.json",
    "web/tsconfig.app.json",
    "web/src/components/ui/.oxlintrc.json",
    "stylelint.config.mjs",
  ]) {
    put(file, "");
    copyFileSync(join(ROOT, file), join(root, file));
  }
  symlinkSync(join(ROOT, "node_modules"), join(root, "node_modules"), "dir");
  return {
    put,
    read: (file: string) => readFileSync(join(root, file), "utf8"),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
    lint: (tool: string, files: string[], extra: string[] = []) => {
      const config = tool === "oxlint" ? ["--config", join(root, ".oxlintrc.json")] : [];
      const result = spawnSync(
        join(ROOT, "node_modules/.bin", tool),
        [...config, ...extra, ...files],
        {
          cwd: root,
          encoding: "utf8",
        },
      );
      assert.ifError(result.error);
      return { status: result.status, output: result.stdout + result.stderr };
    },
  };
}

const declaration = "\nexport const value = 1;\n";

test("Oxlint rejects narration and fake exceptions; fix does not delete comments", () => {
  const f = fixture();
  try {
    const cases = [
      "// Explain the API here.",
      "/* Module header. */",
      "/** @param value API narration. */",
      "// ----- Section -----",
      "// The test expects this result.",
      "// WORKAROUND(): missing tool",
      "// WORKAROUND( ): missing tool",
      "// WORKAROUND(tool):",
      "/* WORKAROUND(tool):   */",
      "// WORKAROUND(tool): ...",
      "// WORKAROUND(...): missing tool",
      "// WORKAROUND(tool) missing colon",
      "// @anything Arbitrary prose.",
      "/* ! Important explanation. */",
      "// eslint tells us what happens.",
      "// oxlint-disable-next-line no-debugger",
      "// oxlint-disable-next-line no-debugger --",
      "// oxlint-disable-next-line no-debugger -- ...",
      "// eslint-disable-made-up no-debugger -- a reason",
      "// stylelint-disable color-no-invalid-hex -- not JS tooling",
      "// @ts-expect-error",
      "// @ts-expect-error ...",
      "// @ts-expect-errorish not a directive",
      "// * @ts-check",
      '// / <reference lib="dom" />',
      '/// <reference nonsense="dom" />',
      "/** oxlint-disable-next-line no-debugger -- not a directive */",
      '/** @type {import("stylelint").Config} More API prose. */',
      "/** @returns {string} API narration. */",
      "/* @__PURE__ API narration. */",
    ];
    const files = cases.map((comment, index) => {
      const file = `test/comments/rejected-${index}.ts`;
      f.put(file, comment + declaration);
      return file;
    });
    const jsx = "test/comments/rejected-jsx.tsx";
    const jsxSource = "export const view = <div>{/* Explain this element. */}</div>;\n";
    f.put(jsx, jsxSource);
    files.push(jsx);
    const { status, output } = f.lint("oxlint", files, ["--deny-warnings", "--fix"]);
    assert.equal(status, 1, output);
    assert.equal((output.match(/piano\(comment-policy\)/g) ?? []).length, files.length, output);
    for (const file of files) assert.ok(output.includes(file), output);
    assert.match(output, /Remove narration, move necessary explanations to the owning docs/);
    for (const [index, comment] of cases.entries())
      assert.equal(f.read(files[index]!), comment + declaration);
    assert.equal(f.read(jsx), jsxSource);
  } finally {
    f.cleanup();
  }
});

test("Oxlint preserves workarounds, actual tooling/legal forms and comment-like data", () => {
  const f = fixture();
  try {
    const cases = [
      "// WORKAROUND(Safari): IME Enter lacks isComposing.",
      "/* WORKAROUND(Pi): private helper; remove when public API exists. */",
      "/* WORKAROUND(tool 1.2): missing API;\n   use compatibility path until upstream ships it. */",
      "// WORKAROUND(tool): missing API; https://example.com/issues/1",
      "// @ts-expect-error This fixture deliberately assigns a number to a string.",
      "// @ts-check",
      '/// <reference lib="dom" />',
      '/// <reference types="node" />',
      '// oxlint-disable-next-line typescript/triple-slash-reference -- exercise the legacy path directive\n/// <reference path="./types.d.ts" />',
      '/** @type {import("stylelint").Config} */',
      '/**\n * @type {import("stylelint").Config}\n */',
      "/* @__PURE__ */",
      "/* #__PURE__ */",
      "/* @__NO_SIDE_EFFECTS__ */",
      "/* #__NO_SIDE_EFFECTS__ */",
      "/* @vite-ignore */",
      "/* Copyright (c) 2026 Piano contributors.\nPermission is hereby granted to use this software. */",
      "/*! Copyright 2026 Piano contributors. All rights reserved. */",
      "// SPDX-License-Identifier: MIT",
      "/*! @license Apache-2.0 */",
      "#!/usr/bin/env node",
    ];
    const files = cases.map((comment, index) => {
      const file = `test/comments/allowed-${index}.ts`;
      f.put(file, comment + declaration);
      return file;
    });
    const sources = {
      "test/comments/data.ts":
        'export const data = ["// narration", "https://example.com", /\\/\\* text \\*\\//, `/* fixture narration */`];',
      "test/comments/interpolation.ts":
        "export const data = `text ${/* WORKAROUND(tool): missing API. */ 1} // narration`; ",
      "test/comments/allowed-jsx.tsx":
        'export const view = <div>{/* WORKAROUND(next-themes): SSR script warns. */}{"/* fixture */"}</div>;',
      "test/comments/suppression.ts":
        "// oxlint-disable-next-line no-debugger -- exercise the diagnostic suppression\ndebugger;\n",
      "test/comments/eslint.ts":
        "// eslint-disable-next-line no-debugger -- exercise the compatible suppression\ndebugger;\n",
      "web/src/suppression.tsx":
        'export const view = <div>\n{/* oxlint-disable-next-line jsx-a11y/media-has-caption -- arbitrary local audio has no captions. */}\n<audio src="file.mp3" />\n</div>;',
    };
    for (const [file, source] of Object.entries(sources)) {
      f.put(file, source);
      files.push(file);
    }
    const { status, output } = f.lint("oxlint", files, [
      "--deny-warnings",
      "--report-unused-disable-directives",
    ]);
    assert.equal(status, 0, output);
  } finally {
    f.cleanup();
  }
});

test("comment scope covers authored tooling and configs but leaves vendor boundary checks intact", () => {
  const f = fixture();
  try {
    const authored = [
      "server/check.ts",
      "shared/check.ts",
      "web/src/check.tsx",
      "web/vite.config.ts",
      "test/check.mjs",
      "scripts/check.mjs",
      "extensions/check.ts",
      ".husky/check.mjs",
      "check.config.mjs",
    ];
    for (const file of authored) f.put(file, "// API narration." + declaration);
    const rejected = f.lint("oxlint", authored);
    assert.equal(rejected.status, 1, rejected.output);
    assert.equal((rejected.output.match(/piano\(comment-policy\)/g) ?? []).length, authored.length);
    for (const file of authored) assert.ok(rejected.output.includes(file), rejected.output);

    const excluded = [
      "web/src/components/ui/check.tsx",
      "web/src/hooks/use-mobile.ts",
      ".agents/skills/vendor/check.mjs",
      "web/public/check.js",
      "web/dist/check.js",
    ];
    for (const file of excluded) f.put(file, "// Upstream narration." + declaration);
    const allowed = f.lint("oxlint", excluded);
    assert.equal(allowed.status, 0, allowed.output);
    for (const [file, specifier] of [
      ["web/src/components/ui/check.tsx", "../../../../server/check.ts"],
      ["web/src/hooks/use-mobile.ts", "../../../server/check.ts"],
    ]) {
      f.put(file!, `// Upstream narration.\nexport { value } from "${specifier}";`);
      const boundary = f.lint("oxlint", [file!]);
      assert.equal(boundary.status, 1, boundary.output);
      assert.match(boundary.output, /piano\(layer-imports\)/);
      assert.doesNotMatch(boundary.output, /piano\(comment-policy\)/);
    }
  } finally {
    f.cleanup();
  }
});

test("Stylelint applies the same policy to parsed CSS comments without changing CSS", () => {
  const f = fixture();
  try {
    const rejected = [
      "/* Explain this section. */",
      "/** API narration. */",
      "/* WORKAROUND(): missing tool */",
      "/* WORKAROUND(tool): */",
      "/* WORKAROUND(tool): ... */",
      "/* @anything prose */",
      "/*! Important narration. */",
      "/* stylelint-disable-next-line property-no-unknown */",
      "/* stylelint-disable-next-line property-no-unknown -- */",
      "/* stylelint-disable-made-up property-no-unknown -- reason */",
      "/* oxlint-disable-next-line no-debugger -- not CSS tooling */",
      "/* @__PURE__ */",
    ];
    const files = rejected.map((comment, index) => {
      const file = `web/src/rejected-${index}.css`;
      f.put(file, `${comment}\na { color: red; }\n`);
      return file;
    });
    const bad = f.lint("stylelint", files, ["--fix"]);
    assert.equal(bad.status, 2, bad.output);
    assert.equal(
      (bad.output.match(/piano\/comment-policy/g) ?? []).length,
      files.length,
      bad.output,
    );
    for (const [index, comment] of rejected.entries()) {
      assert.ok(bad.output.includes(files[index]!), bad.output);
      assert.equal(f.read(files[index]!), `${comment}\na { color: red; }\n`);
    }
    assert.match(bad.output, /Remove narration, move necessary explanations to the owning docs/);

    const allowed = {
      "web/src/allowed.css": [
        "/* WORKAROUND(shadcn 4.21): attachments need scrollbar-none; upstream supplies no-scrollbar. */",
        "/* WORKAROUND(Radix): inline display: table defeats truncation;\n   override it. */",
        "/*! Copyright (c) 2026 Piano contributors. All rights reserved. */",
        "/* SPDX-License-Identifier: MIT */",
        'a::after { content: "/* ordinary data */ // more"; background: url("https://example.com/a.png"); }',
        "/* stylelint-disable-next-line property-no-unknown -- exercise the suppression */",
        "a { invented-property: 0; }",
      ].join("\n"),
      "web/src/components/ui/upstream.css": "/* Upstream narration. */ a { color: red; }",
    };
    for (const [file, source] of Object.entries(allowed)) f.put(file, source);
    const good = f.lint("stylelint", Object.keys(allowed));
    assert.equal(good.status, 0, good.output);
    for (const [file, source] of Object.entries(allowed)) assert.equal(f.read(file), source);
  } finally {
    f.cleanup();
  }
});
