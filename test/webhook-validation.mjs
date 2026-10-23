import assert from "node:assert/strict";
// Focused UI regression, not part of the critical-path browser suite.
// node test/webhook-validation.mjs [evidence-directory]
import { run } from "./browser/harness.mjs";

await run(
  "webhook-validation",
  () => ({}),
  async (page) => {
    await page.open("/settings/webhooks");
    await page.click("button", "Add webhook");
    await page.ab("fill", "#webhook-url", "https://example.com/webhook");
    await page.click("button", "Save webhook");
    await page.until('!document.querySelector("[role=dialog]")');
    await page.click("button", "Webhook actions example.com");
    await page.click("menuitem", "Edit");
    await page.click("checkbox", "session.completed");
    await page.click("button", "Save webhook");
    await page.see("Select at least one event.");
    await page.capture("events-error");
    const state = await page.evaluate(
      `({urlInvalid: document.querySelector('#webhook-url').getAttribute('aria-invalid'), eventsInvalid: [...document.querySelectorAll('[role=checkbox]')].every(e => e.getAttribute('aria-invalid') === 'true')})`,
    );
    console.log("No events:", state);
    assert.notEqual(state.urlInvalid, "true", "a valid URL must not be flagged for missing events");
    assert.equal(state.eventsInvalid, true);
    await page.click("checkbox", "session.completed");
    assert.equal(
      await page.evaluate(`document.querySelector('[role="alert"]') === null`),
      true,
      "selecting an event clears its validation error",
    );
    await page.ab("fill", "#webhook-url", "http://example.com/webhook");
    await page.click("button", "Save webhook");
    await page.until(
      `document.querySelector('#webhook-url').getAttribute('aria-invalid') === 'true'`,
    );
    await page.capture("url-error");
    console.log("Invalid HTTP URL flagged");
    await page.ab("fill", "#webhook-url", "https://example.com/webhook");
    await page.click("button", "Save webhook");
    await page.until('!document.querySelector("[role=dialog]")');
    console.log("Corrected webhook saved");
  },
);
