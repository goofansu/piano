/** Reflection discovery: environment identity is sticky; attached integrations are refreshable facts. */
import { Clock, Context, Effect, Layer, Schema, Semaphore } from "effect";
import { ExeDevIntegrationName } from "../shared/exeDev.ts";

export const ExeDevFetch = Context.Reference<typeof fetch>("piano/ExeDevFetch", {
  defaultValue: () => globalThis.fetch,
});
const Index = Schema.Struct({
  name: Schema.String,
  paths: Schema.Array(Schema.Struct({ path: Schema.String })),
});
const Integration = Schema.Struct({
  name: ExeDevIntegrationName,
  type: Schema.String,
});
const Inventory = Schema.Struct({ integrations: Schema.Array(Integration) });
type Integration = typeof Integration.Type;

async function smallJson(response: Response, limit: number): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Empty response");
  let text = "";
  let bytes = 0;
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) throw new Error("Response too large");
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally {
    await reader.cancel();
  }
}

export class ExeDev extends Context.Service<
  ExeDev,
  {
    /** One-second detection; positive results last until this backend stops. */
    readonly detected: Effect.Effect<boolean>;
    /** Null is unavailable, never an empty successful catalog. Refresh bypasses the 30-second cache. */
    readonly integrations: (refresh?: boolean) => Effect.Effect<ReadonlyArray<Integration> | null>;
  }
>()("piano/ExeDev") {}

export const ExeDevLive = Layer.effect(
  ExeDev,
  Effect.gen(function* () {
    const fetch = yield* ExeDevFetch;
    const detectionLock = yield* Semaphore.make(1);
    const inventoryLock = yield* Semaphore.make(1);
    let detected = false;
    let advertised = false;
    let retryAt = 0;
    let inventory: ReadonlyArray<Integration> | null = null;
    let expiresAt = 0;
    let version = 0;

    const read = Effect.fn("ExeDev.read")(function* (path: "/" | "/integrations") {
      return yield* Effect.tryPromise({
        try: async (signal) => {
          const response = await fetch(`https://reflection.int.exe.xyz${path}`, {
            signal,
            redirect: "error",
          });
          if (!response.ok) {
            await response.body?.cancel();
            throw new Error("Reflection unavailable");
          }
          return await smallJson(response, path === "/" ? 16_384 : 65_536);
        },
        catch: () => new Error("Reflection unavailable"),
      }).pipe(Effect.timeout(1_000));
    });
    const index = Effect.gen(function* () {
      const value = yield* Schema.decodeUnknownEffect(Index)(yield* read("/"));
      if (!value.name.trim()) return;
      detected = true;
      advertised = value.paths.some((p) => p.path === "/integrations");
    }).pipe(Effect.catch(() => Effect.void));
    const detect = Semaphore.withPermits(
      detectionLock,
      1,
    )(
      Effect.gen(function* () {
        if (detected) return true;
        const now = yield* Clock.currentTimeMillis;
        if (now < retryAt) return false;
        retryAt = now + 30_000;
        yield* index;
        return detected;
      }),
    );

    return ExeDev.of({
      detected: detect,
      integrations: Effect.fn("ExeDev.integrations")(function* (refresh = false) {
        const seen = version;
        return yield* Semaphore.withPermits(
          inventoryLock,
          1,
        )(
          Effect.gen(function* () {
            const now = yield* Clock.currentTimeMillis;
            // Concurrent readers share the refresh that finished while they waited for the lock.
            if (version !== seen || (!refresh && now < expiresAt)) return inventory;
            const wasDetected = detected;
            const available = yield* detect;
            // A later metadata permission change must be discoverable without losing positive detection.
            if (wasDetected && available && !advertised && refresh) yield* index;
            inventory =
              available && advertised
                ? yield* Effect.gen(function* () {
                    const value = yield* Schema.decodeUnknownEffect(Inventory)(
                      yield* read("/integrations"),
                    );
                    const names = value.integrations.map((i) => i.name.toLowerCase());
                    if (new Set(names).size !== names.length)
                      return yield* Effect.fail(new Error("Duplicate integration names"));
                    return value.integrations;
                  }).pipe(Effect.catch(() => Effect.succeed(null)))
                : null;
            expiresAt = (yield* Clock.currentTimeMillis) + 30_000;
            version++;
            return inventory;
          }),
        );
      }),
    });
  }),
);
