import { Effect, FileSystem, Layer, Option, Path } from "effect";
import {
  HttpPlatform,
  HttpRouter,
  HttpServerError,
  HttpServerRequest,
  HttpServerRespondable,
  HttpServerResponse,
  HttpStaticServer,
} from "effect/http";

const CODINGS = [
  { coding: "br", suffix: ".br" },
  { coding: "gzip", suffix: ".gz" },
] as const;

const CONTENT_TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  json: "application/json; charset=utf-8",
  map: "application/json",
  webmanifest: "application/manifest+json",
  svg: "image/svg+xml; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  xml: "application/xml; charset=utf-8",
  wasm: "application/wasm",
};

const HASHED = /^assets[/\\][^/\\]*-[A-Za-z0-9_-]{8,}\.[A-Za-z0-9.]+$/;
const IMMUTABLE = "public, max-age=31536000, immutable";
const REVALIDATE = "no-cache";

const cacheControl = (relative: string) => (HASHED.test(relative) ? IMMUTABLE : REVALIDATE);

const preferredCodings = (header: string | undefined) => {
  const qualities = new Map<string, number>();
  for (const entry of (header ?? "").split(",")) {
    const [name, ...parameters] = entry.split(";");
    const coding = name.trim().toLowerCase();
    if (coding === "") continue;
    let quality = 1;
    for (const parameter of parameters) {
      const [key, value] = parameter.split("=");
      if (key.trim().toLowerCase() !== "q") continue;
      const parsed = Number.parseFloat((value ?? "").trim());
      quality = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 0), 1) : 1;
    }
    qualities.set(coding === "x-gzip" ? "gzip" : coding, quality);
  }
  const wildcard = qualities.get("*");
  const stated = qualities.get("identity");
  return {
    identity: stated ?? (wildcard === 0 ? 0 : 1),
    codings: CODINGS.map((candidate) => ({
      ...candidate,
      quality: qualities.get(candidate.coding) ?? wildcard ?? 0,
    }))
      .filter(({ quality }) => quality > 0 && (stated === undefined || stated <= quality))
      .sort((left, right) => right.quality - left.quality),
  };
};

const notModified = (response: HttpServerResponse.HttpServerResponse) => {
  const headers: Record<string, string> = {};
  for (const name of ["etag", "cache-control", "last-modified", "vary"] as const) {
    const value = response.headers[name];
    if (value !== undefined) headers[name] = value;
  }
  return HttpServerResponse.empty({ status: 304, headers });
};

const strongEtag = (value: string) => {
  const trimmed = value.trim();
  return /^w\//i.test(trimmed) ? trimmed.slice(2) : trimmed;
};

const matchesEtag = (ifNoneMatch: string, etag: string | undefined) =>
  ifNoneMatch
    .split(",")
    .map((candidate) => candidate.trim())
    .some(
      (candidate) =>
        candidate === "*" || (etag !== undefined && strongEtag(candidate) === strongEtag(etag)),
    );

const notModifiedSince = (ifModifiedSince: string, lastModified: string | undefined) => {
  if (lastModified === undefined) return false;
  const since = Date.parse(ifModifiedSince);
  const modified = Date.parse(lastModified);
  return !Number.isNaN(since) && !Number.isNaN(modified) && modified <= since;
};

