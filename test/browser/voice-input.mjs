import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness.mjs";

const sessionId = "voice-session";
const title = "Voice session";

async function voiceFixture(page, call, onEvent) {
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
    window.voiceFixture = { tracks: [] };
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async () => {
      const f = window.voiceFixture;
      const track = new EventTarget(); track.live = true; track.stop = () => { track.live = false; };
      f.tracks.push(track);
      const stream = { getTracks: () => [track] };
      return stream;
    }});
    window.MediaRecorder = class {
      static isTypeSupported(type) { return type === 'audio/webm;codecs=opus'; }
      constructor(stream, options) { this.state = 'inactive'; this.mimeType = options.mimeType; window.voiceFixture.recorder = this; }
      start() { this.state = 'recording'; }
      stop() { this.state = 'inactive'; setTimeout(() => {
        this.ondataavailable?.({ data: new Blob([new Uint8Array(1100000)], { type: this.mimeType }) });
        this.onstop?.();
      }, 0); }
    };
  })()`);
  const field = '[aria-label="Message"], [aria-label="First message"]';
  const value = () => page.evaluate(`document.querySelector('${field}')?.value`);
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
    for (let n = 0; !pending.length; n++) {
      assert.ok(n < 100, "transcription request is sent");
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
  return { requests, field, value, ready, begin, stop, requested, answer };
}

const preferences = async (page) => {
  await page.click("button", "Settings");
  await page.click("button", "Preferences");
  await page.until(`location.pathname === '/settings/preferences'`);
  await page.until(
    `document.querySelector('[role="switch"]')?.matches(':disabled, [aria-disabled="true"], [data-disabled]') === false`,
  );
  if (await page.evaluate(`!!document.querySelector('[data-sonner-toast]')`)) {
    await page.click("button", "Close toast");
    await page.until(`!document.querySelector('[data-sonner-toast]')`);
  }
};

const enableVoice = async (page) => {
  await page.click("switch", "Voice input");
  await page.see("Voice input sends recordings and session context through Piano to OpenAI.");
  await page.ab("fill", 'input[type="password"]', "sk-fixture-no-provider-call");
  await page.click("button", "Save");
  await page.see("Voice input turned on");
};

const openSession = async (page) => {
  await page.click("button", title);
  await page.see(`${title} saved history`);
  await page.until(`document.querySelector('[aria-label^="Model:"]')?.disabled === false`);
  await page.until(`!!document.querySelector('[aria-label="Message"]')`);
};

const openNew = async (page) => {
  await page.click("button", "New session");
  await page.until(`!!document.querySelector('[aria-label="First message"]')`);
};

async function voiceInputs(page, call, onEvent) {
  const { requests, field, value, ready, begin, stop, requested, answer } = await voiceFixture(
    page,
    call,
    onEvent,
  );
  const visibility = [];
  const checkComposers = async (enabled, step) => {
    for (const composer of ["existing", "new"]) {
      await (composer === "new" ? openNew(page) : openSession(page));
      if (enabled) await ready();
      assert.equal(
        await page.evaluate(`!!document.querySelector('[aria-label="Voice input"]')`),
        enabled,
        `${step}: the ${composer} composer follows the Voice input preference`,
      );
      visibility.push({ step, composer, enabled });
      await page.capture(`voice-visibility-${step}-${composer}`);
    }
  };
  const fieldIs = (text) =>
    page.until(`document.querySelector('${field}')?.value === ${JSON.stringify(text)}`);
  try {
    await preferences(page);
    await page.until(
      `document.querySelector('[role="switch"]')?.getAttribute('aria-checked') === 'false'`,
    );
    await page.click("button", "Home");
    await checkComposers(false, "initial-off");
    await preferences(page);
    await enableVoice(page);
    await page.click("button", "Home");
    await checkComposers(true, "on");

    await openSession(page);
    await begin();
    await stop();
    await requested();
    await preferences(page);
    await page.click("switch", "Voice input");
    await page.see("Voice input turned off");
    await page.click("button", "Home");
    await page.until(`!!document.querySelector('[aria-label="Cancel transcription"]')`);
    await page.capture("voice-off-active-cancel");
    await page.click("button", "Cancel transcription");
    await answer("cancelled-while-off", 499);
    await page.until(`!document.querySelector('[aria-label="Cancel transcription"]')`);
    assert.equal(await value(), "");
    await checkComposers(false, "off-again");
    await preferences(page);
    await page.click("switch", "Voice input");
    await page.until(
      `document.querySelector('[role="switch"]')?.getAttribute('aria-checked') === 'true'`,
    );
    await page.click("button", "Home");

    await openSession(page);
    await page.ab("fill", field, "TYPED");
    await begin();
    await stop();
    await openNew(page);
    await page.ab("fill", field, "NEW-DRAFT");
    await answer("spoken");
    assert.equal(await value(), "NEW-DRAFT", "a result never lands in the draft on screen");
    await openSession(page);
    await fieldIs("TYPED spoken");
    await page.capture("voice-session-draft");
    assert.equal(requests.at(-1).hints.session, title);

    const before = requests.length;
    await begin();
    await openNew(page);
    assert.equal(
      await page.evaluate(`window.voiceFixture.tracks.some(t => t.live)`),
      false,
      "leaving a recording releases the microphone",
    );
    await openSession(page);
    await fieldIs("TYPED spoken");
    assert.equal(requests.length, before, "an abandoned recording is not transcribed");

    await openNew(page);
    await begin();
    await stop();
    await openSession(page);
    await answer("NEW-VOICE");
    assert.equal(await value(), "TYPED spoken");
    await openNew(page);
    await fieldIs("NEW-DRAFT NEW-VOICE");
    await page.ab("set", "viewport", "390", "844");
    await page.capture("voice-new-mobile");
    await page.ab("set", "viewport", "1280", "900");
    assert.equal(await page.evaluate(`window.voiceFixture.tracks.some(t => t.live)`), false);
    assert.deepEqual(page.prompts(), [], "dictation never sends itself");
    writeFileSync(
      join(page.evidence, "voice-result.json"),
      JSON.stringify(
        {
          boundary:
            "fake browser microphone/MediaRecorder; CDP transcription response stub; real settings backend; no real microphone or provider",
          visibility,
          requests: requests.map(({ url, mimeType, hints, audio }) => ({
            url,
            mimeType,
            hints,
            encodedBytes: audio.length,
          })),
          prompts: page.prompts(),
        },
        null,
        2,
      ),
    );
  } finally {
    await call("Fetch.disable");
  }
}

await run(
  "voice-input",
  ({ repository, history }) => {
    const cwd = repository("repo");
    const now = new Date().toISOString();
    history({
      sessionId,
      cwd,
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: `${title} saved history` }],
          timestamp: Date.now(),
        },
      ],
    });
    return {
      folders: [cwd],
      workspaces: [{ id: "voice-workspace", path: cwd, folder: cwd }],
      sessions: [{ sessionId, cwd, title, createdAt: now, updatedAt: now }],
    };
  },
  async (page) => {
    await page.open("/");
    await page.see(title);
    await page.cdp((call, onEvent) => voiceInputs(page, call, onEvent));
  },
);
