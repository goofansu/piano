import assert from "node:assert/strict";
import { test } from "node:test";
import { Layer } from "effect";
import { TranscriptionFetch } from "../server/VoiceInput.ts";
import { MAX_VOICE_REQUEST_BYTES } from "../shared/voiceInput.ts";
import { gatewayFixture } from "./fixtures/peer-gateway.ts";
import { startRouter } from "./fixtures/router.ts";

// Real Node HTTP ingestion, not just schema validation or a preallocated in-memory Request.
test(
  "main voice ingestion bounds actual chunked bytes before parsing; peers never proxy voice",
  { timeout: 45_000 },
  async (t) => {
    const { base, state } = await gatewayFixture(t);
    const path = "/api/voice/transcribe";
    const json = JSON.stringify({ audio: "YQ==", mimeType: "audio/webm", hints: {} });
    const post = (bytes: number, extra: Record<string, string> = {}) => {
      let remaining = bytes - json.length;
      return fetch(`${base}${path}`, {
        method: "POST",
        headers: { origin: base, "content-type": "application/json", ...extra },
        body: new ReadableStream({
          pull(controller) {
            if (remaining > 0) {
              const count = Math.min(remaining, 64 * 1024);
              remaining -= count;
              controller.enqueue(Buffer.alloc(count, " "));
            } else {
              controller.enqueue(Buffer.from(json));
              controller.close();
            }
          },
        }),
        duplex: "half",
      } as RequestInit);
    };
    const exact = await post(MAX_VOICE_REQUEST_BYTES);
    assert.equal(exact.status, 502);
    assert.match(
      await exact.text(),
      /Voice input is off/,
      "exact boundary reaches voice admission",
    );
    const over = await post(MAX_VOICE_REQUEST_BYTES + 1);
    assert.equal(over.status, 413);
    assert.match(await over.text(), /too long/);
    const compressed = await post(json.length, { "content-encoding": "gzip" });
    assert.equal(compressed.status, 415);
    await compressed.body?.cancel();
    const crossSite = await post(json.length, { origin: "https://other.invalid" });
    assert.equal(crossSite.status, 403);
    await crossSite.body?.cancel();
    const before = state.requests.length;
    for (const [method, endpoint] of [
      ["GET", "/api/settings/voice-input"],
      ["POST", path],
    ]) {
      const answer = await fetch(`${base}/peer/eng-1${endpoint}`, {
        method,
        headers: { origin: base, "content-type": "application/json" },
        ...(method === "POST" ? { body: json } : {}),
      });
      assert.equal(answer.status, 404);
      await answer.body?.cancel();
    }
    assert.equal(state.requests.length, before, "no voice request reaches the peer");
  },
);

test(
  "main HTTP admission rejects a third upload before parsing, and disconnect aborts provider work",
  { timeout: 15_000 },
  async () => {
    let called = 0,
      aborted = 0;
    let both!: () => void;
    const ready = new Promise<void>((resolve) => {
      both = resolve;
    });
    const provider = (async (_url, init) => {
      called++;
      if (called > 2) return Response.json({ text: "review me" });
      if (called === 2) both();
      return new Promise<Response>((_resolve, reject) =>
        init!.signal!.addEventListener(
          "abort",
          () => {
            aborted++;
            reject(new DOMException("cancelled", "AbortError"));
          },
          { once: true },
        ),
      );
    }) as typeof fetch;
    const router = await startRouter(
      "piano-voice-http-",
      Layer.succeed(TranscriptionFetch, provider),
    );
    const controllers = [new AbortController(), new AbortController()];
    const json = JSON.stringify({ audio: "YQ==", mimeType: "audio/webm", hints: {} });
    const post = (body = json, signal?: AbortSignal, headers?: Record<string, string>) =>
      router.handle("/api/voice/transcribe", { method: "POST", body, signal, headers });
    try {
      const saved = await router.handle("/api/settings/voice-input", {
        method: "PUT",
        body: JSON.stringify({ enabled: true, key: "sk-test-no-real-provider" }),
      });
      assert.equal(saved.status, 200);
      const held = controllers.map((controller) => post(json, controller.signal));
      await ready;
      const refused = await post("invalid", undefined, {
        "content-length": String(MAX_VOICE_REQUEST_BYTES + 1),
      });
      assert.equal(refused.status, 429, "busy refusal precedes body allocation and validation");
      const alias = await router.handle("/api//voice/transcribe/", {
        method: "POST",
        body: "invalid",
        headers: { "content-length": String(MAX_VOICE_REQUEST_BYTES + 1) },
      });
      assert.equal(alias.status, 429, "router-normalized aliases share ingestion capacity");
      assert.equal(called, 2);
      controllers.forEach((controller) => controller.abort());
      await Promise.allSettled(held);
      assert.equal(aborted, 2, "HTTP cancellation reaches both provider requests");
      const next = await post();
      assert.equal(next.status, 200);
      assert.deepEqual(await next.json(), { text: "review me" });
      assert.equal(called, 3, "released capacity, no mutation retries");
    } finally {
      controllers.forEach((controller) => controller.abort());
      await router.dispose();
    }
  },
);
