import assert from "node:assert/strict";
import { test } from "node:test";
import type { DirListing } from "../shared/wire.ts";
import { createFolderBrowser } from "../web/src/lib/folderBrowser.ts";
import type { ObservationEnvironment } from "../web/src/lib/observation.ts";

/** Timers that never fire on their own and a focus nobody gives, so every read here is one the test caused. */
const environment: ObservationEnvironment = {
  setTimeout: () => undefined,
  clearTimeout: () => {},
  onFocus: () => () => {},
  hidden: () => false,
};

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

const HOME = "/home/ada";

/**
 * A disk of empty folders behind Piano's directory endpoints. The test answers each listing and
 * each mkdir when it chooses; answers ignore aborts, like a response already on the wire.
 */
function disk(folders: string[]) {
  const all = new Set([HOME, ...folders]);
  const listings: { path: string; answer: () => void }[] = [];
  const mkdirs: { path: string; answer: () => void; fail: (error: Error) => void }[] = [];
  const list = (path: string) =>
    new Promise<DirListing>((resolve) => {
      const dirPath = path === "~" ? HOME : path;
      listings.push({
        path,
        answer: () =>
          resolve({
            path: dirPath,
            parent: dirPath === "/" ? null : dirPath.slice(0, dirPath.lastIndexOf("/")) || "/",
            home: HOME,
            entries: [...all]
              .filter(
                (p) => p.startsWith(`${dirPath}/`) && !p.slice(dirPath.length + 1).includes("/"),
              )
              .sort()
              .map((p) => ({ name: p.slice(dirPath.length + 1), path: p })),
          }),
      });
    });
  const mkdir = (path: string) =>
    new Promise<string>((resolve, reject) => {
      mkdirs.push({
        path,
        answer: () => {
          all.add(path);
          resolve(path);
        },
        fail: reject,
      });
    });
  /** Answers every listing still waiting. */
  const answerListings = async () => {
    for (const l of listings.splice(0)) l.answer();
    await settle();
  };
  return { list, mkdir, listings, mkdirs, answerListings };
}

function setup(folders: string[] = [`${HOME}/code`, `${HOME}/code/piano`, `${HOME}/notes`]) {
  const fs = disk(folders);
  let remembered = "";
  const errors: string[] = [];
  const browser = createFolderBrowser({
    list: fs.list,
    mkdir: fs.mkdir,
    lastPicked: { get: () => remembered, set: (path) => (remembered = path) },
    notify: { error: (message) => errors.push(message) },
    environment,
  });
  browser.start();
  return { fs, browser, errors, remembered: () => remembered };
}

test("reopening starts at the last folder picked", async () => {
  const { fs, browser } = setup();
  browser.open();
  assert.equal(browser.getState().input, "~/");
  await fs.answerListings();
  browser.goTo(`${HOME}/code/piano`);
  await fs.answerListings();
  assert.equal(browser.pick(), `${HOME}/code/piano`);
  browser.close();

  browser.open();
  assert.equal(browser.getState().input, `${HOME}/code/piano/`);
  assert.deepEqual(
    fs.listings.map((l) => l.path),
    [`${HOME}/code/piano`],
  );
});

test("an initial path outranks the last folder picked", async () => {
  const { fs, browser } = setup();
  browser.open(`${HOME}/notes`);
  await fs.answerListings();
  assert.equal(browser.pick(), `${HOME}/notes`);
  browser.close();
  browser.open(`${HOME}/code`);
  assert.equal(browser.getState().input, `${HOME}/code/`);
});

test("picking while the listing loads picks nothing and remembers nothing", async () => {
  const { fs, browser, remembered } = setup();
  browser.open(`${HOME}/code`);
  assert.equal(browser.getState().loading, true);
  assert.equal(browser.pick(), undefined);
  assert.equal(remembered(), "");

  await fs.answerListings();
  browser.setInput(`${HOME}/code/pi`);
  // A single prefix match is the folder Enter picks.
  assert.equal(browser.pick(), `${HOME}/code/piano`);
});

test("a double submit creates the folder once, then browses into it", async () => {
  const { fs, browser } = setup();
  browser.open(`${HOME}/code`);
  await fs.answerListings();
  browser.startCreating();
  assert.equal(browser.getState().creating, true);

  const first = browser.createFolder("scratch");
  const second = browser.createFolder("scratch");
  assert.deepEqual(
    fs.mkdirs.map((m) => m.path),
    [`${HOME}/code/scratch`],
  );
  assert.equal(await second, "busy");

  fs.mkdirs[0]!.answer();
  assert.equal(await first, "created");
  const state = browser.getState();
  assert.equal(state.input, `${HOME}/code/scratch/`);
  assert.equal(state.creating, false);
  assert.deepEqual(
    fs.listings.map((l) => l.path),
    [`${HOME}/code/scratch`],
  );
});

test("closing while a folder is created does not navigate into it", async () => {
  const { fs, browser } = setup();
  browser.open(`${HOME}/code`);
  await fs.answerListings();
  browser.startCreating();
  const creation = browser.createFolder("scratch");
  browser.close();

  fs.mkdirs[0]!.answer();
  assert.equal(await creation, "superseded");
  assert.equal(browser.getState().input, `${HOME}/code/`);
  assert.deepEqual(fs.listings, []);
});

test("navigating away while a folder is created does not navigate into it", async () => {
  const { fs, browser } = setup();
  browser.open(`${HOME}/code`);
  await fs.answerListings();
  const creation = browser.createFolder("scratch");
  browser.goTo(`${HOME}/notes`);

  fs.mkdirs[0]!.answer();
  assert.equal(await creation, "superseded");
  assert.equal(browser.getState().input, `${HOME}/notes/`);
});

test("an invalid name is refused without a request", async () => {
  const { fs, browser, errors } = setup();
  browser.open(`${HOME}/code`);
  await fs.answerListings();
  assert.equal(await browser.createFolder("a/b"), "invalid");
  assert.equal(await browser.createFolder("   "), "invalid");
  assert.deepEqual(fs.mkdirs, []);
  assert.deepEqual(errors, ["Folder name cannot contain slashes"]);
});

test("a failed creation is reported and stays in the listed folder", async () => {
  const { fs, browser, errors } = setup();
  browser.open(`${HOME}/code`);
  await fs.answerListings();
  browser.startCreating();
  const creation = browser.createFolder("scratch");
  fs.mkdirs[0]!.fail(new Error("Permission denied"));
  assert.equal(await creation, "failed");
  assert.deepEqual(errors, ["Permission denied"]);
  assert.equal(browser.getState().input, `${HOME}/code/`);
  assert.equal(browser.getState().creating, true);
  assert.equal(browser.getState().ready, true);
});
