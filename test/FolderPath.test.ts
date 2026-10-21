import assert from "node:assert/strict";
import { test } from "node:test";
import {
  browseInput,
  childPath,
  listing,
  parsePathInput,
  pickTarget,
} from "../web/src/lib/folderPath.ts";

const entry = (name: string, parent = "/home/u") => ({ name, path: `${parent}/${name}` });

test("a trailing slash browses into a directory; other text filters its parent by prefix", () => {
  for (const [input, dirPath, prefix] of [
    ["/home/u/code/", "/home/u/code", ""],
    ["/home/u/co", "/home/u", "co"],
    ["/", "/", ""],
    ["/us", "/", "us"],
    ["~/", "~", ""],
    ["~/Doc", "~", "Doc"],
    ["", "~", ""],
    ["proj", "~", "proj"],
  ] as const) {
    assert.deepEqual(parsePathInput(input), { dirPath, prefix }, input);
  }
});

test("browsing to a path lists its contents, root included", () => {
  assert.equal(browseInput("/home/u/code"), "/home/u/code/");
  assert.equal(browseInput("/home/u/code/"), "/home/u/code/");
  assert.equal(browseInput("/"), "/");
  assert.deepEqual(parsePathInput(browseInput("/home/u/code")), {
    dirPath: "/home/u/code",
    prefix: "",
  });
});

test("the prefix filter ignores case and caps visible rows", () => {
  const entries = [entry("Code"), entry("code-old"), entry("docs"), entry("xcode")];
  assert.deepEqual(
    listing(entries, "CO").matches.map((e) => e.name),
    ["Code", "code-old"],
  );
  assert.equal(listing(entries, "").matches.length, 4);

  const many = Array.from({ length: 507 }, (_, i) => entry(`d${i}`));
  const { matches, visible, hidden } = listing(many, "");
  assert.equal(matches.length, 507);
  assert.deepEqual(
    visible.map((e) => e.name),
    many.slice(0, 500).map((e) => e.name),
  );
  assert.equal(hidden, 7);
});

test("Enter picks the single prefix match, else the listed directory", () => {
  const one = [entry("piano")];
  const two = [entry("piano"), entry("pi-mono")];
  assert.equal(pickTarget("/home/u", one, "pia"), "/home/u/piano");
  assert.equal(pickTarget("/home/u", two, "pi"), "/home/u");
  assert.equal(pickTarget("/home/u", [], "zz"), "/home/u");
  // Browsing a directory with one subfolder picks the directory, not the subfolder.
  assert.equal(pickTarget("/home/u", one, ""), "/home/u");
});

test("a new folder joins its parent once, including at the filesystem root", () => {
  assert.deepEqual(childPath("/home/u", " new "), { path: "/home/u/new" });
  assert.deepEqual(childPath("/", "tmp2"), { path: "/tmp2" });
  assert.ok("error" in childPath("/home/u", "a/b"));
  assert.ok("error" in childPath("/home/u", "a\\b"));
  assert.ok("error" in childPath("/home/u", "   "));
});
