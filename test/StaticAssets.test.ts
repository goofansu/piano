import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, request as httpRequest, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { brotliCompressSync, brotliDecompressSync, gunzipSync, gzipSync } from "node:zlib";
import { NodeHttpServer } from "@effect/platform-node";
import { Effect, Fiber, Layer } from "effect";
import { HttpRouter } from "effect/http";
import { staticAssets } from "../server/StaticAssets.ts";

// A built web client as Vite leaves it: hashed assets under assets/, unhashed public files and
// index.html at the root, and the precompressed copies the build writes beside them.
const INDEX = `<!doctype html><html><body>${"<p>piano</p>".repeat(200)}</body></html>`;
const SCRIPT = `export const piano = ${JSON.stringify("a".repeat(4000))};\n`;
const LOGO = `<svg xmlns="http://www.w3.org/2000/svg">${"<rect />".repeat(200)}</svg>`;
const STYLE = ":root { color: red }\n";
const SECRET = "not served\n";

let root: string;
let outside: string;
let port: number;
let server: Fiber.Fiber<unknown, unknown>;

before(async () => {
  outside = mkdtempSync(join(tmpdir(), "piano-static-"));
  root = join(outside, "dist");
  mkdirSync(join(root, "assets"), { recursive: true });
  writeFileSync(join(outside, "secret.txt"), SECRET);
  // A Brotli copy outside the build: resolution, not the absence of a copy, must refuse it.
  writeFileSync(join(outside, "secret.txt.br"), brotliCompressSync(SECRET));
  const write = (name: string, content: string, codings: ReadonlyArray<"br" | "gz"> = []) => {
    writeFileSync(join(root, name), content);
    for (const coding of codings)
      writeFileSync(
        join(root, `${name}.${coding}`),
        coding === "br" ? brotliCompressSync(content) : gzipSync(content),
      );
  };
  write("index.html", INDEX, ["br", "gz"]);
  write(join("assets", "app-A1b2C3d4.js"), SCRIPT, ["br", "gz"]);
  // Below the build's size floor: no copy was written, so every client reads the file itself.
  write(join("assets", "style-E5f6G7h8.css"), STYLE);
  // A public file keeps its name across builds, and here only Brotli was worth keeping.
  write("logo.svg", LOGO, ["br"]);

  const node = createServer();
  server = Effect.runFork(
    Layer.launch(
      HttpRouter.serve(staticAssets({ root }), {
        disableLogger: true,
        disableListenLog: true,
      }).pipe(Layer.provide(NodeHttpServer.layer(() => node, { port: 0, host: "127.0.0.1" }))),
    ),
  );
  await once(node, "listening");
  port = (node.address() as AddressInfo).port;
});

after(async () => {
  await Effect.runPromise(Fiber.interrupt(server));
  rmSync(outside, { recursive: true, force: true });
});

interface Answer {
  readonly status: number;
  readonly headers: IncomingHttpHeaders;
  readonly body: Buffer;
}

/** Ask with the request target exactly as written: no client-side URL normalization, and no
 * Accept-Encoding unless the test sends one, so each answer is the server's own choice. */
const ask = (target: string, headers: Record<string, string> = {}, method = "GET") =>
  new Promise<Answer>((resolve, reject) => {
    const req = httpRequest({ host: "127.0.0.1", port, path: target, headers, method }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () =>
        resolve({ status: res.statusCode!, headers: res.headers, body: Buffer.concat(chunks) }),
      );
    });
    req.on("error", reject);
    req.end();
  });

const html = { accept: "text/html,application/xhtml+xml" };

