import assert from "node:assert/strict";
import { posix } from "node:path";
import { after, afterEach, before, test } from "node:test";
import { JSDOM } from "jsdom";
import type { FilePreview } from "../shared/files.ts";
import { prepareHtmlPreview, type HtmlPreviewReadFile } from "../web/src/lib/html-preview.ts";

// This checks the module's public output and acquisition contract, not browser sandbox behavior.
// The scratch-browser journey must separately observe no requests during parsing or rendering.
const dom = new JSDOM("<!doctype html>", { url: "https://piano.invalid/" });
before(() => {
  Object.defineProperty(globalThis, "document", { configurable: true, value: dom.window.document });
});
after(() => {
  Reflect.deleteProperty(globalThis, "document");
  dom.window.close();
});
const textFile = (path: string, content: string): FilePreview => ({
  workspaceId: "workspace",
  path,
  kind: "text",
  language: "css",
  content,
});
const imageFile = (path: string): FilePreview => ({
  workspaceId: "workspace",
  path,
  kind: "image",
  mime: "image/png",
  bytes: new Uint8Array([137, 80, 78, 71]),
});
const unexpectedReads: string[] = [];
afterEach(() => {
  assert.deepEqual(unexpectedReads.splice(0), [], "Disallowed resources reached the file reader");
});
const noRead: HtmlPreviewReadFile = async (path) => {
  unexpectedReads.push(path);
  throw new Error("A disallowed resource reached the file reader");
};
const prepare = (html: string, read: HtmlPreviewReadFile = noRead) =>
  prepareHtmlPreview(html, "/work/reports/report.html", read, new AbortController().signal);
const parse = (html: string) => new JSDOM(html).window.document;

test("static text and details survive, while executable, navigable and form surfaces do not", async () => {
  const result = await prepare(`<!doctype html><html><head>
    <base href="https://evil.invalid/"><meta http-equiv="refresh" content="0;url=https://evil.invalid/">
    <script>throw new Error('executed')</script>
    <link rel="preload" as="image" href="https://evil.invalid/preload">
    </head><body onload="alert(1)">
    <details open id="proof"><summary>Evidence</summary><p class="prose">Still readable</p></details>
    <a href="#proof" target="_blank" ping="https://evil.invalid/ping" download>Fragment</a>
    <a href="javascript:alert(1)">Script link</a>
    <form action="https://evil.invalid/submit"><p>Form explanation</p><input autofocus name="secret"><button>Submit</button></form>
    <iframe src="https://evil.invalid/frame" srcdoc="<script>alert(1)</script>"></iframe>
    <object data="https://evil.invalid/object"></object><embed src="https://evil.invalid/embed">
    <svg><a href="https://evil.invalid/svg"><text>SVG navigation</text></a></svg>
    <math><mtext><img src="https://evil.invalid/math"></mtext></math>
    <template><img src="https://evil.invalid/template"></template>
    <img alt="Unavailable" src="https://evil.invalid/image" srcset="https://evil.invalid/2x 2x" onerror="alert(1)">
    </body></html>`);
  const output = parse(result);
  assert.equal(output.querySelector("details")?.hasAttribute("open"), true);
  assert.equal(output.querySelector("summary")?.textContent, "Evidence");
  assert.equal(output.querySelector(".prose")?.textContent, "Still readable");
  assert.match(output.body.textContent!, /Form explanation/);
  assert.equal(
    output.querySelector(
      "script,base,link,form,input,button,iframe,object,embed,svg,math,template",
    ),
    null,
  );
  assert.equal(
    output.querySelector("[href],[src],[srcset],[onerror],[onload],[target],[ping],[download]"),
    null,
  );
  assert.equal(output.querySelector("img")?.getAttribute("alt"), "Unavailable");
  const csp = output
    .querySelector('meta[http-equiv="Content-Security-Policy"]')
    ?.getAttribute("content");
  assert.match(csp!, /default-src 'none'/);
  assert.match(csp!, /script-src 'none'/);
  assert.match(csp!, /form-action 'none'/);
  assert.equal(output.querySelector('meta[http-equiv="refresh"]'), null);
});

