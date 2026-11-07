import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, test } from "node:test";
import { Effect, Exit, Layer } from "effect";
import { RegistryDatabasePath, RegistryLive } from "../server/Registry.ts";
import {
  TranscriptionFetch,
  TranscriptionUrl,
  VoiceInput,
  VoiceInputLive,
} from "../server/VoiceInput.ts";
import type { TranscriptionRequest, VoiceHints } from "../shared/voiceInput.ts";

const root = mkdtempSync(join(tmpdir(), "piano-voice-"));
after(() => rmSync(root, { recursive: true, force: true }));

const KEY = "sk-test-0123456789abcdef";
const URL = "https://openai.example/v1/audio/transcriptions";

type Sent = { url: string; authorization: string | null; form: FormData };
/** OpenAI's transcription endpoint: records each request and answers with `answer`. */
const openAi = (
  sent: Sent[],
  answer: () => Response = () => Response.json({ text: " Hello there. " }),
) =>
  (async (url, init) => {
    sent.push({
      url: String(url),
      authorization: new Headers(init?.headers).get("authorization"),
      form: init?.body as FormData,
    });
    return answer();
  }) as typeof fetch;

const run = <A, E>(
  db: string,
  work: Effect.Effect<A, E, VoiceInput>,
  fetch: typeof globalThis.fetch = openAi([]),
) =>
  Effect.runPromise(
    work.pipe(
      Effect.provide(VoiceInputLive.pipe(Layer.provide(RegistryLive))),
      Effect.provideService(RegistryDatabasePath, join(root, `${db}.db`)),
      Effect.provideService(TranscriptionFetch, fetch),
      Effect.provideService(TranscriptionUrl, URL),
    ),
  );

const failure = <A, E>(effect: Effect.Effect<A, E, VoiceInput>) =>
  Effect.flatMap(Effect.exit(effect), (exit) =>
    Exit.isFailure(exit)
      ? Effect.succeed(exit.cause)
      : Effect.die(new Error("expected a refusal, got success")),
  );
const detail = (cause: unknown) => {
  const text = JSON.stringify(cause);
  const found = /"detail":"([^"]*)"/.exec(text);
  return { detail: found?.[1] ?? "", field: /"field":"([^"]*)"/.exec(text)?.[1] };
};

const recording = (hints: VoiceHints = {}, mimeType = "audio/webm;codecs=opus") =>
  ({
    audio: Buffer.from("fake audio bytes").toString("base64"),
    mimeType,
    hints,
  }) satisfies TranscriptionRequest;

test("voice input starts off, needs a key to turn on, and keeps the key private across restarts", async () => {
  const voice = VoiceInput;
  assert.deepEqual(
    await run(
      "toggle",
      Effect.flatMap(voice, (v) => v.state),
    ),
    {
      enabled: false,
      hasKey: false,
    },
  );
  const refusal = detail(
    await run("toggle", failure(Effect.flatMap(voice, (v) => v.save({ enabled: true })))),
  );
  assert.equal(refusal.field, "key");
  assert.match(refusal.detail, /API key/);

  const saved = await run(
    "toggle",
    Effect.flatMap(voice, (v) => v.save({ enabled: true, key: `  ${KEY}  ` })),
  );
  assert.deepEqual(saved, { enabled: true, hasKey: true });
  assert.ok(!JSON.stringify(saved).includes(KEY));

  // A new backend on the same database reads what was saved.
  assert.deepEqual(
    await run(
      "toggle",
      Effect.flatMap(voice, (v) => v.state),
    ),
    {
      enabled: true,
      hasKey: true,
    },
  );
  // Off keeps the key, so on again needs none.
  assert.deepEqual(
    await run(
      "toggle",
      Effect.flatMap(voice, (v) => v.save({ enabled: false })),
    ),
    { enabled: false, hasKey: true },
  );
  assert.deepEqual(
    await run(
      "toggle",
      Effect.flatMap(voice, (v) => v.save({ enabled: true })),
    ),
    { enabled: true, hasKey: true },
  );
  // Removing the key turns voice input off.
  assert.deepEqual(
    await run(
      "toggle",
      Effect.flatMap(voice, (v) => v.save({ enabled: false, key: null })),
    ),
    { enabled: false, hasKey: false },
  );
  assert.equal(
    detail(
      await run(
        "toggle",
        failure(Effect.flatMap(voice, (v) => v.save({ enabled: true, key: null }))),
      ),
    ).field,
    "key",
  );
});

