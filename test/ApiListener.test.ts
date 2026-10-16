import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Effect, Layer } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { apiListener } from "../server/ApiListener.ts";

const Routes = HttpRouter.use((router) =>
  router.add("GET", "/api/v1/sessions/list", Effect.succeed(HttpServerResponse.jsonUnsafe([]))),
);

test("local API is opt-in; socket binds with 0600 and is removed on shutdown", async () => {
  assert.equal(apiListener(undefined, undefined), undefined);
  assert.throws(() => apiListener(undefined, "0"));
  assert.throws(() => apiListener("relative.sock", undefined));
  const root = mkdtempSync(join(tmpdir(), "piano-api-socket-"));
  const socketPath = join(root, "private", "api.sock");
  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* Layer.build(
          HttpRouter.serve(Routes, { disableLogger: true, disableListenLog: true }).pipe(
            Layer.provide(apiListener(socketPath, "invalid-ignored")!),
          ),
        );
        assert.equal(statSync(socketPath).mode & 0o777, 0o600);
        const body = yield* Effect.promise(
          () =>
            new Promise<string>((resolve, reject) => {
              const req = request({ socketPath, path: "/api/v1/sessions/list" }, (res) => {
                let text = "";
                res.on("data", (chunk) => {
                  text += chunk;
                });
                res.on("end", () => resolve(text));
              });
              req.on("error", reject);
              req.end();
            }),
        );
        assert.deepEqual(JSON.parse(body), []);
      }).pipe(Effect.scoped),
    );
    assert.throws(() => statSync(socketPath), /ENOENT/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
