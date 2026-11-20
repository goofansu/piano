import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";
import { JSDOM } from "jsdom";
import { act, createElement, type Context } from "react";
import { createRoot } from "react-dom/client";
import { createServer } from "vite";
import type { PageStores } from "../web/src/lib/pageStores.ts";
import { pageStores } from "./fixtures/pageStores.ts";

test("unchanged prose loads images only when a workspace owns it, and releases them on removal", async (t) => {
  const dom = new JSDOM("<div id='root'></div>");
  const globals = {
    window: dom.window,
    document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const originals = Object.fromEntries(
    Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  for (const [key, value] of Object.entries(globals))
    Object.defineProperty(globalThis, key, { configurable: true, value });
  const root = createRoot(dom.window.document.getElementById("root")!);
  const vite = await createServer({
    root: path.resolve("web"),
    server: { middlewareMode: true, watch: null, ws: false },
    appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  t.after(async () => {
    await act(() => root.unmount());
    await vite.close();
    dom.window.close();
    for (const [key, descriptor] of Object.entries(originals)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
  const { useMarkdownImages } = (await vite.ssrLoadModule("/src/lib/useMarkdownImages.ts")) as {
    useMarkdownImages: (
      workspaceId: string | undefined,
      text: string,
    ) => ReadonlyMap<string, string>;
  };
  const { PageStoresContext } = (await vite.ssrLoadModule("/src/lib/usePageStores.ts")) as {
    PageStoresContext: Context<PageStores | null>;
  };
  const reads: Array<{ workspaceId: string | null; path: string }> = [];
  const signals: AbortSignal[] = [];
  t.mock.method(globalThis, "fetch", async (url: string, options: RequestInit) => {
    const requested = JSON.parse(String(options.body)).path as string;
    reads.push({
      workspaceId: new URL(url, "http://piano.test").searchParams.get("workspaceId"),
      path: requested,
    });
    signals.push(options.signal!);
    const form = new FormData();
    form.set(
      "metadata",
      JSON.stringify({
        workspaceId: "workspace",
        path: requested,
        kind: "image",
        mime: "image/png",
      }),
    );
    form.set("file", new Blob([new Uint8Array([1])], { type: "image/png" }), "shot.png");
    return new Response(form);
  });
  const revoked: string[] = [];
  const revoke = URL.revokeObjectURL;
  t.mock.method(URL, "revokeObjectURL", (url: string) => {
    revoked.push(url);
    revoke(url);
  });
  function Prose({ workspaceId }: { workspaceId?: string }) {
    const images = useMarkdownImages(workspaceId, "![shot](./shot.png)");
    return createElement("output", null, images.get("./shot.png") ?? "fallback");
  }
  const render = async (workspaceId?: string) => {
    await act(() => {
      root.render(
        createElement(
          PageStoresContext.Provider,
          { value: pageStores() },
          createElement(Prose, { workspaceId }),
        ),
      );
    });
    const output = () => dom.window.document.querySelector("output")!.textContent!;
    const deadline = performance.now() + 5000;
    while (workspaceId && output() === "fallback" && performance.now() < deadline)
      await act(() => setImmediate());
    return output();
  };

  assert.equal(await render(), "fallback");
  assert.deepEqual(reads, [], "no workspace means no file access");
  const first = await render("workspace");
  assert.deepEqual(reads, [{ workspaceId: "workspace", path: "shot.png" }]);
  assert.match(first, /^blob:/, "gaining a workspace discovers the unchanged text");
  assert.equal(await render(), "fallback");
  assert.deepEqual(revoked, [first]);
  assert.ok(signals[0].aborted);
  assert.equal(reads.length, 1, "losing the workspace does not read again");
  const second = await render("workspace");
  assert.match(second, /^blob:/);
  assert.notEqual(second, first, "a new owner cannot reuse the revoked image");
  assert.equal(reads.length, 2);
});