test("a key with spaces or a command prefix is refused at the key field", async () => {
  for (const key of ["sk-abc def", "!cat ~/.key", "   "]) {
    const refusal = detail(
      await run(
        "bad-key",
        failure(Effect.flatMap(VoiceInput, (v) => v.save({ enabled: true, key }))),
      ),
    );
    assert.equal(refusal.field, "key", key);
  }
  assert.deepEqual(
    await run(
      "bad-key",
      Effect.flatMap(VoiceInput, (v) => v.state),
    ),
    {
      enabled: false,
      hasKey: false,
    },
  );
});

test("transcription sends the recording and session hints to OpenAI with the saved key", async () => {
  const sent: Sent[] = [];
  await run(
    "send",
    Effect.flatMap(VoiceInput, (v) => v.save({ enabled: true, key: KEY })),
  );
  const result = await run(
    "send",
    Effect.flatMap(VoiceInput, (v) =>
      v.transcribe(
        recording({
          project: "Piano",
          folder: "piano",
          branch: "feat/voice-input",
          session: "Add voice input",
          recent: [
            "Please wire the composer.",
            "I changed `useDraftEditor` and the `VoiceInputLive` layer.",
          ],
          files: ["web/src/components/Composer.tsx"],
          commands: ["verify-piano"],
          draft: "Next, rename",
        }),
      ),
    ),
    openAi(sent),
  );
  assert.deepEqual(result, { text: "Hello there." });
  assert.equal(sent.length, 1);
  const [request] = sent;
  assert.equal(request!.url, URL);
  assert.equal(request!.authorization, `Bearer ${KEY}`);
  assert.equal(request!.form.get("model"), "gpt-transcribe");
  const file = request!.form.get("file") as File;
  assert.equal(file.name, "recording.webm");
  assert.equal(Buffer.from(await file.arrayBuffer()).toString(), "fake audio bytes");

  const prompt = String(request!.form.get("prompt"));
  for (const expected of [
    "Piano",
    "feat/voice-input",
    "Add voice input",
    "I changed `useDraftEditor`",
    "Next, rename",
  ])
    assert.ok(prompt.includes(expected), `prompt carries ${expected}`);
  assert.ok(
    prompt.indexOf("Please wire the composer.") < prompt.indexOf("I changed"),
    "recent messages stay in order",
  );
  const keywords = request!.form.getAll("keywords[]").map(String);
  for (const expected of [
    "useDraftEditor",
    "VoiceInputLive",
    "Composer.tsx",
    "/verify-piano",
    "feat/voice-input",
  ])
    assert.ok(keywords.includes(expected), `keywords include ${expected}`);
  for (const word of keywords) assert.ok(!/[<>\r\n]/.test(word), `keyword ${word} is one line`);
});

test("long hints are bounded and keep the newest message", async () => {
  const sent: Sent[] = [];
  await run(
    "bounded",
    Effect.flatMap(VoiceInput, (v) => v.save({ enabled: true, key: KEY })),
  );
  const old = `${"old words ".repeat(700)}`;
  const newest = `${"filler ".repeat(500)}the newest message ends with \`finalIdentifier\``;
  await run(
    "bounded",
    Effect.flatMap(VoiceInput, (v) =>
      v.transcribe(
        recording({
          recent: [old, newest],
          files: Array.from({ length: 200 }, (_, i) => `src/file${i}.ts`),
          draft: "d".repeat(7000),
        }),
      ),
    ),
    openAi(sent),
  );
  const prompt = String(sent[0]!.form.get("prompt"));
  assert.ok(prompt.length < 3000, `prompt is ${prompt.length} characters`);
  assert.ok(prompt.includes("finalIdentifier"));
  const keywords = sent[0]!.form.getAll("keywords[]").map(String);
  assert.ok(keywords.length <= 100);
  assert.equal(keywords[0], "finalIdentifier");
});

