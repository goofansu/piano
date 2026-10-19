import assert from "node:assert/strict";
import fs, {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { NodeServices } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { PiSessions, PiSessionsLive } from "../server/PiSessions.ts";

// Fixture history only: Pi reads PI_CODING_AGENT_SESSION_DIR and filters it by each file's cwd.
const root = realpathSync(mkdtempSync(join(tmpdir(), "piano-history-")));
const cwd = join(root, "checkout"),
  alias = join(root, "alias"),
  sessions = join(root, "sessions");
mkdirSync(cwd);
symlinkSync(cwd, alias);
mkdirSync(sessions);
process.env.PI_CODING_AGENT_DIR = join(root, "agent");
process.env.PI_CODING_AGENT_SESSION_DIR = sessions;
after(() => rmSync(root, { recursive: true, force: true }));

const seed = (path: string, id: string, text: string, dir = sessions) => {
  const file = join(dir, `${text.replaceAll(" ", "-")}.jsonl`);
  writeFileSync(
    file,
    [
      { type: "session", version: 3, id, cwd: path, timestamp: "2026-10-05T00:00:00Z" },
      {
        type: "message",
        id: "saved",
        parentId: null,
        timestamp: "2026-10-05T00:00:01Z",
        message: { role: "user", content: text, timestamp: 1 },
      },
    ]
      .map((x) => JSON.stringify(x))
      .join("\n") + "\n",
  );
  return file;
};
const run = Effect.runPromise;
// Saved sessions are read through PiSessions without starting Pi.
const history = await run(
  Effect.gen(function* () {
    return (yield* PiSessions).history;
  }).pipe(Effect.provide(PiSessionsLive.pipe(Layer.provide(NodeServices.layer)))),
);

test("INV-01: history recorded under another checkout spelling is found where Pi wrote it", async () => {
  const file = seed(alias, "legacy", "alias history"),
    before = readFileSync(file, "utf8");
  assert.deepEqual(
    await run(history.locate("legacy", [cwd])),
    { _tag: "missing" },
    "an unnamed spelling is never guessed",
  );
  assert.deepEqual(await run(history.locate("legacy", [cwd, alias])), {
    _tag: "file",
    path: file,
  });
  assert.ok((await run(history.sessionIds(alias))).has("legacy"));
  assert.equal((await run(history.sessionIds(cwd))).has("legacy"), false);
  const snapshot = await run(history.peek("legacy", file));
  assert.equal(snapshot.state.sessionFile, file);
  assert.deepEqual(
    snapshot.messages.map((m) => m.text),
    ["alias history"],
  );
  assert.equal(readFileSync(file, "utf8"), before, "reading never moves or rewrites history");
});

test("INV-01/12: peeking legacy v2 history reads the conversation without migrating its file", async () => {
  const file = seed(cwd, "v2", "legacy conversation");
  const original = readFileSync(file, "utf8").replace('"version":3', '"version":2');
  writeFileSync(file, original);
  const snapshot = await run(history.peek("v2", file));
  assert.deepEqual(
    snapshot.messages.map((m) => m.text),
    ["legacy conversation"],
  );
  assert.equal(snapshot.state.sessionFile, file);
  assert.equal(readFileSync(file, "utf8"), original, "inspection must not persist Pi's migration");
});

for (const [name, contents] of [
  ["empty", ""],
  ["malformed", '{"type":"session"'],
]) {
  test(`INV-01/12: inspecting ${name} history neither repairs it nor invents a conversation`, async () => {
    const file = join(sessions, `${name}.jsonl`);
    writeFileSync(file, contents);
    const snapshot = await run(history.peek(name, file));
    assert.equal(readFileSync(file, "utf8"), contents);
    assert.deepEqual(snapshot.messages, []);
    assert.equal(snapshot.state.sessionId, name);
    assert.match(snapshot.state.projectionError ?? "", /History was not replaced or repaired/);
    await assert.rejects(run(history.exportBranch(name, file)), {
      reason: "rejected",
      detail: "This session has no readable saved conversation to share.",
    });
    assert.equal(readFileSync(file, "utf8"), contents);
  });
}

test("INV-01: distinct files claiming one session are a conflict, never a choice", async () => {
  const first = seed(alias, "claimed", "first claim"),
    second = seed(cwd, "claimed", "second claim");
  const found = await run(history.locate("claimed", [alias, cwd]));
  assert.equal(found._tag, "conflict");
  if (found._tag === "conflict") assert.deepEqual([...found.paths].sort(), [first, second].sort());
  assert.deepEqual(await run(history.locate("claimed", [alias])), { _tag: "file", path: first });
});

test("INV-01: conflicts in one directory are found again after history changes", async () => {
  const first = seed(cwd, "duplicate", "original duplicate");
  assert.deepEqual(await run(history.locate("duplicate", [cwd])), { _tag: "file", path: first });
  const second = seed(cwd, "duplicate", "new duplicate");
  const found = await run(history.locate("duplicate", [cwd]));
  assert.equal(found._tag, "conflict");
  if (found._tag === "conflict") assert.deepEqual([...found.paths].sort(), [first, second].sort());
  rmSync(first);
  assert.deepEqual(await run(history.locate("duplicate", [cwd])), { _tag: "file", path: second });
  rmSync(second);
  assert.deepEqual(await run(history.locate("duplicate", [cwd])), { _tag: "missing" });
});

test("INV-01: history discovery reads headers, not neighboring transcript bodies", async (t) => {
  const store = mkdtempSync(join(root, "large-history-"));
  const target = seed(cwd, "small", "small destination", store);
  for (const id of ["large-a", "large-b"]) {
    const file = seed(cwd, id, id, store);
    appendFileSync(
      file,
      `${JSON.stringify({ type: "message", message: { role: "user", content: "x".repeat(1024 * 1024) } })}\n`,
    );
  }
  // Observe actual filesystem I/O, preserving real reads and parsing. The budget is deliberately
  // much larger than the headers, but smaller than one transcript: no wall-clock threshold.
  const read = fs.read;
  let bytes = 0;
  t.mock.method(fs, "read", (...args: unknown[]) => {
    const callback = args.pop() as (...result: unknown[]) => void;
    return Reflect.apply(read, fs, [
      ...args,
      (...result: unknown[]) => {
        bytes += Number(result[1] ?? 0);
        callback(...result);
      },
    ]);
  });
  const previous = process.env.PI_CODING_AGENT_SESSION_DIR;
  process.env.PI_CODING_AGENT_SESSION_DIR = store;
  try {
    assert.deepEqual(await run(history.locate("small", [cwd])), { _tag: "file", path: target });
    assert.ok(bytes > 0 && bytes < 128 * 1024, `locating one session read ${bytes} bytes`);
    bytes = 0;
    assert.deepEqual(await run(history.sessionIds(cwd)), new Set(["small", "large-a", "large-b"]));
    assert.ok(bytes > 0 && bytes < 128 * 1024, `listing session IDs read ${bytes} bytes`);
  } finally {
    process.env.PI_CODING_AGENT_SESSION_DIR = previous;
  }
});

test("INV-01: one physical file listed twice is still one file", async () => {
  const file = seed(cwd, "linked", "linked history");
  symlinkSync(file, join(sessions, "linked-copy.jsonl"));
  const found = await run(history.locate("linked", [cwd, alias]));
  assert.equal(found._tag, "file");
});

test("INV-01: a session without history is missing and peeks as empty", async () => {
  const empty = join(root, "empty");
  mkdirSync(empty);
  assert.deepEqual(await run(history.locate("never-written", [empty, cwd])), { _tag: "missing" });
  assert.equal((await run(history.sessionIds(empty))).size, 0);
  assert.deepEqual(await run(history.peek("never-written", undefined)), {
    state: { sessionId: "never-written", isStreaming: false },
    messages: [],
    dialogs: [],
  });
});

test("INV-01: peeking uses Pi context edits, compaction and active branch without replacing virtual selection", async () => {
  const dir = mkdtempSync(join(root, "projection-"));
  const secret = "sk-file-canary-123456789";
  try {
    const manager = SessionManager.create(dir, dir);
    manager.appendModelChange("router", "auto");
    manager.appendThinkingLevelChange("low");
    const first = manager.appendMessage({ role: "user", content: "old prompt", timestamp: 1 });
    const reply = manager.appendMessage({
      role: "assistant",
      api: "openai-completions",
      provider: "physical",
      model: "answer",
      content: [{ type: "text", text: `original ${secret}` }],
      usage: {
        input: 1,
        output: 2,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 3,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: 2,
    });
    manager.appendMessage({ role: "user", content: "abandoned branch", timestamp: 3 });
    manager.branch(reply);
    manager.appendContextEdit(reply, { content: `edited ${secret}` });
    manager.appendCompaction("summary", reply, 30);
    const file = manager.getSessionFile()!;
    const original = readFileSync(file, "utf8");
    const snap = await run(history.peek(manager.getSessionId(), file));
    assert.equal(snap.state.model, "router/auto");
    assert.equal(snap.state.thinkingLevel, "low");
    assert.deepEqual(
      snap.messages.map((m) => m.text),
      ["summary", "edited [REDACTED]"],
    );
    assert.equal(snap.messages[1].model, "physical/answer");
    assert.equal(
      snap.messages.some((m) => m.id === first),
      false,
    );
    assert.equal(
      snap.state.cost,
      undefined,
      "a file peek must not invent full-session accounting from context",
    );
    assert.equal(readFileSync(file, "utf8"), original, "redaction never rewrites Pi history");
    assert.ok(original.includes(secret));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("INV-01: a saved session names the session that dispatched it, from its own history", async () => {
  const file = join(sessions, "dispatched.jsonl");
  writeFileSync(
    file,
    [
      { type: "session", version: 3, id: "dispatched", cwd, timestamp: "2026-10-05T00:00:00Z" },
      {
        type: "custom",
        id: "origin",
        parentId: null,
        timestamp: "2026-10-05T00:00:01Z",
        customType: "piano.dispatch",
        data: { parentSessionId: "the-parent" },
      },
      {
        type: "message",
        id: "brief",
        parentId: "origin",
        timestamp: "2026-10-05T00:00:02Z",
        message: { role: "user", content: "Review the diff", timestamp: 2 },
      },
    ]
      .map((x) => JSON.stringify(x))
      .join("\n") + "\n",
  );
  const dispatched = await run(history.peek("dispatched", file));
  assert.equal(dispatched.state.dispatchedFrom, "the-parent");
  assert.deepEqual(
    dispatched.messages.map((m) => m.text),
    ["Review the diff"],
    "the record is not a transcript message",
  );
  const own = await run(history.peek("own", seed(cwd, "own", "own history")));
  assert.equal(own.state.dispatchedFrom, undefined);
});

test("INV-01/12: header discovery accepts Pi's legacy and partial-file conventions without writing", async () => {
  const folder = join(root, "headers");
  const header = { type: "session", version: 2, id: "header", cwd: folder };
  const wide = { ...header, id: "wide", metadata: "界".repeat(3000) };
  const cases = [
    ["header", `\nnot-json\r\n${JSON.stringify(header)}\r\n{unfinished`],
    ["wide", JSON.stringify(wide)],
    [
      "not-first",
      `${JSON.stringify({ type: "message" })}\n${JSON.stringify({ ...header, id: "not-first" })}`,
    ],
    [
      "large-header",
      JSON.stringify({ ...header, id: "large-header", metadata: "x".repeat(1024 * 1024) }),
    ],
    ["bom", `\uFEFF${JSON.stringify({ ...header, id: "bom" })}`],
  ];
  const files = cases.map(([id, text]) => {
    const path = join(sessions, `${id}.jsonl`);
    writeFileSync(path, text);
    return path;
  });
  const readable = new Set(["header", "wide", "large-header"]);
  assert.deepEqual(await run(history.sessionIds(folder)), readable);
  for (const [index, [id, contents]] of cases.entries()) {
    assert.deepEqual(
      await run(history.locate(id, [folder])),
      readable.has(id) ? { _tag: "file", path: files[index] } : { _tag: "missing" },
    );
    assert.equal(readFileSync(files[index], "utf8"), contents);
  }
  for (const file of files) rmSync(file);
});

test("INV-01/12: default stores follow Pi's encoding and accept old headers without cwd", async () => {
  const folder = join(root, "default:界");
  const previous = process.env.PI_CODING_AGENT_SESSION_DIR;
  delete process.env.PI_CODING_AGENT_SESSION_DIR;
  try {
    // Use Pi to choose the default path, so this guards Piano's adapter against SDK rule changes.
    const store = SessionManager.create(folder).getSessionDir();
    const file = seed(folder, "old-default", "default history", store);
    const contents = readFileSync(file, "utf8").replace(`,"cwd":${JSON.stringify(folder)}`, "");
    writeFileSync(file, contents);
    assert.deepEqual(await run(history.locate("old-default", [folder])), {
      _tag: "file",
      path: file,
    });
    // An explicit setting naming the default store has the same non-filtering semantics in Pi.
    process.env.PI_CODING_AGENT_SESSION_DIR = store;
    assert.deepEqual(await run(history.sessionIds(folder)), new Set(["old-default"]));
    assert.equal(readFileSync(file, "utf8"), contents);
    delete process.env.PI_CODING_AGENT_SESSION_DIR;
    rmSync(store, { recursive: true, force: true });
    assert.deepEqual(await run(history.locate("old-default", [folder])), { _tag: "missing" });
    assert.equal(existsSync(store), false, "inspection must not create an empty Pi store");
  } finally {
    process.env.PI_CODING_AGENT_SESSION_DIR = previous;
  }
});

test("INV-01: a relative sessionDir setting is read from the folder, as the Pi child reads it", async () => {
  const folder = join(root, "relative");
  const store = join(folder, ".pi", "sessions");
  mkdirSync(store, { recursive: true });
  writeFileSync(
    join(folder, ".pi", "settings.json"),
    JSON.stringify({ sessionDir: ".pi/sessions" }),
  );
  const file = seed(folder, "relative", "relative history", store);
  // Only the setting names the store here; Pi would otherwise prefer the environment.
  const previous = process.env.PI_CODING_AGENT_SESSION_DIR;
  delete process.env.PI_CODING_AGENT_SESSION_DIR;
  try {
    assert.ok((await run(history.sessionIds(folder))).has("relative"));
    assert.deepEqual(await run(history.locate("relative", [folder])), { _tag: "file", path: file });
  } finally {
    process.env.PI_CODING_AGENT_SESSION_DIR = previous;
  }
});
