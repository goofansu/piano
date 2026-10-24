/** The production router over the production services (PianoServices), in a scratch directory; only the Pi child is faked. */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { Effect, Layer, ManagedRuntime } from "effect";
import { HttpRouter } from "effect/http";
import { AllowedOrigins } from "../../server/OriginPolicy.ts";
import { PianoAdaptersLive, PianoServicesLive } from "../../server/PianoServices.ts";
import { PiCli } from "../../server/PiCli.ts";
import type { ProviderLogin } from "../../server/ProviderLogin.ts";
import { Registry, RegistryDatabasePath, RegistryLive } from "../../server/Registry.ts";
import { AppRouter } from "../../server/Router.ts";
import type { SessionHosts } from "../../server/SessionHosts.ts";

export interface RouterFixture {
  readonly root: string;
  /** A registered folder: a git checkout whose README.md has one uncommitted added line. */
  readonly repo: string;
  readonly workspaceId: string;
  /** Answer a request as the server would; a relative URL resolves against the server's origin. */
  readonly handle: (input: string, init?: RequestInit) => Promise<Response>;
  /** Run against the same services the router answers from, e.g. to start a session it can see. */
  readonly run: <A, X>(
    effect: Effect.Effect<A, X, SessionHosts | Registry | ProviderLogin>,
  ) => Promise<A>;
  readonly dispose: () => Promise<void>;
}

/** `services` replaces production services, to put a fake behind one of their interfaces. */
export async function startRouter<Fakes = never>(
  prefix: string,
  services?: Layer.Layer<Fakes>,
): Promise<RouterFixture> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  const repo = join(root, "repo");
  process.env.PI_CODING_AGENT_DIR = join(root, "agent");
  process.env.PI_CODING_AGENT_SESSION_DIR = join(root, "sessions");
  mkdirSync(join(root, "sessions"));
  mkdirSync(join(repo, "src"), { recursive: true });
  const git = (...args: string[]) =>
    execFileSync(
      "git",
      ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@example.com", ...args],
      { stdio: "pipe" },
    );
  git("init", "-q");
  writeFileSync(join(repo, "README.md"), "one\n");
  git("add", ".");
  git("commit", "-qm", "initial");
  writeFileSync(join(repo, "README.md"), "one\ntwo\n");

  const Config = Layer.mergeAll(
    Layer.succeed(AllowedOrigins, new Set(["http://piano.test"])),
    Layer.succeed(PiCli, {
      node: process.execPath,
      cli: new URL("../fake-pi.mjs", import.meta.url).pathname,
      extraArgs: [],
    }),
    Layer.succeed(RegistryDatabasePath, join(root, "registry.db")),
    NodeServices.layer,
  );
  // Production adapters a test may replace through `services`: a later layer wins a merge.
  const Adapters = PianoAdaptersLive.pipe(Layer.provideMerge(Config));
  const Services = PianoServicesLive({ idleMs: 0 }).pipe(
    Layer.provideMerge(services ? Layer.merge(Adapters, services) : Adapters),
  );

  const workspaceId = await Effect.runPromise(
    Effect.gen(function* () {
      const registry = yield* Registry;
      yield* registry.addFolder(repo);
      return (yield* registry.get).workspaces.find((w) => w.path === repo)!.id;
    }).pipe(Effect.provide(RegistryLive.pipe(Layer.provide(Config)))),
  );
  const runtime = ManagedRuntime.make(services ? Layer.merge(Services, services) : Services);
  const web = HttpRouter.toWebHandler(
    AppRouter.pipe(Layer.provideMerge(Layer.succeedContext(await runtime.context()))),
    { disableLogger: true },
  );
  return {
    root,
    repo,
    workspaceId,
    handle: (input, init) => {
      const headers = new Headers(init?.headers);
      if (!headers.has("origin")) headers.set("origin", "http://piano.test");
      return web.handler(new Request(new URL(input, "http://piano.test"), { ...init, headers }));
    },
    run: (effect) => runtime.runPromise(effect),
    dispose: async () => {
      await web.dispose();
      await runtime.dispose();
      rmSync(root, { recursive: true, force: true });
    },
  };
}