test("relative stylesheets, media imports and CSS/HTML images share a bounded read seam", async () => {
  const requested: string[] = [];
  const files: Record<string, FilePreview> = {
    "/work/reports/css/main.css": textFile(
      "/work/reports/css/main.css",
      `
      @import "./nested/colors.css" screen;
      .card { background: url('../images/chart.png'); border: 1px solid red }
      .remote { background: url(https://evil.invalid/exfil) }
    `,
    ),
    "/work/reports/css/nested/colors.css": textFile(
      "/work/reports/css/nested/colors.css",
      ".card { color: navy }",
    ),
    "/work/reports/images/chart.png": imageFile("/work/reports/images/chart.png"),
  };
  const output = parse(
    await prepare(
      `
    <link rel="stylesheet" href="css/main.css?version=1">
    <div class="card" style="background-image:url(images/chart.png)">Chart</div>
    <img src="./images/chart.png#ignored">
  `,
      async (path) => {
        requested.push(path);
        // This fixture has no symlinks; the real file seam resolves physical paths.
        const resolved = posix.normalize(path);
        assert.ok(files[resolved], `Unexpected read: ${path}`);
        return files[resolved]!;
      },
    ),
  );
  assert.deepEqual(
    new Set(requested.map((path) => posix.normalize(path))),
    new Set(Object.keys(files)),
  );
  assert.equal(requested.length, 3, "an image used twice in CSS and once in HTML is read once");
  const style = output.querySelector("style")!.textContent!;
  assert.match(style, /@media screen\{/);
  assert.match(style, /color:navy/);
  assert.match(style, /border:1px solid red/);
  assert.doesNotMatch(style, /@import|https:|url\(['"]?\.\./);
  assert.match(style, /data:image\/png;base64,iVBORw==/);
  assert.match(output.querySelector(".card")!.getAttribute("style")!, /data:image\/png;base64,/);
  assert.equal(output.querySelector("img")!.getAttribute("src"), "data:image/png;base64,iVBORw==");
});

test("root attributes survive so document selectors, direction and language keep their meaning", async () => {
  const output = parse(
    await prepare(
      `<html lang="ar" dir="rtl" class="course"><body id="lesson" class="report" style="color:navy" onload="alert(1)"><style>.report .ready{display:block}.ready{display:none}</style><p class="ready">Release approved</p></body></html>`,
    ),
  );
  assert.equal(output.documentElement.lang, "ar");
  assert.equal(output.documentElement.dir, "rtl");
  assert.equal(output.documentElement.className, "course");
  assert.equal(output.body.id, "lesson");
  assert.equal(output.body.className, "report");
  assert.equal(output.body.style.color, "navy");
  assert.equal(output.body.hasAttribute("onload"), false);
  assert.equal(output.querySelector(".report .ready")?.textContent, "Release approved");
});

test("symlink-parent resource spelling reaches the file seam unchanged", async () => {
  const reads: string[] = [];
  const output = parse(
    await prepare('<img src="alias/../private.png">', async (path) => {
      reads.push(path);
      return imageFile("/assets/private.png");
    }),
  );
  assert.deepEqual(reads, ["/work/reports/alias/../private.png"]);
  assert.ok(output.querySelector("img[src]"));
});

test("escaped CSS URLs, string-loading functions, raw recovery and raw-text breakout fail closed", async () => {
  const output = parse(
    await prepare(String.raw`
    <style>
      @import "https://evil.invalid/import";
      @font-face { font-family: exfil; src: url(https://evil.invalid/font) }
      a { background:u\72l(\68 ttps://evil.invalid/css); color: green }
      b { background: i\6d age-set("https://evil.invalid/image-set" 1x); color: blue }
      p::before { content: "\3c /style>\3c img src=https://evil.invalid/breakout>" }
      i { --remote: url(//evil.invalid/custom); background: var(--remote) }
    </style>
    <div style="background:url(data:image/svg+xml,attack);color:purple">Safe</div>
    <style>p { background: ???; color: tan }</style>
  `),
  );
  const css = [...output.querySelectorAll("style")].map((node) => node.textContent).join("");
  assert.match(css, /color:green/);
  assert.match(css, /color:blue/);
  assert.doesNotMatch(css, /@import|@font-face|image-set|--remote:/);
  assert.equal(output.querySelector("img"), null);
  assert.equal(output.querySelector("div")?.getAttribute("style"), "color:purple;");
});

test("automatic resource references cannot select absolute paths, protocols or encoded equivalents", async () => {
  const references = [
    "/etc/private.png",
    "//evil.invalid/a",
    "file:///etc/private.png",
    "https://evil.invalid/a",
    "data:image/png;base64,eA==",
    "blob:https://evil.invalid/a",
    "%2fetc/private.png",
    "https%3a%2f%2fevil.invalid/a",
    "%5c%5cevil.invalid/a",
    "a%00.png",
    "%zz",
    "#fragment",
  ];
  const output = parse(await prepare(references.map((src) => `<img src="${src}">`).join("")));
  assert.equal(output.querySelectorAll("img").length, references.length);
  assert.equal(output.querySelector("[src]"), null);
});

test("missing and wrong-kind resources disappear without discarding readable content", async () => {
  const output = parse(
    await prepare(
      '<link rel="stylesheet" href="missing.css"><img src="not-image"><p>Retained</p>',
      async (path) => {
        if (path.endsWith("missing.css")) throw new Error("Missing file");
        return textFile(path, "not an image");
      },
    ),
  );
  assert.equal(output.querySelector("style,[src]"), null);
  assert.equal(output.querySelector("p")?.textContent, "Retained");
});

test("cyclic imports terminate and imports beyond the depth budget are not read", async () => {
  const reads: string[] = [];
  const output = parse(
    await prepare('<link rel="stylesheet" href="0.css">', async (path) => {
      reads.push(path);
      const number = Number(path.match(/(\d+)\.css$/)![1]);
      return textFile(
        path,
        `@import "0.css"; @import "${number + 1}.css"; .level${number}{color:red}`,
      );
    }),
  );
  assert.equal(new Set(reads).size, reads.length);
  assert.ok(reads.length > 1 && reads.length <= 8);
  assert.match(output.querySelector("style")!.textContent!, /\.level0\{color:red;/);
  assert.doesNotMatch(output.querySelector("style")!.textContent!, /@import/);
});

test("distinct reads, acquired bytes and repeated embedding have independent bounds", async () => {
  const reads: string[] = [];
  const output = parse(
    await prepare(
      Array.from({ length: 50 }, (_, i) => `<img src="${i}.png">`).join(""),
      async (path) => {
        reads.push(path);
        return imageFile(path);
      },
    ),
  );
  assert.equal(reads.length, 32);
  assert.equal(output.querySelectorAll("img[src]").length, 32);

  const huge = {
    ...imageFile("/work/reports/huge.png"),
    kind: "image" as const,
    mime: "image/png",
    bytes: new Uint8Array(21 * 1024 * 1024),
  };
  assert.equal(
    parse(await prepare('<img src="huge.png">', async () => huge)).querySelector("[src]"),
    null,
  );

  const repeated = { ...huge, bytes: new Uint8Array(1024 * 1024) };
  await assert.rejects(
    prepare('<img src="huge.png">'.repeat(30), async () => repeated),
    /resource limit/,
  );
  await assert.rejects(prepare("x".repeat(1024 * 1024 + 1)), /size limit/);
  await assert.rejects(
    prepare("<div>".repeat(70) + "deep" + "</div>".repeat(70)),
    /structure limit/,
  );
});

test("abort rejects a pending read even if the reader ignores its signal; late results stay abandoned", async () => {
  const controller = new AbortController();
  let finish!: (value: FilePreview) => void;
  let started!: () => void;
  const reading = new Promise<void>((resolve) => {
    started = resolve;
  });
  const pending = prepareHtmlPreview(
    '<img src="slow.png"><img src="next.png">',
    "/work/report.html",
    async (_, signal) => {
      assert.equal(signal.aborted, false);
      started();
      return new Promise<FilePreview>((resolve) => {
        finish = resolve;
      });
    },
    controller.signal,
  );
  await reading;
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  finish(imageFile("/work/slow.png"));
  await assert.rejects(
    prepareHtmlPreview("Hello", "/work/report.html", noRead, controller.signal),
    { name: "AbortError" },
  );
});