export const makeStaticAssets = Effect.fnUntraced(function* (options: {
  readonly root: string;
  readonly index?: string | undefined;
}) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const platform = yield* HttpPlatform.HttpPlatform;
  const root = path.resolve(options.root);
  const index = options.index ?? "index.html";
  const identity = yield* HttpStaticServer.make({ root, index, spa: true });

  const contentType = (file: string) =>
    CONTENT_TYPES[path.extname(file).slice(1).toLowerCase()] ?? "application/octet-stream";

  const resolve = (url: string) => {
    const [requested] = url.split("?");
    let decoded: string;
    try {
      decoded = decodeURIComponent(requested);
    } catch {
      return undefined;
    }
    if (decoded.includes("\u0000")) return undefined;
    const normalized = path.normalize(decoded.startsWith("/") ? decoded.slice(1) : decoded);
    if (normalized === ".." || normalized.startsWith(`..${path.sep}`)) return undefined;
    const resolved = path.join(root, normalized);
    const prefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
    if (resolved !== root && !resolved.startsWith(prefix)) return undefined;
    if (CODINGS.some(({ suffix }) => resolved.endsWith(suffix))) return undefined;
    return resolved;
  };

  const isFile = (file: string) =>
    fileSystem.stat(file).pipe(
      Effect.map((info) => info.type === "File"),
      Effect.orElseSucceed(() => false),
    );

  const target = Effect.fnUntraced(function* (
    request: HttpServerRequest.HttpServerRequest,
    file: string,
  ) {
    const info = yield* Effect.option(fileSystem.stat(file));
    if (Option.isSome(info)) {
      if (info.value.type === "File") return file;
      if (info.value.type !== "Directory") return undefined;
      const directoryIndex = path.join(file, index);
      return (yield* isFile(directoryIndex)) ? directoryIndex : undefined;
    }
    const accept = request.headers.accept?.toLowerCase() ?? "";
    return path.extname(file) === "" && accept.includes("text/html")
      ? path.join(root, index)
      : undefined;
  });

  const notFound = (request: HttpServerRequest.HttpServerRequest) =>
    new HttpServerError.HttpServerError({
      reason: new HttpServerError.RouteNotFound({ request }),
    });

  const coded = Effect.fnUntraced(function* (
    request: HttpServerRequest.HttpServerRequest,
    file: string,
    accepted: ReadonlyArray<{ readonly coding: string; readonly suffix: string }>,
  ) {
    for (const { coding, suffix } of accepted) {
      if (!(yield* isFile(`${file}${suffix}`))) continue;
      const response = yield* platform
        .fileResponse(`${file}${suffix}`, {
          contentType: contentType(file),
          headers: {
            "content-encoding": coding,
            vary: "Accept-Encoding",
            "cache-control": cacheControl(path.relative(root, file)),
          },
        })
        .pipe(
          Effect.mapError(
            (cause) =>
              new HttpServerError.HttpServerError({
                reason: new HttpServerError.InternalError({ request, cause }),
              }),
          ),
        );
      const ifNoneMatch = request.headers["if-none-match"];
      if (ifNoneMatch !== undefined)
        return matchesEtag(ifNoneMatch, response.headers.etag) ? notModified(response) : response;
      const ifModifiedSince = request.headers["if-modified-since"];
      return ifModifiedSince !== undefined &&
        notModifiedSince(ifModifiedSince, response.headers["last-modified"])
        ? notModified(response)
        : response;
    }
    return undefined;
  });

  return HttpServerRequest.HttpServerRequest.use(
    Effect.fnUntraced(function* (request) {
      const requested = resolve(request.url);
      if (requested === undefined) return yield* Effect.fail(notFound(request));
      const asset = yield* target(request, requested);
      const accepted = preferredCodings(request.headers["accept-encoding"]);
      const compressed =
        asset === undefined ? undefined : yield* coded(request, asset, accepted.codings);
      if (compressed !== undefined) return compressed;
      if (asset !== undefined && accepted.identity === 0)
        return HttpServerResponse.text("No acceptable content coding available.", {
          status: 406,
          headers: { vary: "Accept-Encoding" },
        });
      return yield* Effect.map(identity, (response) =>
        HttpServerResponse.setHeaders(response, {
          vary: "Accept-Encoding",
          "cache-control": cacheControl(path.relative(root, asset ?? requested)),
        }),
      );
    }),
  );
});

export const staticAssets = (options: {
  readonly root: string;
  readonly index?: string | undefined;
}) =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const router = yield* HttpRouter.HttpRouter;
      const app = (yield* makeStaticAssets(options)).pipe(
        Effect.catch(HttpServerRespondable.toResponse),
      );
      yield* router.add("GET", "/*", app);
    }),
  );
