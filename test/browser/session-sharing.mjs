import assert from "node:assert/strict";

export async function openShare(page, palette = false) {
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

const TOASTS_AT_REST =
  "[...document.querySelectorAll('[data-sonner-toast]')].every(e => e.dataset.mounted === 'true' && e.getAnimations({ subtree: true }).every(a => a.playState !== 'running'))";

async function toastButton(page, name) {
  await page.until(TOASTS_AT_REST);
  await page.click("button", name);
}

async function closeToast(page) {
  await page.until(TOASTS_AT_REST);
  await page.ab("click", "[data-sonner-toast][data-front=true] [data-close-button]");
  await page.ab("hover", '[aria-label="Message"]');
  await page.until("!document.querySelector('[data-sonner-toast]')");
}

export async function shareSignIn(page, machine, local = false) {
  await openShare(page);
  await page.capture(`share-${machine}-confirm`);
  await page.click("button", "Cancel");
  await page.until("!document.querySelector('[role=dialog]')");
  await openShare(page, true);
  await page.click("button", "Share");
  await page.until("!document.querySelector('[role=dialog]')");
  await page.see("Cannot share");
  await page.until(TOASTS_AT_REST);
  if (local) {
    await page.see("Sign in Radius to share.");
    await page.capture("share-local-sign-in");
    await toastButton(page, "Providers");
    await page.see("Providers");
    await page.until("location.pathname.includes('providers')");
  } else {
    await page.see(`Sign in Radius on ${machine} to share.`);
    await page.capture(`share-${machine}-sign-in`);
    const path = await page.evaluate("location.pathname");
    await page.evaluate(
      "window.sharedOpens = []; window.open = (url) => { window.sharedOpens.push(url); return null; }",
    );
    await toastButton(page, "Providers");
    assert.deepEqual(
      await page.evaluate("window.sharedOpens"),
      [`${page.remote.origin}/settings/providers`],
      "Providers opens the peer's own Providers settings",
    );
    assert.equal(await page.evaluate("location.pathname"), path, "main stays where it was");
    await closeToast(page);
  }
}

export async function shareResultView(page, call, onEvent) {
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
      await page.capture(`share-peer-${status}-pending`);
      assert.match(held.request.url, /\/peer\/eng-1\/api\/session\/share\?/);
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
            status === "shared" ? { status, share } : { error: "Remote machine unavailable." },
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
        await page.capture(`share-peer-${status}`);
        await toastButton(page, "Open link");
        assert.deepEqual(await page.evaluate("window.sharedOpens"), [share.url]);
        assert.equal(
          await page.evaluate("!!document.querySelector('[data-sonner-toast]')"),
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
        await page.capture(`share-peer-${status}`);
        await closeToast(page);
      }
      await page.until("!document.querySelector('[data-sonner-toast]')");
    }
    assert.equal(requests.length, 2, "one request per confirmation, no retry");
  } finally {
    await call("Fetch.disable");
  }
}