test("a client that accepts a coding is answered from the copy the build wrote for it", async () => {
  const brotli = await ask("/assets/app-A1b2C3d4.js", { "accept-encoding": "br, gzip" });
  assert.equal(brotli.status, 200);
  assert.equal(brotli.headers["content-encoding"], "br");
  assert.equal(brotli.headers["content-type"], "text/javascript; charset=utf-8");
  assert.equal(brotli.headers.vary, "Accept-Encoding");
  assert.equal(brotliDecompressSync(brotli.body).toString(), SCRIPT);
  assert.ok(
    brotli.body.length < Buffer.byteLength(SCRIPT),
    "the coded answer is smaller than the asset",
  );

  const gzip = await ask("/assets/app-A1b2C3d4.js", { "accept-encoding": "gzip" });
  assert.equal(gzip.headers["content-encoding"], "gzip");
  assert.equal(gunzipSync(gzip.body).toString(), SCRIPT);

  const identity = await ask("/assets/app-A1b2C3d4.js");
  assert.equal(identity.status, 200);
  assert.equal(identity.headers["content-encoding"], undefined);
  assert.equal(identity.body.toString(), SCRIPT);
  assert.equal(
    identity.headers["content-type"],
    brotli.headers["content-type"],
    "every coding describes the same asset the same way",
  );
  assert.equal(identity.headers.vary, "Accept-Encoding", "the answer depends on the request");
  assert.notEqual(
    identity.headers.etag,
    brotli.headers.etag,
    "each coding is a representation of its own, so a cache cannot confuse them",
  );
});

test("Accept-Encoding decides the coding: by quality, and q=0 refuses one", async () => {
  const coding = async (header: string) =>
    (await ask("/assets/app-A1b2C3d4.js", { "accept-encoding": header })).headers[
      "content-encoding"
    ];
  assert.equal(await coding("gzip, br"), "br", "Piano prefers Brotli when both are welcome");
  assert.equal(await coding("br;q=0.2, gzip;q=0.8"), "gzip", "the higher quality wins");
  assert.equal(await coding("br;q=0, gzip"), "gzip", "q=0 refuses Brotli");
  assert.equal(await coding("*"), "br", "a wildcard accepts every coding");
  assert.equal(await coding("*;q=0, gzip"), "gzip", "a named coding outranks a refusing wildcard");
  assert.equal(await coding("x-gzip"), "gzip", "the historical spelling names gzip");
  assert.equal(await coding("br;q=0, gzip;q=0"), undefined, "refusing both leaves the asset");
  assert.equal(await coding(""), undefined, "an empty field accepts identity only");
  assert.equal(await coding("deflate"), undefined, "an unavailable coding leaves the asset");

  for (const header of ["identity;q=0", "*;q=0"]) {
    const refused = await ask("/assets/app-A1b2C3d4.js", { "accept-encoding": header });
    assert.equal(refused.status, 406, `${header} leaves Piano nothing it may send`);
    assert.equal(refused.headers.vary, "Accept-Encoding");
  }
});

test("a client that prefers the asset itself is sent the asset, not a coding", async () => {
  const answer = (header: string) => ask("/assets/app-A1b2C3d4.js", { "accept-encoding": header });
  assert.equal(
    (await answer("identity;q=1, br;q=0.2")).headers["content-encoding"],
    undefined,
    "a stated preference for the asset outranks a coding ranked below it",
  );
  assert.equal(
    (await answer("identity;q=0.5, br")).headers["content-encoding"],
    "br",
    "a coding the client prefers to the asset still wins",
  );
  assert.equal(
    (await answer("identity, br")).headers["content-encoding"],
    "br",
    "equal quality leaves the choice to Piano, which sends the smaller answer",
  );
  const positiveWildcard = await answer("*;q=0.1");
  assert.equal(positiveWildcard.status, 200, "a positive wildcard refuses nothing");
  assert.equal(positiveWildcard.headers["content-encoding"], "br");
  const namedIdentity = await answer("*;q=0, identity");
  assert.equal(namedIdentity.status, 200, "an entry of its own keeps the asset acceptable");
  assert.equal(namedIdentity.headers["content-encoding"], undefined);
  assert.equal(namedIdentity.body.toString(), SCRIPT);
});

test("an asset with no copy on disk is served as it is, whatever the client accepts", async () => {
  const style = await ask("/assets/style-E5f6G7h8.css", { "accept-encoding": "br, gzip" });
  assert.equal(style.status, 200);
  assert.equal(style.headers["content-encoding"], undefined);
  assert.equal(style.headers["content-type"], "text/css; charset=utf-8");
  assert.equal(style.body.toString(), STYLE);

  const logo = await ask("/logo.svg", { "accept-encoding": "gzip" });
  assert.equal(logo.headers["content-encoding"], undefined, "only the Brotli copy was written");
  assert.equal(logo.body.toString(), LOGO);
  assert.equal(
    (await ask("/logo.svg", { "accept-encoding": "br" })).headers["content-encoding"],
    "br",
  );
});

