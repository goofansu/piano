// Extension of the remote critical path, not a separate journey. Browser device APIs and the
// transcription response are controlled boundaries; no microphone, real key or paid call.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

export async function voiceInputs(page, call, onEvent, switchMachine) {
  const requests = [];
  const pending = [];
  onEvent(({ method, params }) => {
    if (method !== "Fetch.requestPaused" || !params.request.url.endsWith("/api/voice/transcribe"))
      return;
    assert.equal(new URL(params.request.url).pathname, "/api/voice/transcribe");
    requests.push({ url: params.request.url, ...JSON.parse(params.request.postData) });
    pending.push(params.requestId);
  });
  await call("Fetch.enable", {
    patterns: [{ urlPattern: "*/api/voice/transcribe", requestStage: "Request" }],
  });
  await page.evaluate(`(() => {
    window.voiceFixture = { mode: 'normal', tracks: [], grants: [] };
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async () => {
      const f = window.voiceFixture;
      if (f.mode === 'denied') throw new DOMException('fixture', 'NotAllowedError');
      const track = new EventTarget(); track.live = true; track.stop = () => { track.live = false; };
      f.tracks.push(track);
      const stream = { getTracks: () => [track] };
      if (f.mode === 'pending') return new Promise(resolve => f.grants.push(() => resolve(stream)));
      return stream;
    }});
    window.MediaRecorder = class {
      static isTypeSupported(type) { return type === 'audio/webm;codecs=opus'; }
      constructor(stream, options) { this.state = 'inactive'; this.mimeType = options.mimeType; window.voiceFixture.recorder = this; }
      start() { this.state = 'recording'; }
      stop() { this.state = 'inactive'; setTimeout(() => {
        // Larger than the peer conversation gateway's 1 MiB cap, still main-origin HTTP only.
        this.ondataavailable?.({ data: new Blob([new Uint8Array(1100000)], { type: this.mimeType }) });
        this.onstop?.();
      }, 0); }
    };
  })()`);
  const field = '[aria-label="Message"], [aria-label="First message"]';
  const value = () => page.evaluate(`document.querySelector('${field}')?.value`);
  const clear = async () => {
    await page.ab("click", field);
    await page.press("Mod+A");
    await page.press("Backspace");
    await page.until(`document.querySelector('${field}')?.value === ''`);
  };
  const ready = () =>
    page.until(`document.querySelector('[aria-label="Voice input"]')?.disabled === false`);
  const begin = async () => {
    await ready();
    await page.click("button", "Voice input");
    await page.until(`!!document.querySelector('[aria-label="Stop recording"]')`);
  };
  const stop = async () => {
    await page.click("button", "Stop recording");
    await page.until(`!!document.querySelector('[aria-label="Cancel transcription"]')`);
  };
  const requested = async () => {
    // A busy control precedes FileReader and HTTP; wait for the actual paused request.
    for (let n = 0; !pending.length; n++) {
      assert.ok(n < 100, "transcription request reaches main-origin HTTP");
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  };
  const answer = async (text, status = 200) => {
    await requested();
    await call("Fetch.fulfillRequest", {
      requestId: pending.shift(),
      responseCode: status,
      responseHeaders: [{ name: "content-type", value: "application/json" }],
      body: Buffer.from(JSON.stringify(status === 200 ? { text } : { error: text })).toString(
        "base64",
      ),
    }).catch((error) => {
      if (status !== 499) throw error;
    });
  };
  try {
    // Off remotely is a discoverable main-Preferences action, not remote settings mutation.
    await switchMachine("eng-1");
    await ready();
    await page.click("button", "Voice input");
    await page.see("Voice input uses Local’s OpenAI key for every machine.");
    await page.capture("voice-1-main-setup");
    // The action itself deliberately leaves the peer and goes to Local.
    await switchMachine(null);
    await page.click("button", "Open Local Preferences");
    await page.until(`location.pathname === '/settings/preferences'`);
    await page.until(`!document.querySelector('[data-sonner-toast]')`);
    await page.click("switch", "Voice input");
    await page.see(
      "Voice input for every machine sends recordings and session context through this Piano to OpenAI.",
    );
    await page.ab("fill", 'input[type="password"]', "sk-fixture-no-provider-call");
    await page.click("button", "Save");
    await page.see("Voice input turned on");
    await page.click("button", "Home");
    await page.click("button", "Local collision session");
    await page.see("Local collision session saved history");
    await page.ab("fill", field, "Fix old bug");
    await begin();
    await page.capture("voice-2-local-recording");
    await stop();
    await page.evaluate(`document.querySelector('${field}').setSelectionRange(4, 7)`);
    await answer("the");
    await page.until(`document.querySelector('${field}')?.value === 'Fix the bug'`);
    await page.capture("voice-3-local-inserted");
    assert.deepEqual(page.prompts(), [], "dictation never sends itself");
    await page.ab("fill", field, "LOCAL-DRAFT");

    // Local and two peers use colliding session/cwd/workspace IDs. Stop then switch keeps source.
    await switchMachine("eng-1");
    await page.see("Remote collision session");
    await page.click("button", "Remote collision session");
    await page.see("Remote collision session saved history");
    await page.ab("fill", field, "REMOTE");
    await begin();
    await stop();
    await switchMachine("eng-2");
    await page.see("Second collision session");
    await page.click("button", "Second collision session");
    await page.see("Second collision session saved history");
    await page.ab("fill", field, "SECOND");
    await answer("spoken");
    assert.equal(await value(), "SECOND");
    await clear();
    await switchMachine("eng-1");
    await page.until(`document.querySelector('${field}')?.value === 'REMOTE spoken'`);
    await page.capture("voice-4-peer-source-draft");
    assert.equal(requests.at(-1).hints.session, "Remote collision session");
    assert.deepEqual(page.remote.prompts(), [], "review is required before remote Send");

    // Recording navigation and permission granted late discard audio and release every track.
    const before = requests.length;
    await begin();
    await switchMachine("eng-2");
    assert.equal(await page.evaluate(`window.voiceFixture.tracks.some(t => t.live)`), false);
    await page.evaluate(`window.voiceFixture.mode = 'pending'`);
    await page.click("button", "Voice input");
    await page.until(`!!document.querySelector('[aria-label="Cancel recording"]')`);
    await switchMachine("eng-1");
    await page.evaluate(
      `window.voiceFixture.grants.forEach(grant => grant()); window.voiceFixture.mode = 'normal';`,
    );
    await page.until(`window.voiceFixture.tracks.every(t => !t.live)`);
    assert.equal(requests.length, before);

    // Explicit transcription cancellation suppresses a late successful response.
    await begin();
    await stop();
    await requested();
    await page.click("button", "Cancel transcription");
    await answer("cancelled", 499);
    assert.equal(await value(), "REMOTE spoken");
    await page.evaluate(`window.voiceFixture.mode = 'denied'`);
    await page.click("button", "Voice input");
    await page.see("Allow microphone access to use voice input.");
    await page.evaluate(`window.voiceFixture.mode = 'normal'`);
    await begin();
    await stop();
    await answer("Stub provider unavailable", 502);
    await page.see("Stub provider unavailable");
    assert.equal(await value(), "REMOTE spoken");
    await page.capture("voice-5-peer-error-preserves-draft");
    await clear();

    // New-session keys also collide. A remote transcript survives a switch to Local's New page.
    await page.click("button", "New session");
    await page.until(`!!document.querySelector('[aria-label="First message"]')`);
    await begin();
    await stop();
    await switchMachine("Local");
    await page.click("button", "New session");
    await page.until(`!!document.querySelector('[aria-label="First message"]')`);
    await page.ab("fill", field, "LOCAL-NEW");
    await answer("REMOTE-NEW-VOICE");
    assert.equal(await value(), "LOCAL-NEW");
    await clear();
    await page.click("button", "Local collision session");
    await switchMachine("eng-1");
    await page.until(`document.querySelector('${field}')?.value === 'REMOTE-NEW-VOICE'`);
    await page.ab("set", "viewport", "390", "844");
    await page.capture("voice-6-peer-new-mobile");
    await page.ab("set", "viewport", "1280", "900");
    await clear();
    await switchMachine("Local");
    await page.see("Local collision session saved history");
    assert.equal(await value(), "LOCAL-DRAFT");
    assert.equal(await page.evaluate(`window.voiceFixture.tracks.some(t => t.live)`), false);
    assert.deepEqual(page.remote.prompts(), []);
    assert.deepEqual(page.peers["eng-2"].prompts(), []);
    writeFileSync(
      join(page.evidence, "voice-result.json"),
      JSON.stringify(
        {
          boundary:
            "fake browser microphone/MediaRecorder; CDP transcription response stub; real main settings and peer backends; no real microphone or provider",
          requests: requests.map(({ url, mimeType, hints, audio }) => ({
            url,
            mimeType,
            hints,
            encodedBytes: audio.length,
          })),
          localPrompts: page.prompts(),
          remotePrompts: page.remote.prompts(),
        },
        null,
        2,
      ),
    );
    // The parent uses this reviewed transcript for its existing image+text Send assertion.
    return async (text) => {
      await call("Fetch.enable", {
        patterns: [{ urlPattern: "*/api/voice/transcribe", requestStage: "Request" }],
      });
      try {
        await clear();
        await begin();
        await stop();
        await answer(text);
        await page.until(`document.querySelector('${field}')?.value === ${JSON.stringify(text)}`);
        await page.capture("voice-7-reviewed-text-with-image");
      } finally {
        await call("Fetch.disable");
      }
    };
  } finally {
    await call("Fetch.disable");
  }
}
