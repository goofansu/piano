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
  await page.see("Everything saved, unredacted");
  await page.see("which may be public");
}

export async function shareSignIn(page, machine, local = false) {
  await openShare(page);
  await page.capture(`share-${machine}-confirm`);
  await page.click("button", "Cancel");
  await page.until("!document.querySelector('[role=dialog]')");
  await openShare(page, true);
  await page.click("button", "Share");
  await page.see("Nothing was uploaded.");
  if (local) {
    await page.see("Sign in under Settings → Providers");
    await page.capture("share-local-sign-in");
    await page.click("button", "Open Providers");
    await page.see("Providers");
    await page.until("location.pathname.includes('providers')");
  } else {
    await page.see(`Sign in to Radius on ${machine}`);
    await page.see("The main Piano’s sign-in is not used.");
    assert.equal(
      await page.evaluate(
        "[...document.querySelectorAll('[role=dialog] button')].some(e => e.textContent.includes('Open Providers'))",
      ),
      false,
    );
    await page.capture(`share-${machine}-sign-in`);
    await page.click("button", "Done");
    await page.until("!document.querySelector('[role=dialog]')");
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
      await page.until("document.querySelector('[role=dialog] button:disabled') !== null");
      assert.ok(held, "one explicit confirmation issues a request");
      await page.press("Escape");
      assert.equal(
        await page.evaluate("!!document.querySelector('[role=dialog]')"),
        true,
        "pending upload cannot be dismissed",
      );
      await page.capture(`share-peer-${status}-pending`);
      assert.match(held.request.url, /\/peer\/eng-1\/api\/session\/share\?/);
      assert.deepEqual(JSON.parse(held.request.postData), { confirmed: true });
      const share = {
        url: "https://radius.pi.dev/artifacts/synthetic-share",
        visibility: "public",
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
        await page.see("Public · Expires");
        await call("Browser.grantPermissions", {
          origin: new URL(held.request.url).origin,
          permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"],
        });
        await page.click("button", "Copy link");
        await page.until(
          `!!document.querySelector('[role=dialog] button[aria-label="Link copied"]')`,
        );
        assert.equal(await page.evaluate("navigator.clipboard.readText()"), share.url);
        assert.equal(
          await page.evaluate(
            "[...document.querySelectorAll('[role=dialog] a')].find(e => e.textContent.includes('Open link')).href",
          ),
          share.url,
        );
      } else {
        await page.see("Radius may have created an artifact");
        assert.equal(
          await page.evaluate(
            "[...document.querySelectorAll('[role=dialog] button')].some(e => e.textContent.trim() === 'Share')",
          ),
          false,
          "uncertainty offers no immediate retry",
        );
      }
      await page.capture(`share-peer-${status}`);
      await page.click("button", "Done");
      await page.until("!document.querySelector('[role=dialog]')");
    }
    assert.equal(requests.length, 2, "one request per confirmation, no retry");
  } finally {
    await call("Fetch.disable");
  }
}
