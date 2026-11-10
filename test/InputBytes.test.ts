import assert from "node:assert/strict";
import { test } from "node:test";
import { inputBytes } from "../server/InputBytes.ts";

// JSON.stringify is the admission contract, not a second implementation of its rules.
test("input bytes match JSON for image envelopes, omissions, arrays and escaped UTF-8", () => {
  const sparse: unknown[] = [];
  sparse.length = 2;
  const values: unknown[] = [
    null,
    true,
    1,
    -0,
    NaN,
    Infinity,
    "",
    "😀\ud800\udc00\ud800\udc00\ud800",
    { _tag: "prompt", text: '€\n\t"\\', attachments: undefined },
    {
      _tag: "act",
      preparedImages: undefined,
      action: {
        _tag: "prompt",
        attachments: [
          { kind: "image", data: "abcd+/==".repeat(1024 * 1024), name: "雪.png" },
          { kind: "image", data: "abcd", mimeType: "image/png" },
        ],
      },
    },
    { data: "", omitted: undefined, fn() {}, symbol: Symbol("omitted") },
    [undefined, () => {}, Symbol("null"), { data: "abcd" }],
    sparse,
    { data: { data: "abcd" }, extra: [{ data: "ABCD" }, { data: "ABCD" }] },
    { data: new String("abcd") },
    { toJSON: () => ({ data: "abcd", date: new Date(0) }) },
    { data: { toJSON: () => "abcd" } },
    {
      get data() {
        return "abcd";
      },
    },
  ];
  // Every ASCII code (especially escapes and a final newline), multibyte characters and
  // isolated surrogates: invalid direct actions must not receive an underestimated lease.
  for (let code = 0; code < 128; code++) values.push({ data: `abcd${String.fromCharCode(code)}` });
  for (const data of ["é", "€", "😀", "\ud800", "\udc00", "abc\n", 'a"b', "\\"])
    values.push({ data, text: data, [data]: { data: "abcd" } });
  for (const value of values)
    assert.equal(inputBytes(value), Buffer.byteLength(JSON.stringify(value)));
});

test("input byte counting preserves JSON failures rather than admitting an approximation", () => {
  const cyclic: { data: string; self?: unknown } = { data: "abcd" };
  cyclic.self = cyclic;
  for (const value of [undefined, () => {}, Symbol("root"), 1n, { data: 1n }, cyclic]) {
    assert.throws(() => inputBytes(value), TypeError);
  }
  const error = new Error("toJSON failed");
  assert.throws(
    () =>
      inputBytes({
        data: {
          toJSON() {
            throw error;
          },
        },
      }),
    (e) => e === error,
  );
});