test("transcription is refused without calling OpenAI while voice input is off", async () => {
  const sent: Sent[] = [];
  const off = detail(
    await run(
      "off",
      failure(Effect.flatMap(VoiceInput, (v) => v.transcribe(recording()))),
      openAi(sent),
    ),
  );
  assert.match(off.detail, /Voice input is off/);
  await run(
    "off",
    Effect.flatMap(VoiceInput, (v) => v.save({ enabled: true, key: KEY })),
  );
  await run(
    "off",
    Effect.flatMap(VoiceInput, (v) => v.save({ enabled: false })),
  );
  await run(
    "off",
    failure(Effect.flatMap(VoiceInput, (v) => v.transcribe(recording()))),
    openAi(sent),
  );
  assert.equal(sent.length, 0);
  // The same request reaches OpenAI once voice input is on.
  await run(
    "off",
    Effect.flatMap(VoiceInput, (v) => v.save({ enabled: true })),
  );
  await run(
    "off",
    Effect.flatMap(VoiceInput, (v) => v.transcribe(recording())),
    openAi(sent),
  );
  assert.equal(sent.length, 1);
});

test("OpenAI's refusals become a sentence without its response body", async () => {
  await run(
    "refusals",
    Effect.flatMap(VoiceInput, (v) => v.save({ enabled: true, key: KEY })),
  );
  const echo = () =>
    Response.json({ error: { message: `Incorrect API key provided: ${KEY}` } }, { status: 401 });
  const rejected = detail(
    await run(
      "refusals",
      failure(Effect.flatMap(VoiceInput, (v) => v.transcribe(recording()))),
      openAi([], echo),
    ),
  );
  assert.match(rejected.detail, /rejected the API key/);
  assert.ok(!rejected.detail.includes(KEY));

  const unreachable = (async () => {
    throw new Error(`connect ECONNREFUSED with ${KEY}`);
  }) as typeof fetch;
  const offline = detail(
    await run(
      "refusals",
      failure(Effect.flatMap(VoiceInput, (v) => v.transcribe(recording()))),
      unreachable,
    ),
  );
  assert.match(offline.detail, /Could not reach OpenAI/);
  assert.ok(!offline.detail.includes(KEY));
});

test("a recording format OpenAI cannot read is refused before upload", async () => {
  const sent: Sent[] = [];
  await run(
    "format",
    Effect.flatMap(VoiceInput, (v) => v.save({ enabled: true, key: KEY })),
  );
  const refusal = detail(
    await run(
      "format",
      failure(Effect.flatMap(VoiceInput, (v) => v.transcribe(recording({}, "audio/aiff")))),
      openAi(sent),
    ),
  );
  assert.match(refusal.detail, /cannot read/);
  assert.equal(sent.length, 0);
  // Safari records mp4, which OpenAI reads.
  await run(
    "format",
    Effect.flatMap(VoiceInput, (v) => v.transcribe(recording({}, "audio/mp4"))),
    openAi(sent),
  );
  assert.equal((sent[0]!.form.get("file") as File).name, "recording.mp4");
});

test("a version-13 database upgrades with voice input off, then saves it", async () => {
  // Create a current database, then take it back to version 13, before preferences existed.
  await run(
    "upgrade",
    Effect.flatMap(VoiceInput, (v) => v.state),
  );
  const legacy = new DatabaseSync(join(root, "upgrade.db"));
  legacy.exec("DROP TABLE preferences; PRAGMA user_version = 13;");
  legacy.close();
  assert.deepEqual(
    await run(
      "upgrade",
      Effect.flatMap(VoiceInput, (v) => v.state),
    ),
    {
      enabled: false,
      hasKey: false,
    },
  );
  assert.deepEqual(
    await run(
      "upgrade",
      Effect.flatMap(VoiceInput, (v) => v.save({ enabled: true, key: KEY })),
    ),
    { enabled: true, hasKey: true },
  );
  const upgraded = new DatabaseSync(join(root, "upgrade.db"), { readOnly: true });
  try {
    assert.equal(upgraded.prepare("PRAGMA user_version").get()!.user_version, 14);
  } finally {
    upgraded.close();
  }
});
