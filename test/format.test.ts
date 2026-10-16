import assert from "node:assert/strict";
import { test } from "node:test";
import { abbrevPath, formatTokenCount, toolArgsText } from "../web/src/lib/format.ts";

test("token counts use compact units without misleading thousand-unit boundaries", () => {
  for (const [tokens, label] of [
    [0, "0"],
    [999, "999"],
    [1_000, "1k"],
    [2_400, "2k"],
    [42_000, "42k"],
    [999_499, "999k"],
    [999_500, "1.0M"],
    [3_400_000, "3.4M"],
    [999_500_000, "1.0B"],
  ] as const) {
    assert.equal(formatTokenCount(tokens), label);
  }
});

test("paths abbreviate like hydro: home as ~, parents as initials, the basename whole", () => {
  for (const [path, label] of [
    ["/Users/james/scratch/piano", "~/s/piano"],
    ["/home/exedev/piano", "~/piano"],
    ["/home/exedev", "~"],
    ["/Users/james/.config/wt/piano-feature", "~/.c/w/piano-feature"],
    ["/srv/apps/piano", "/s/a/piano"],
    ["/", "/"],
    [undefined, ""],
  ] as const) {
    assert.equal(abbrevPath(path), label);
  }
});

test("tool arguments show one per line, multi-line values with real line breaks", () => {
  const script = "python3 - <<'PY'\nimport json\nprint(json.dumps(1))\nPY";
  assert.equal(
    toolArgsText(JSON.stringify({ command: script, timeout: 600 })),
    `command:\n${script}\ntimeout: 600`,
  );
  assert.equal(toolArgsText('{"command":"sleep 30"}'), "command: sleep 30");
  assert.equal(toolArgsText("{}"), "", "an empty object shows nothing");
  assert.equal(toolArgsText('{"command":"pyth'), '{"command":"pyth', "streaming JSON shows as is");
  assert.equal(toolArgsText(undefined), "");
});