test("only a hashed build asset may be kept forever; every other file is revalidated", async () => {
  for (const header of ["br, gzip", "identity"]) {
    const headers = { "accept-encoding": header };
    assert.equal(
      (await ask("/assets/app-A1b2C3d4.js", headers)).headers["cache-control"],
      "public, max-age=31536000, immutable",
      `a content-hashed name never changes meaning (${header})`,
    );
    for (const target of ["/", "/index.html", "/logo.svg"])
      assert.equal(
        (await ask(target, { ...headers, ...html })).headers["cache-control"],
        "no-cache",
        `${target} keeps its name across builds (${header})`,
      );
  }
});

test("a revalidated asset answers 304 without sending the coded body again", async () => {
  const first = await ask("/index.html", { "accept-encoding": "br", ...html });
  assert.equal(first.headers["content-encoding"], "br");
  const etag = first.headers.etag;
  assert.ok(etag, "a coded answer carries the entity tag of the copy it came from");

  const again = await ask("/index.html", {
    "accept-encoding": "br",
    "if-none-match": etag,
    ...html,
  });
  assert.equal(again.status, 304);
  assert.equal(again.body.length, 0);
  assert.equal(again.headers.etag, etag);
  assert.equal(again.headers["cache-control"], "no-cache");
  assert.equal(again.headers.vary, "Accept-Encoding");

  const stale = await ask("/index.html", {
    "accept-encoding": "br",
    "if-none-match": '"not-this-one"',
    ...html,
  });
  assert.equal(stale.status, 200);
  assert.equal(brotliDecompressSync(stale.body).toString(), INDEX);

  // A cache that kept only the date revalidates the coded copy the same way.
  const dated = await ask("/index.html", {
    "accept-encoding": "br",
    "if-modified-since": first.headers["last-modified"]!,
    ...html,
  });
  assert.equal(dated.status, 304);
  assert.equal(dated.body.length, 0);
});

test("HEAD answers what GET would, without the body", async () => {
  const get = await ask("/assets/app-A1b2C3d4.js", { "accept-encoding": "br" });
  const head = await ask("/assets/app-A1b2C3d4.js", { "accept-encoding": "br" }, "HEAD");
  assert.equal(head.status, 200);
  assert.equal(head.body.length, 0, "a HEAD answer carries no body");
  for (const field of [
    "content-encoding",
    "content-type",
    "content-length",
    "cache-control",
    "vary",
    "etag",
  ])
    assert.equal(head.headers[field], get.headers[field], field);
  assert.equal((await ask("/assets/missing-Z9y8X7w6.js", {}, "HEAD")).status, 404);
});

test("an unknown path opens the application; a missing asset and an escape do not", async () => {
  const route = await ask("/s/some-session-id", { "accept-encoding": "br, gzip", ...html });
  assert.equal(route.status, 200, "the single-page fallback answers a client-side route");
  assert.equal(route.headers["content-encoding"], "br");
  assert.equal(route.headers["content-type"], "text/html; charset=utf-8");
  assert.equal(route.headers["cache-control"], "no-cache");
  assert.equal(brotliDecompressSync(route.body).toString(), INDEX);

  for (const target of [
    "/assets/missing-Z9y8X7w6.js",
    "/index.html.br",
    "/assets/app-A1b2C3d4.js.gz",
    "/..%2fsecret.txt",
    "/%2e%2e/%2e%2e/secret.txt",
    "/../secret.txt",
    "/%00secret.txt",
  ]) {
    const answer = await ask(target, { "accept-encoding": "br, gzip" });
    assert.equal(answer.status, 404, `${target} names no asset`);
    const body =
      answer.headers["content-encoding"] === "br" ? brotliDecompressSync(answer.body) : answer.body;
    assert.ok(!body.includes(SECRET), `${target} must not read outside the build`);
  }
});
