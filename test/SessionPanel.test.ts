import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";
import { JSDOM } from "jsdom";
import { Tooltip } from "radix-ui";
import { act, createElement, type ComponentType, type Context } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { createServer } from "vite";
import { createClient } from "../web/src/lib/client.ts";
import { createNavigation, type Navigation } from "../web/src/lib/navigation.ts";
import { initialState, type AppState } from "../web/src/store.ts";

test("retained HTML viewer stops admitting links under Settings and resumes without rereading", async (t) => {
  const dom = new JSDOM("<div id='root'></div>", { url: "http://piano.test/s/session" });
  const globals = {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    HTMLFormElement: dom.window.HTMLFormElement,
    HTMLInputElement: dom.window.HTMLInputElement,
    MutationObserver: dom.window.MutationObserver,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(callback, 0),
    cancelAnimationFrame: clearTimeout,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const originals = Object.fromEntries(
    Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  for (const [key, value] of Object.entries(globals))
    Object.defineProperty(globalThis, key, { configurable: true, value });
  let root: ReturnType<typeof createRoot> | undefined;
  let vite: Awaited<ReturnType<typeof createServer>> | undefined;
  t.after(async () => {
    if (root) await act(() => root!.unmount());
    await vite?.close();
    dom.window.close();
    for (const [key, descriptor] of Object.entries(originals)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });

  // Use the actual viewer, navigation, acquisition and preparation. Only HTTP is substituted.
  const reads: string[] = [];
  t.mock.method(globalThis, "fetch", async (_url: unknown, options: RequestInit) => {
    const requested = JSON.parse(String(options.body)).path as string;
    reads.push(requested);
    return Response.json({
      path: requested,
      workspaceId: "workspace",
      kind: "html",
      language: "html",
      content: "<a href='target.txt'>Target</a>",
    });
  });
  const listeners = new Set<EventListenerOrEventListenerObject>();
  const add = dom.window.addEventListener.bind(dom.window);
  const remove = dom.window.removeEventListener.bind(dom.window);
  t.mock.method(
    dom.window,
    "addEventListener",
    (
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions,
    ) => {
      if (type === "message") listeners.add(listener);
      add(type, listener, options);
    },
  );
  t.mock.method(
    dom.window,
    "removeEventListener",
    (
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | EventListenerOptions,
    ) => {
      if (type === "message") listeners.delete(listener);
      remove(type, listener, options);
    },
  );
  vite = await createServer({
    root: path.resolve("web"),
    server: { middlewareMode: true, watch: null },
    appType: "custom",
  });
  const { SessionPanel } = (await vite.ssrLoadModule("/src/components/SessionPanel.tsx")) as {
    SessionPanel: ComponentType<Record<string, unknown>>;
  };
  const { NavigationContext } = (await vite.ssrLoadModule("/src/lib/useNavigation.ts")) as {
    NavigationContext: Context<Navigation | null>;
  };
  const state: AppState = {
    ...initialState,
    view: { kind: "session" },
    workspaces: [{ id: "workspace", path: "/scratch", folder: "/scratch" }],
    session: {
      cwd: "/scratch",
      sessionId: "session",
      hosted: true,
      cursor: null,
      state: { sessionId: "session", isStreaming: false },
      messages: [],
      dialogs: [],
    },
  };
  const client = createClient({
    initial: state,
    notify: () => {},
    connect: () => {
      throw new Error("This viewer check must not open a session connection");
    },
  });
  const navigation = createNavigation({
    client,
    address: {
      location: () => ({ pathname: "/s/session", search: "" }),
      push: () => {},
      replace: () => {},
      setTitle: () => {},
      onPop: () => () => {},
    },
  });
  navigation.openFile("document.html");
  root = createRoot(dom.window.document.getElementById("root")!);
  await act(async () => {
    root!.render(
      createElement(
        NavigationContext.Provider,
        { value: navigation },
        createElement(
          Tooltip.Provider,
          null,
          createElement(SessionPanel, { state, id: "surface", labelledBy: undefined }),
        ),
      ),
    );
    // Resolve lazy loading before asserting the viewer's observable listener lifetime.
    await vite!.ssrLoadModule("/src/components/FileHtml.tsx");
  });
  // Preparation includes asynchronous WebCrypto work. Loading the lazy module is not the
  // ready event: drain React on event-loop turns until the actual viewer commits its frame.
  const deadline = performance.now() + 10_000;
  while (!dom.window.document.querySelector("iframe") && performance.now() < deadline)
    await act(() => setImmediate());
  const frame = dom.window.document.querySelector("iframe");
  assert.ok(frame, dom.window.document.body.textContent);
  assert.equal(listeners.size, 1);
  assert.deepEqual(reads, ["document.html"]);
  const prepared = frame.srcdoc;

  act(() => flushSync(() => navigation.openSettings()));
  assert.equal(listeners.size, 0, "a retained viewer must stop admitting messages at commit");
  assert.equal(dom.window.document.querySelector("iframe"), frame, "Settings retains the viewer");
  act(() => flushSync(() => navigation.closeSettings()));
  assert.equal(listeners.size, 1);
  assert.equal(frame.srcdoc, prepared, "return reuses the prepared document and token");
  assert.deepEqual(reads, ["document.html"], "visibility changes do not reacquire the file");
});
