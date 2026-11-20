import assert from "node:assert/strict";
import { run } from "./harness.mjs";

const sessionId = "shared-session";
const title = "Shared session";

async function openShare(page, palette = false) {
  if (palette) {
    await page.press("Mod+k");
    await page.ab("fill", "[cmdk-input]", "Share");
    await page.until(
      "document.querySelector('[cmdk-list]')?.getAttribute('aria-busy') === 'false'",
    );
    await page.press("Enter");
  } else {
    await page.click("button", "Session information and actions");
    await page.until(
      "[...document.querySelectorAll('[role=menu]')].some(e => e.getAnimations({subtree:true}).every(a => a.playState !== 'running'))",
    );
    await page.click("menuitem", "Share");
  }
  await page.see("Share to Radius");
  await page.see("The artifact is created with Private visibility.");
}

const TOAST_AT_REST = `(() => {
  const toast = document.querySelector('[data-sonner-toast][data-front=true]');
  return !!toast && toast.dataset.mounted === 'true' && toast.dataset.removed === 'false'
    && toast.getAnimations({ subtree: true }).every(a => a.playState !== 'running');
})()`;

async function toastButton(page, name) {
  await page.until(TOAST_AT_REST);
  await page.click("button", name);
}

async function closeToast(page) {
  await page.until(TOAST_AT_REST);
  await page.ab("click", "[data-sonner-toast][data-front=true] [data-close-button]");
  await page.ab("hover", '[aria-label="Message"]');
  await page.until("!document.querySelector('[data-sonner-toast]')");
}

const ready = (page) =>
  page.until(`document.querySelector('[aria-label^="Model:"]')?.disabled === false`);

async function shareSignIn(page) {
  await openShare(page);
  await page.capture("share-confirm");
  await page.click("button", "Cancel");
  await page.until("!document.querySelector('[role=dialog]')");
  await openShare(page, true);
  await page.click("button", "Share");
  await page.until("!document.querySelector('[role=dialog]')");
  await page.see("Cannot share");
  await page.see("Sign in Radius to share.");
  await page.until(TOAST_AT_REST);
  await page.capture("share-sign-in");
  await toastButton(page, "Providers");
  await page.until(
    "location.pathname === '/settings/providers' && !!document.getElementById('settings-providers-title')",
  );
  await page.until("!document.querySelector('[data-sonner-toast]')");
  await page.capture("share-providers");
}

async function shareResultView(page, call, onEvent) {
  let held;
  const requests = [];
  onEvent(({ method, params }) => {
    if (method !== "Fetch.requestPaused" || !params.request.url.includes("/api/session/share"))
      return;
    held = params;
    requests.push(params.request);
  });
  await call("Fetch.enable", {
    patterns: [{ urlPattern: "*/api/session/share*", requestStage: "Request" }],
  });
  try {
    for (const status of ["shared", "uncertain"]) {
      held = undefined;
      await openShare(page);
      await page.click("button", "Share");
      await page.until("!document.querySelector('[role=dialog]')");
      await page.see("Sharing session");
      assert.ok(held, "one explicit confirmation issues a request");
      await page.press("Mod+k");
      await page.until("!!document.querySelector('[cmdk-input]')");
      await page.press("Escape");
      await page.until("!document.querySelector('[cmdk-input]')");
      assert.equal(
        await page.evaluate("document.querySelector('[data-sonner-toast]')?.dataset.type"),
        "loading",
        "the upload continues behind other work",
      );
      await page.capture(`share-${status}-pending`);
      assert.equal(new URL(held.request.url).pathname, "/api/session/share");
      assert.deepEqual(JSON.parse(held.request.postData), { confirmed: true });
      const share = {
        url: "https://radius.pi.dev/artifacts/synthetic-share",
        visibility: "private",
        expiresAt: "2027-01-01T00:00:00Z",
      };
      await call("Fetch.fulfillRequest", {
        requestId: held.requestId,
        responseCode: status === "shared" ? 200 : 502,
        responseHeaders: [{ name: "content-type", value: "application/json" }],
        body: Buffer.from(
          JSON.stringify(
            status === "shared" ? { status, share } : { error: "Radius did not answer." },
          ),
        ).toString("base64"),
      });
      if (status === "shared") {
        await page.see("Session shared");
        await call("Browser.grantPermissions", {
          origin: new URL(held.request.url).origin,
          permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"],
        });
        await toastButton(page, "Copy link");
        await page.see("Link copied");
        assert.equal(await page.evaluate("navigator.clipboard.readText()"), share.url);
        assert.deepEqual(
          await page.evaluate(
            "[...document.querySelectorAll('[data-sonner-toast] button')].map(e => e.textContent.trim()).filter(Boolean)",
          ),
          ["Open link", "Link copied"],
          "the result offers Open link and Copy link, nothing else",
        );
        await page.evaluate(
          "window.sharedOpens = []; window.open = (url) => { window.sharedOpens.push(url); return null; }",
        );
        await page.capture(`share-${status}`);
        await toastButton(page, "Open link");
        assert.deepEqual(await page.evaluate("window.sharedOpens"), [share.url]);
        assert.equal(
          await page.evaluate(
            "!!document.querySelector('[data-sonner-toast][data-removed=false]')",
          ),
          true,
          "the link stays available after opening it",
        );
        await closeToast(page);
      } else {
        await page.see("Radius may have created an artifact");
        assert.equal(
          await page.evaluate(
            "[...document.querySelectorAll('[data-sonner-toast] button')].some(e => e.textContent.trim() !== '')",
          ),
          false,
          "uncertainty offers no immediate retry",
        );
        await page.capture(`share-${status}`);
        await closeToast(page);
      }
      await page.until("!document.querySelector('[data-sonner-toast]')");
    }
    assert.equal(requests.length, 2, "one request per confirmation, no retry");
  } finally {
    await call("Fetch.disable");
  }
}

await run(
  "session-sharing",
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
      workspaces: [{ id: "shared-workspace", path: cwd, folder: cwd }],
      sessions: [{ sessionId, cwd, title, createdAt: now, updatedAt: now }],
    };
  },
  async (page) => {
    await page.open(`/s/${sessionId}`);
    await page.see(`${title} saved history`);
    await ready(page);
    await shareSignIn(page);
    await page.open(`/s/${sessionId}`);
    await page.see(`${title} saved history`);
    await ready(page);
    await page.cdp((call, onEvent) => shareResultView(page, call, onEvent));
  },
  { backendEnv: { RADIUS_API_KEY: "" } },
);
