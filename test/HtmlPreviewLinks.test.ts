import assert from "node:assert/strict";
import { test } from "node:test";
import {
  listenHtmlPreviewLinks,
  type HtmlPreviewDocument,
  type HtmlPreviewLink,
} from "../web/src/lib/html-preview-bridge.ts";

// Browser messaging is the boundary: exercise the registered listener with delivery facts.
// Real isTrusted/source/origin and script containment are separately checked in Chromium.
test("only the current opaque frame's exact indexed click message can open a destination", () => {
  const listeners = new Set<(event: MessageEvent) => void>();
  const host = {
    addEventListener: (_: string, listener: (event: MessageEvent) => void) =>
      listeners.add(listener),
    removeEventListener: (_: string, listener: (event: MessageEvent) => void) =>
      listeners.delete(listener),
  } as unknown as Window;
  const source = {};
  const frame = { contentWindow: source } as HTMLIFrameElement;
  const preview: HtmlPreviewDocument = {
    srcDoc: "",
    token: "current-generation",
    links: [
      { kind: "file", path: "/work/reference/map.html" },
      { kind: "web", url: "https://example.com/source" },
    ],
  };
  const opened: HtmlPreviewLink[] = [];
  const dispose = listenHtmlPreviewLinks(host, frame, preview, (link) => opened.push(link));
  const valid = { type: "piano-html-link", token: "current-generation", index: 0 };
  const deliver = (data: unknown, overrides = {}) => {
    const event = { data, source, origin: "null", isTrusted: true, ...overrides } as MessageEvent;
    for (const listener of listeners) listener(event);
  };
  deliver(valid);
  deliver({ ...valid, index: 1 });
  assert.deepEqual(opened.splice(0), [
    { kind: "file", path: "/work/reference/map.html" },
    { kind: "web", url: "https://example.com/source" },
  ]);
  for (const data of [
    null,
    [],
    "click",
    {},
    { ...valid, url: "https://evil.invalid" },
    { ...valid, token: "previous-generation" },
    { ...valid, type: "navigate" },
    ...[-1, 2, 0.5, NaN, Infinity, "0"].map((index) => ({ ...valid, index })),
  ])
    deliver(data);
  deliver(valid, { source: {} });
  deliver(valid, { source: null });
  deliver(valid, { origin: "https://piano.invalid" });
  deliver(valid, { isTrusted: false });
  assert.equal(opened.length, 0);
  // A reused iframe WindowProxy cannot make a previous document's queued click current.
  dispose();
  const next = listenHtmlPreviewLinks(
    host,
    frame,
    { ...preview, token: "next-generation" },
    (link) => opened.push(link),
  );
  deliver(valid);
  assert.equal(opened.length, 0);
  deliver({ ...valid, token: "next-generation" });
  assert.equal(opened.length, 1);
  next();
  opened.length = 0;
  deliver({ ...valid, token: "next-generation" });
  assert.deepEqual(opened, []);
});
